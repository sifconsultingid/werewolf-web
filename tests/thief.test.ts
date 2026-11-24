import { describe, expect, it } from 'vitest';
import { beginFirstRound, commitStep, currentStep, startNight } from '../src/game/engine';
import { buildPrivateView, type Room } from '../src/game/room';
import { gameWith } from './helpers';

describe('Pencuri', () => {
  it('bangun pertama di malam 1 dan tidak muncul lagi di malam berikutnya', () => {
    const g = gameWith(['thief', 'cupid', 'werewolf', 'seer', 'villager']);
    beginFirstRound(g);
    expect(g.nightSteps.map((s) => s.role)).toEqual(['thief', 'cupid', 'werewolf', 'seer']);
    g.phase = 'day';
    startNight(g);
    expect(g.nightSteps.some((s) => s.role === 'thief')).toBe(false);
  });

  it('mencuri kartu: Pencuri jadi peran target, target jadi Warga Desa, dan peran curian beraksi malam itu', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p1' });
    expect(g.players[0].role).toBe('seer');
    expect(g.players[1].role).toBe('villager');
    expect(g.thiefSwap).toEqual({ thiefId: 'p0', targetId: 'p1', stolenRole: 'seer' });
    commitStep(g, { target: 'p3' }); // serigala
    expect(currentStep(g)?.role).toBe('seer');
    expect(currentStep(g)?.active).toBe(true);
  });

  it('mencuri Werewolf memindahkan Pencuri ke kawanan', () => {
    const g = gameWith(['thief', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'seer']);
    beginFirstRound(g);
    commitStep(g, { target: 'p1' });
    expect(g.players.filter((p) => p.role === 'werewolf').map((p) => p.id).sort()).toEqual(['p0', 'p2']);
  });

  it('tidak mencuri = tetap Pencuri (warga biasa)', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, {});
    expect(g.players[0].role).toBe('thief');
    expect(g.thiefSwap).toBeNull();
  });

  it('tidak boleh mencuri diri sendiri', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    expect(() => commitStep(g, { target: 'p0' })).toThrow();
  });

  it('korban diberi tahu kartunya dicuri tanpa tahu siapa Pencurinya', () => {
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p1' });
    const room = {
      code: 'X', seats: g.players.map((p, i) => ({ uid: `u${i}`, pid: p.id, name: p.name })),
      game: g, notices: {}, auto: null,
    } as unknown as Room;
    const thief = buildPrivateView(room, 'u0');
    const victim = buildPrivateView(room, 'u1');
    expect(thief.thief).toEqual({ stole: true, otherPid: 'p1', stolenRole: 'seer' });
    expect(victim.role).toBe('villager');
    expect(victim.thief).toEqual({ stole: false, otherPid: undefined, stolenRole: 'seer' });
  });
});

describe('Pengumuman curian', () => {
  it('pagi setelah malam 1 semua diberi tahu ada kartu dicuri (tanpa nama), lengkap dengan clip', async () => {
    const { morningAnnouncement, THIEF_NOTICE } = await import('../src/game/engine');
    const { narrationFor } = await import('../src/game/narration');
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p1' });
    while (g.phase === 'night') commitStep(g, {});
    expect(morningAnnouncement(g)).toContain(THIEF_NOTICE);
    expect(narrationFor(g)!.lines.flatMap((l) => l.clips)).toContain('thief_swap');
  });

  it('tidak ada pengumuman kalau Pencuri tidak mencuri', async () => {
    const { morningAnnouncement, THIEF_NOTICE } = await import('../src/game/engine');
    const g = gameWith(['thief', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    while (g.phase === 'night') commitStep(g, {});
    expect(morningAnnouncement(g)).not.toContain(THIEF_NOTICE);
  });
});
