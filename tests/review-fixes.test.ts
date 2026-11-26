import { describe, expect, it } from 'vitest';
import {
  beginFirstRound, commitStep, currentStep, execute, finishDay, goToVote, morningAnnouncement, THIEF_NOTICE,
  type GameState,
} from '../src/game/engine';
import { narrationFor } from '../src/game/narration';
import {
  applyPlayerAction, buildPrivateView, buildPublicView, NOTICE_MS, resolveReclaim, type Room,
} from '../src/game/room';
import { newAutoState, setPaused } from '../src/game/auto';
import { createBeeper } from '../src/ui/beep';
import type { Voice } from '../src/ui/voice';
import { gameWith } from './helpers';

const roomOf = (g: GameState, extra: Partial<Room> = {}) => ({
  code: 'X', seats: g.players.map((p, i) => ({ uid: `u${i}`, pid: p.id, name: p.name })),
  game: g, notices: {}, auto: null, ...extra,
} as unknown as Room);
const to = (g: GameState, r: string) => { while (currentStep(g)?.role !== r) commitStep(g, {}, Date.now(), true); };
/** Prince p0 selamat dari voting hari 1, lalu malam 1 dimulai */
function princeRevealed(roles: Parameters<typeof gameWith>[0]) {
  const g = gameWith(roles, { startWithNight: false });
  beginFirstRound(g); goToVote(g); execute(g, 'p0'); finishDay(g);
  return g;
}

describe('Prince yang sudah terbuka lalu kartunya pindah', () => {
  it('peran barunya tidak bocor ke tampilan publik', () => {
    const g = princeRevealed(['prince', 'werewolf', 'troublemaker', 'villager', 'villager', 'villager', 'villager']);
    to(g, 'troublemaker');
    commitStep(g, { swap: ['p0', 'p1'] });
    expect(g.players[0].role).toBe('werewolf');
    const pub = buildPublicView(roomOf(g));
    expect(pub.seats[0].role).toBe('prince');
    expect(pub.seats[1].role).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('werewolf');
  });

  it('kekebalan Prince hanya sekali walau kartunya dicuri', () => {
    const g = princeRevealed(['prince', 'werewolf', 'thief', 'villager', 'villager', 'villager', 'villager']);
    to(g, 'thief');
    commitStep(g, { target: 'p0' });
    expect(g.players[2].role).toBe('prince');
    goToVote(g);
    execute(g, 'p2');
    expect(g.princeSaved).toBeNull();
    expect(g.players[2].isAlive).toBe(false);
  });
});

describe('catatan rahasia ikut orangnya, bukan kartunya', () => {
  it('Seer asli tetap lihat hasilnya; pemegang kartu baru tidak dapat hasil lama', () => {
    const g = gameWith(['seer', 'werewolf', 'troublemaker', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    to(g, 'seer'); commitStep(g, { target: 'p1' });
    to(g, 'troublemaker'); commitStep(g, { swap: ['p0', 'p3'] });
    const r = roomOf(g);
    expect(buildPrivateView(r, 'u0').seerHistory).toEqual([{ night: 1, pid: 'p1', isWolf: true }]);
    expect(buildPrivateView(r, 'u3').seerHistory).toEqual([]);
  });

  it('korban tukar pertama tetap dapat catatan setelah tukar kedua; perannya = peran sekarang', () => {
    const g = gameWith(['troublemaker', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    to(g, 'troublemaker'); commitStep(g, { swap: ['p2', 'p3'] });
    goToVote(g); execute(g, null); finishDay(g);
    to(g, 'troublemaker'); commitStep(g, { swap: ['p4', 'p5'] });
    const r = roomOf(g);
    expect(buildPrivateView(r, 'u2').troublemaker).toEqual({ newRole: 'villager', night: 1 });
    expect(buildPrivateView(r, 'u3').troublemaker).toEqual({ newRole: 'seer', night: 1 });
    expect(buildPrivateView(r, 'u0').troublemaker).toEqual({ swapped: ['p4', 'p5'], night: 2, left: 0 });
  });
});

describe('Diseased dan tukar kartu di malam yang sama', () => {
  it('Diseased yang digigit lalu kartunya ditukar tetap menulari serigala pilihannya', () => {
    const g = gameWith(['diseased', 'werewolf', 'troublemaker', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p0' });
    commitStep(g, { swap: ['p0', 'p3'] });
    expect(currentStep(g)?.role).toBe('diseased');
    commitStep(g, { target: 'p1' });
    expect(g.players[1].isAlive).toBe(false);
    expect(g.lastDeaths.map((d) => d.cause).sort()).toEqual(['disease', 'wolves']);
  });
});

describe('pengumuman pagi', () => {
  it('tidak membacakan mantra untuk pemain yang mati malam itu; urutan teks sama dengan klip', () => {
    const g = gameWith(['spellcaster', 'werewolf', 'thief', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p3' });
    commitStep(g, { spell: { target: 'p3', mode: 'mute' } });
    commitStep(g, { target: 'p4' });
    const text = morningAnnouncement(g);
    expect(text).not.toContain('dibungkam');
    expect(text.endsWith(THIEF_NOTICE)).toBe(true);
    const morning = narrationFor(g)!.lines.find((l) => l.text === text)!;
    expect(morning.clips).not.toContain('spell_mute');
    expect(morning.clips[morning.clips.length - 1]).toBe('thief_swap');
  });
});

describe('aksi pemain', () => {
  it('pesan galat hilang sendiri dan terhapus oleh aksi sah berikutnya', () => {
    const g = gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    const r = roomOf(g);
    applyPlayerAction(r, 'u2', { type: 'vote', target: 'p0' }, Math.random, 1000);
    expect(buildPrivateView(r, 'u2', 1000).notice).toBeTruthy();
    expect(buildPrivateView(r, 'u2', 1000 + NOTICE_MS + 1).notice).toBeUndefined();
    applyPlayerAction(r, 'u0', { type: 'vote', target: 'p1' }, Math.random, 1000);
    expect(r.notices.u0).toBeTruthy();
    applyPlayerAction(r, 'u0', { type: 'wolfVote', target: 'p1' }, Math.random, 1200);
    expect(r.notices.u0).toBeUndefined();
  });

  it('saat dijeda, aksi permainan ditolak', () => {
    const g = gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    const r = roomOf(g, { auto: newAutoState(), autoNarrator: true });
    setPaused(g, r.auto!, true, 0);
    applyPlayerAction(r, 'u0', { type: 'wolfVote', target: 'p1' });
    expect(g.wolfVotes).toEqual({});
    expect(r.notices.u0?.text).toContain('dijeda');
  });

  it('pemain di perangkat baru bisa kembali ke kursinya setelah disetujui host', () => {
    const g = gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    const r = roomOf(g);
    applyPlayerAction(r, 'baru', { type: 'reclaim', pid: 'p1' });
    expect(buildPrivateView(r, 'baru')).toMatchObject({ joined: false, reclaiming: 'p1' });
    resolveReclaim(r, 'baru', true);
    expect(buildPrivateView(r, 'baru')).toMatchObject({ joined: true, pid: 'p1', role: 'seer' });
    expect(buildPrivateView(r, 'u1').joined).toBe(false);
  });
});

describe('bip timer', () => {
  it('dua layar di HP yang sama tidak membuat bip dobel', () => {
    const played: string[] = [];
    const b = createBeeper();
    b.attachVoice({ sfx: (src: string) => { played.push(src); return true; } } as unknown as Voice);
    // Layar host tanpa timer (null) dan layar pemain host dengan timer, bergantian dalam detik yang sama
    for (let i = 0; i < 4; i++) { b.update(5.5, 'player'); b.update(null, 'host'); }
    expect(played.length).toBe(1);
    b.update(4.5, 'player');
    expect(played.length).toBe(2);
  });
});
