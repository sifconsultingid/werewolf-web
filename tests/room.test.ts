import { describe, expect, it } from 'vitest';
import { beginFirstRound, currentStep } from '../src/game/engine';
import {
  applyPlayerAction, backToLobby, buildPrivateView, buildPublicView, createRoom, startGame, type Room,
} from '../src/game/room';
import type { Role } from '../src/game/roles';
import { seeded } from './helpers';

function lobby(n: number): Room {
  const room = createRoom('TEST1', n);
  for (let i = 0; i < n; i++) applyPlayerAction(room, `uid${i}`, { type: 'join', name: `Pemain ${i + 1}` }, seeded(i + 1));
  return room;
}

/** Mulai permainan lalu paksa peran sesuai urutan kursi. */
function started(roles: Role[]): Room {
  const room = lobby(roles.length);
  room.autoCounts = false;
  room.counts = {};
  for (const r of roles) room.counts[r] = (room.counts[r] ?? 0) + 1;
  startGame(room, seeded(7));
  room.game!.players.forEach((p, i) => { p.role = roles[i]; });
  return room;
}

const pidOf = (room: Room, i: number) => room.seats[i].pid;

describe('ruang & lobi', () => {
  it('pemain masuk, nama kembar diberi nomor, komposisi otomatis mengikuti jumlah pemain', () => {
    const room = createRoom('ABCDE', 8);
    applyPlayerAction(room, 'u1', { type: 'join', name: '  Budi  ' });
    applyPlayerAction(room, 'u2', { type: 'join', name: 'budi' });
    expect(room.seats.map((s) => s.name)).toEqual(['Budi', 'budi 2']);
    for (let i = 3; i <= 6; i++) applyPlayerAction(room, `u${i}`, { type: 'join', name: `P${i}` });
    expect(Object.values(room.counts).reduce((a, b) => a! + b!, 0)).toBe(6);
  });

  it('menolak nama kosong dan pemain baru setelah permainan dimulai', () => {
    const room = lobby(5);
    applyPlayerAction(room, 'x', { type: 'join', name: '   ' });
    expect(buildPrivateView(room, 'x').notice).toMatch(/kosong/);
    startGame(room, seeded(1));
    applyPlayerAction(room, 'late', { type: 'join', name: 'Telat' });
    expect(room.seats.length).toBe(5);
    expect(buildPrivateView(room, 'late').joined).toBe(false);
  });

  it('main lagi mempertahankan pemain', () => {
    const room = lobby(5);
    startGame(room, seeded(1));
    backToLobby(room);
    expect(room.game).toBeNull();
    expect(room.seats.length).toBe(5);
  });
});

describe('kerahasiaan tampilan', () => {
  it('tampilan publik tidak memuat peran pemain yang masih hidup', () => {
    const room = started(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    const pub = buildPublicView(room);
    expect(pub.seats.every((s) => s.role === undefined)).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/werewolf|seer/);
  });

  it('tiap pemain hanya melihat perannya sendiri; serigala melihat kawanannya', () => {
    const room = started(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    const wolf = buildPrivateView(room, 'uid0');
    expect(wolf.role).toBe('werewolf');
    expect(wolf.pack?.map((p) => p.pid)).toEqual([pidOf(room, 0), pidOf(room, 1)]);
    const seer = buildPrivateView(room, 'uid2');
    expect(seer.role).toBe('seer');
    expect(seer.pack).toBeUndefined();
    expect(JSON.stringify(seer)).not.toMatch(/werewolf/);
  });

  it('aksi malam hanya muncul untuk pemegang peran yang sedang bangun', () => {
    const room = started(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(room.game!);
    expect(currentStep(room.game!)?.role).toBe('werewolf');
    expect(buildPrivateView(room, 'uid0').action?.kind).toBe('werewolf');
    expect(buildPrivateView(room, 'uid2').action).toBeNull();
    // Peramal mencoba beraksi di luar gilirannya → ditolak
    applyPlayerAction(room, 'uid2', { type: 'peek', target: pidOf(room, 0) });
    expect(room.game!.seerHistory).toEqual([]);
    expect(buildPrivateView(room, 'uid2').notice).toMatch(/Bukan giliranmu/);
  });

  it('serigala harus sepakat; setelah sepakat langkah berikutnya dimulai', () => {
    const room = started(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(room.game!);
    applyPlayerAction(room, 'uid0', { type: 'wolfVote', target: pidOf(room, 3) });
    applyPlayerAction(room, 'uid1', { type: 'wolfVote', target: pidOf(room, 4) });
    expect(currentStep(room.game!)?.role).toBe('werewolf');
    expect(buildPrivateView(room, 'uid1').wolfVotes).toEqual({ [pidOf(room, 0)]: pidOf(room, 3), [pidOf(room, 1)]: pidOf(room, 4) });
    applyPlayerAction(room, 'uid1', { type: 'wolfVote', target: pidOf(room, 3) });
    expect(currentStep(room.game!)?.role).toBe('seer');
    expect(room.game!.wolfTarget).toBe(pidOf(room, 3));
  });

  it('Peramal melihat hasil dulu, lalu tidur kembali; malam berakhir', () => {
    const room = started(['werewolf', 'seer', 'lycan', 'villager', 'villager']);
    beginFirstRound(room.game!);
    applyPlayerAction(room, 'uid0', { type: 'wolfVote', target: pidOf(room, 3) });
    applyPlayerAction(room, 'uid1', { type: 'peek', target: pidOf(room, 2) });
    expect(buildPrivateView(room, 'uid1').action?.peeked).toEqual({ pid: pidOf(room, 2), isWolf: true });
    expect(room.game!.phase).toBe('night');
    applyPlayerAction(room, 'uid1', { type: 'night', input: {} });
    expect(room.game!.phase).toBe('morning');
    const pub = buildPublicView(room);
    expect(pub.lastDeaths).toEqual([{ pid: pidOf(room, 3), cause: 'wolves', role: 'villager' }]);
    expect(pub.announcement).toMatch(/Pemain 4, dimangsa serigala/);
  });

  it('voting: hanya pemain yang boleh memilih, suara terlihat publik', () => {
    const room = started(['werewolf', 'villager', 'villager', 'villager', 'villager']);
    room.game!.settings.startWithNight = false;
    room.game!.settings.skipDiscussion = true;
    beginFirstRound(room.game!);
    applyPlayerAction(room, 'uid1', { type: 'vote', target: pidOf(room, 0) });
    applyPlayerAction(room, 'stranger', { type: 'vote', target: pidOf(room, 0) });
    expect(buildPublicView(room).tally).toEqual({ [pidOf(room, 0)]: 1 });
  });

  it('peran pemain mati disembunyikan jika pengaturannya mati, kecuali Si Penyamak yang dieksekusi', () => {
    const room = started(['werewolf', 'tanner', 'villager', 'villager', 'villager']);
    room.game!.settings.revealRoleOnDeath = false;
    room.game!.players[2].isAlive = false;
    expect(buildPublicView(room).seats[2].role).toBeUndefined();
  });
});
