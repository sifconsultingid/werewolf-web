import { describe, expect, it } from 'vitest';
import {
  ALL_VOTED_GRACE_MS, autoTick, DEFAULT_TIMINGS, NIGHT_DEAD_MS, NIGHT_MIN_MS, setPaused,
} from '../src/game/auto';
import { alivePlayers, autoAssignRoles, currentStep, eligibleVoters, stepCandidates } from '../src/game/engine';
import {
  applyPlayerAction, buildPrivateView, buildPublicView, createRoom, startGame, type Room,
} from '../src/game/room';
import type { Role } from '../src/game/roles';
import { seeded } from './helpers';

function autoRoom(roles: Role[], settings: Partial<Room['settings']> = {}): Room {
  const room = createRoom('AUTO1', roles.length, undefined, { autoNarrator: true });
  Object.assign(room.settings, settings);
  for (let i = 0; i < roles.length; i++) applyPlayerAction(room, `uid${i}`, { type: 'join', name: `Pemain ${i + 1}` }, seeded(i + 1));
  room.hostUid = 'uid0';
  room.autoCounts = false;
  room.counts = {};
  for (const r of roles) room.counts[r] = (room.counts[r] ?? 0) + 1;
  startGame(room, seeded(7));
  room.game!.players.forEach((p, i) => { p.role = roles[i]; });
  return room;
}

const pid = (room: Room, i: number) => room.seats[i].pid;
const SEC = 1000;

/** Jalankan autoTick tiap 250 ms sampai `until` terpenuhi atau batas waktu. Mengembalikan waktu akhir. */
function run(room: Room, from: number, until: () => boolean, maxMs = 120 * SEC, speaking = () => false): number {
  let now = from;
  const rng = seeded(3);
  while (now - from < maxMs) {
    autoTick(room.game!, room.auto!, now, { rng, speaking: speaking() });
    if (until()) return now;
    now += 250;
  }
  throw new Error(`Tidak tercapai dalam ${maxMs} ms (fase ${room.game!.phase})`);
}

describe('narator otomatis', () => {
  it('reveal: mulai malam setelah semua siap, atau setelah batas waktu', () => {
    const room = autoRoom(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    room.game!.players.forEach((_, i) => applyPlayerAction(room, `uid${i}`, { type: 'ready' }));
    const t = run(room, 0, () => room.game!.phase === 'night');
    expect(t).toBeLessThan(3 * SEC);

    const slow = autoRoom(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    const t2 = run(slow, 0, () => slow.game!.phase === 'night');
    expect(t2).toBeGreaterThanOrEqual(DEFAULT_TIMINGS.revealSeconds * SEC);
  });

  it('timer belum berjalan selama narasi masih dibacakan', () => {
    const room = autoRoom(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    let speak = true;
    let now = 0;
    for (; now < 90 * SEC; now += 500) autoTick(room.game!, room.auto!, now, { speaking: speak });
    expect(room.game!.phase).toBe('reveal');
    speak = false;
    const t = run(room, now, () => room.game!.phase === 'night');
    expect(t - now).toBeGreaterThanOrEqual(DEFAULT_TIMINGS.revealSeconds * SEC);
  });

  it('aksi malam ditahan sampai durasi minimum, lalu langkah ditutup', () => {
    const room = autoRoom(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    room.game!.ready = room.game!.players.map((p) => p.id);
    run(room, 0, () => room.game!.phase === 'night');
    const g = room.game!;
    const t0 = 10 * SEC;
    autoTick(g, room.auto!, t0); // mulai timer langkah serigala
    applyPlayerAction(room, 'uid0', { type: 'wolfVote', target: pid(room, 2) });
    expect(currentStep(g)?.role).toBe('werewolf'); // belum ditutup
    const t1 = run(room, t0, () => currentStep(g)?.role === 'seer');
    expect(t1 - t0).toBeGreaterThanOrEqual(NIGHT_MIN_MS[0]);
    expect(g.wolfTarget).toBe(pid(room, 2));

    autoTick(g, room.auto!, t1 + 250);
    applyPlayerAction(room, 'uid1', { type: 'night', input: { target: pid(room, 0) } });
    // Setelah mengirim, layar Peramal tidak lagi menampilkan tombol aksi
    expect(buildPrivateView(room, 'uid1').action).toBeNull();
    expect(currentStep(g)?.role).toBe('seer');
    run(room, t1 + 250, () => g.phase === 'morning');
    expect(g.seerHistory[0]).toMatchObject({ targetId: pid(room, 0), isWolf: true });
  });

  it('serigala tidak sepakat sampai waktu habis → tidak ada korban', () => {
    const room = autoRoom(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    room.game!.ready = room.game!.players.map((p) => p.id);
    run(room, 0, () => room.game!.phase === 'night');
    const g = room.game!;
    const t0 = 10 * SEC;
    autoTick(g, room.auto!, t0);
    applyPlayerAction(room, 'uid0', { type: 'wolfVote', target: pid(room, 2) });
    applyPlayerAction(room, 'uid1', { type: 'wolfVote', target: pid(room, 3) });
    const t1 = run(room, t0, () => g.phase === 'morning');
    expect(t1 - t0).toBeGreaterThanOrEqual(DEFAULT_TIMINGS.nightStepSeconds * SEC);
    expect(g.lastDeaths).toEqual([]);
  });

  it('langkah peran yang sudah mati ditutup sendiri dalam rentang acak, tanpa batas waktu publik', () => {
    const room = autoRoom(['werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    const g = room.game!;
    g.players[1].isAlive = false; // Peramal mati
    g.ready = g.players.map((p) => p.id);
    run(room, 0, () => g.phase === 'night');
    applyPlayerAction(room, 'uid0', { type: 'wolfVote', target: pid(room, 2) });
    const t0 = run(room, 3 * SEC, () => currentStep(g)?.role === 'seer');
    expect(buildPublicView(room).auto?.endsAt).toBeNull();
    autoTick(g, room.auto!, t0 + 250);
    const t1 = run(room, t0 + 250, () => g.phase === 'morning');
    expect(t1 - t0).toBeGreaterThanOrEqual(NIGHT_DEAD_MS[0]);
    expect(t1 - t0).toBeLessThanOrEqual(NIGHT_DEAD_MS[1] + SEC);
  });

  it('Cupid yang tidak merespons dilewati tanpa kekasih', () => {
    const room = autoRoom(['werewolf', 'cupid', 'villager', 'villager', 'villager']);
    const g = room.game!;
    g.ready = g.players.map((p) => p.id);
    run(room, 0, () => currentStep(g)?.role === 'werewolf');
    expect(g.lovers).toEqual([]);
  });

  it('voting: semua memilih → eksekusi; seri → voting ulang sekali, seri lagi → tidak ada eksekusi', () => {
    const room = autoRoom(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    const g = room.game!;
    g.ready = g.players.map((p) => p.id);
    run(room, 0, () => g.phase === 'vote');
    autoTick(g, room.auto!, 3 * SEC);
    // 2 vs 2 (pemain 5 tidak memilih)
    applyPlayerAction(room, 'uid0', { type: 'vote', target: pid(room, 1) });
    applyPlayerAction(room, 'uid1', { type: 'vote', target: pid(room, 0) });
    applyPlayerAction(room, 'uid2', { type: 'vote', target: pid(room, 0) });
    applyPlayerAction(room, 'uid3', { type: 'vote', target: pid(room, 1) });
    run(room, 3 * SEC, () => buildPublicView(room).auto?.revote === true);
    expect(g.executionDone).toBe(false);
    expect(g.ballots).toEqual({});
    // Seri lagi sampai waktu habis
    applyPlayerAction(room, 'uid0', { type: 'vote', target: pid(room, 1) });
    applyPlayerAction(room, 'uid1', { type: 'vote', target: pid(room, 0) });
    run(room, 100 * SEC, () => g.executionDone);
    expect(g.executedId).toBeNull();

    const room2 = autoRoom(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    const g2 = room2.game!;
    g2.ready = g2.players.map((p) => p.id);
    run(room2, 0, () => g2.phase === 'vote');
    const t0 = 3 * SEC;
    autoTick(g2, room2.auto!, t0);
    for (const v of eligibleVoters(g2)) {
      const i = room2.seats.findIndex((s) => s.pid === v.id);
      applyPlayerAction(room2, `uid${i}`, { type: 'vote', target: i === 0 ? pid(room2, 1) : pid(room2, 0) });
    }
    const t1 = run(room2, t0, () => g2.executionDone);
    expect(t1 - t0).toBeLessThanOrEqual(ALL_VOTED_GRACE_MS + SEC);
    expect(g2.executedId).toBe(pid(room2, 0));
    run(room2, t1, () => g2.phase === 'gameOver'); // serigala satu-satunya dieksekusi
    expect(g2.winner?.kind).toBe('village');
  });

  it('Pemburu yang tidak menembak sampai waktu habis dilewati', () => {
    const room = autoRoom(['werewolf', 'hunter', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    const g = room.game!;
    g.ready = g.players.map((p) => p.id);
    run(room, 0, () => g.phase === 'vote');
    autoTick(g, room.auto!, 3 * SEC);
    for (let i = 0; i < 6; i++) applyPlayerAction(room, `uid${i}`, { type: 'vote', target: i === 1 ? pid(room, 2) : pid(room, 1) });
    run(room, 3 * SEC, () => g.pendingHunters.length > 0);
    expect(buildPublicView(room).auto?.endsAt).not.toBeNull();
    run(room, 10 * SEC, () => g.phase === 'night');
    expect(g.huntersUsed).toEqual([pid(room, 1)]);
  });

  it('diskusi berakhir sendiri lalu voting dibuka', () => {
    const room = autoRoom(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, discussionSeconds: 60 });
    const g = room.game!;
    g.ready = g.players.map((p) => p.id);
    const t0 = run(room, 0, () => g.phase === 'day');
    const t1 = run(room, t0, () => g.phase === 'vote');
    expect(t1 - t0).toBeGreaterThanOrEqual(59 * SEC);
  });

  it('Jeda menghentikan semua timer termasuk diskusi, Lanjut meneruskan sisa waktunya', () => {
    const room = autoRoom(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, discussionSeconds: 60 });
    const g = room.game!;
    g.ready = g.players.map((p) => p.id);
    const t0 = run(room, 0, () => g.phase === 'day');
    setPaused(g, room.auto!, true, t0 + 10 * SEC);
    expect(buildPublicView(room).auto?.paused).toBe(true);
    for (let t = t0 + 10 * SEC; t < t0 + 600 * SEC; t += 1000) autoTick(g, room.auto!, t);
    expect(g.phase).toBe('day');
    setPaused(g, room.auto!, false, t0 + 600 * SEC);
    const t1 = run(room, t0 + 600 * SEC, () => g.phase === 'vote');
    expect(t1 - (t0 + 600 * SEC)).toBeGreaterThanOrEqual(49 * SEC);
  });

  it('permainan acak berjalan sampai selesai hanya dengan narator otomatis (pemain kadang AFK)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seeded(seed);
      const n = 5 + Math.floor(rng() * 10);
      const room = createRoom('SIM', n, undefined, { autoNarrator: true });
      for (let i = 0; i < n; i++) applyPlayerAction(room, `u${i}`, { type: 'join', name: `P${i}` }, rng);
      room.counts = autoAssignRoles(n);
      room.autoCounts = false;
      startGame(room, rng);
      const g = room.game!;
      const uidOf = (p: string) => `u${room.seats.findIndex((s) => s.pid === p)}`;
      const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
      let now = 0;
      while (g.phase !== 'gameOver') {
        if (now > 4 * 3600 * SEC) throw new Error(`seed ${seed}: tidak selesai`);
        autoTick(g, room.auto!, now, { rng, speaking: rng() < 0.2 });
        // Sesekali pemain beraksi
        if (rng() < 0.15) {
          const alive = alivePlayers(g);
          const me = pick(g.players);
          const u = uidOf(me.id);
          const step = currentStep(g);
          if (g.phase === 'reveal') applyPlayerAction(room, u, { type: 'ready' });
          else if (g.pendingHunters[0] === me.id) applyPlayerAction(room, u, { type: 'hunter', target: pick(alive).id });
          else if (step && step.role === me.role && rng() < 0.8) {
            const cands = stepCandidates(g, step.role).map((p) => p.id);
            if (step.role === 'werewolf') applyPlayerAction(room, u, { type: 'wolfVote', target: cands.length ? pick(cands) : null });
            else if (step.role === 'cupid' && cands.length >= 2) applyPlayerAction(room, u, { type: 'night', input: { lovers: [cands[0], cands[1]] } });
            else applyPlayerAction(room, u, { type: 'night', input: cands.length ? { target: pick(cands) } : {} });
          } else if (g.phase === 'vote') applyPlayerAction(room, u, { type: 'vote', target: pick(alive).id });
        }
        now += 500;
      }
      expect(g.winner).not.toBeNull();
    }
  });
});
