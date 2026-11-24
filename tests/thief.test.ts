import { describe, expect, it } from 'vitest';
import { beginFirstRound, commitStep, currentStep, morningAnnouncement, startNight, THIEF_NOTICE } from '../src/game/engine';
import { narrationFor } from '../src/game/narration';
import { buildPrivateView, type Room } from '../src/game/room';
import type { GameState } from '../src/game/engine';
import { gameWith } from './helpers';

/** Jalankan langkah malam sampai giliran Thief. */
function toThief(g: GameState) {
  while (currentStep(g)?.role !== 'thief') commitStep(g, {});
}

const roomOf = (g: GameState) => ({
  code: 'X', seats: g.players.map((p, i) => ({ uid: `u${i}`, pid: p.id, name: p.name })),
  game: g, notices: {}, auto: null,
} as unknown as Room);

describe('Thief', () => {
  it('bangun paling akhir di malam 1 dan tidak muncul lagi di malam berikutnya', () => {
    const g = gameWith(['thief', 'cupid', 'werewolf', 'seer', 'villager']);
    beginFirstRound(g);
    expect(g.nightSteps.map((s) => s.role)).toEqual(['cupid', 'werewolf', 'seer', 'thief']);
    g.phase = 'day';
    startNight(g);
    expect(g.nightSteps.some((s) => s.role === 'thief')).toBe(false);
  });

  it('peran asli tetap beraksi malam 1; kartu baru ditukar saat pagi', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p3' }); // serigala
    expect(currentStep(g)?.role).toBe('seer');
    commitStep(g, { target: 'p2' }); // Seer asli (p1) menerawang
    expect(g.seerHistory[0].targetId).toBe('p2');
    commitStep(g, { target: 'p1' }); // Thief mencuri kartu Seer
    expect(g.phase).toBe('morning');
    expect(g.players[0].role).toBe('seer');
    expect(g.players[1].role).toBe('villager');
    expect(g.thiefSwap).toMatchObject({ thiefId: 'p0', targetId: 'p1', stolenRole: 'seer', applied: true });
  });

  it('pagi: Thief tahu curiannya; korban tahu kartunya dicuri tanpa tahu siapa Thiefnya', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toThief(g);
    commitStep(g, { target: 'p1' });
    const room = roomOf(g);
    expect(buildPrivateView(room, 'u0').thief).toEqual({ stole: true, otherPid: 'p1', stolenRole: 'seer' });
    const victim = buildPrivateView(room, 'u1');
    expect(victim.role).toBe('villager');
    expect(victim.thief).toEqual({ stole: false, otherPid: undefined, stolenRole: 'seer' });
  });

  it('mencuri Werewolf: serigala asli ikut memangsa malam 1, Thief jadi serigala mulai pagi', () => {
    const g = gameWith(['thief', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer']);
    beginFirstRound(g);
    commitStep(g, { target: 'p3' });
    toThief(g);
    commitStep(g, { target: 'p1' });
    expect(g.players.filter((p) => p.role === 'werewolf').map((p) => p.id).sort()).toEqual(['p0', 'p2']);
    expect(g.players[3].isAlive).toBe(false);
  });

  it('tidak mencuri = tetap Thief (warga biasa), tanpa pengumuman', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    while (g.phase === 'night') commitStep(g, {});
    expect(g.players[0].role).toBe('thief');
    expect(g.thiefSwap).toBeNull();
    expect(morningAnnouncement(g)).not.toContain(THIEF_NOTICE);
  });

  it('tidak boleh mencuri diri sendiri', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toThief(g);
    expect(() => commitStep(g, { target: 'p0' })).toThrow();
  });

  it('pagi setelah curian semua diberi tahu (tanpa nama), lengkap dengan clip', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toThief(g);
    commitStep(g, { target: 'p1' });
    expect(morningAnnouncement(g)).toContain(THIEF_NOTICE);
    expect(narrationFor(g)!.lines.flatMap((l) => l.clips)).toContain('thief_swap');
  });
});
