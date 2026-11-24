import { describe, expect, it } from 'vitest';
import { beginFirstRound, commitStep, currentStep, morningAnnouncement, startNight, TROUBLEMAKER_NOTICE } from '../src/game/engine';
import { narrationFor } from '../src/game/narration';
import { buildPrivateView, buildPublicView, type Room } from '../src/game/room';
import { VOICE_CLIPS } from '../src/game/voiceLines';
import type { GameState } from '../src/game/engine';
import { gameWith } from './helpers';

function toRole(g: GameState, role: string) {
  while (currentStep(g)?.role !== role) commitStep(g, {});
}

const roomOf = (g: GameState) => ({
  code: 'X', seats: g.players.map((p, i) => ({ uid: `u${i}`, pid: p.id, name: p.name })),
  game: g, notices: {}, auto: null,
} as unknown as Room);

describe('Troublemaker', () => {
  it('bangun setelah Thief di malam 1, tidak muncul lagi di malam berikutnya', () => {
    const g = gameWith(['troublemaker', 'thief', 'werewolf', 'seer', 'villager']);
    beginFirstRound(g);
    expect(g.nightSteps.map((s) => s.role)).toEqual(['werewolf', 'seer', 'thief', 'troublemaker']);
    g.phase = 'day';
    startNight(g);
    expect(g.nightSteps.some((s) => s.role === 'troublemaker')).toBe(false);
  });

  it('peran asli beraksi malam 1; kartu ditukar saat pagi, Troublemaker tetap Troublemaker', () => {
    const g = gameWith(['troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p3' }); // serigala
    commitStep(g, { target: 'p2' }); // Seer asli menerawang
    expect(g.seerHistory[0].targetId).toBe('p2');
    expect(currentStep(g)?.role).toBe('troublemaker');
    commitStep(g, { swap: ['p1', 'p2'] });
    expect(g.phase).toBe('morning');
    expect(g.players.map((p) => p.role)).toEqual(['troublemaker', 'werewolf', 'seer', 'villager', 'villager']);
    expect(g.players[3].isAlive).toBe(false);
  });

  it('korban tahu peran barunya tanpa tahu pelakunya; Troublemaker tidak melihat kartu', () => {
    const g = gameWith(['troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toRole(g, 'troublemaker');
    commitStep(g, { swap: ['p1', 'p2'] });
    const room = roomOf(g);
    expect(buildPrivateView(room, 'u0').troublemaker).toEqual({ swapped: ['p1', 'p2'] });
    expect(buildPrivateView(room, 'u1').troublemaker).toEqual({ newRole: 'werewolf' });
    expect(buildPrivateView(room, 'u2').troublemaker).toEqual({ newRole: 'seer' });
    expect(buildPrivateView(room, 'u3').troublemaker).toBeUndefined();
    expect(JSON.stringify(buildPrivateView(room, 'u1'))).not.toContain('p0');
    expect(buildPublicView(room).cardsSwapped).toBe(true);
  });

  it('Thief dulu, baru Troublemaker: kartu curian ikut ditukar', () => {
    const g = gameWith(['thief', 'troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toRole(g, 'thief');
    commitStep(g, { target: 'p2' }); // Thief mencuri Seer, p2 jadi Villager
    commitStep(g, { swap: ['p0', 'p3'] }); // tukar Thief (sekarang Seer) dengan Werewolf
    expect(g.players.map((p) => p.role)).toEqual(['werewolf', 'troublemaker', 'villager', 'seer', 'villager', 'villager']);
    const room = roomOf(g);
    expect(buildPrivateView(room, 'u0').troublemaker).toEqual({ newRole: 'werewolf' });
    expect(buildPrivateView(room, 'u3').troublemaker).toEqual({ newRole: 'seer' });
  });

  it('tidak menukar = tidak ada pengumuman', () => {
    const g = gameWith(['troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    while (g.phase === 'night') commitStep(g, {});
    expect(g.troublemakerSwap).toBeNull();
    expect(morningAnnouncement(g)).not.toContain(TROUBLEMAKER_NOTICE);
  });

  it('tidak boleh menukar diri sendiri atau orang yang sama dua kali', () => {
    const g = gameWith(['troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toRole(g, 'troublemaker');
    expect(() => commitStep(g, { swap: ['p0', 'p1'] })).toThrow();
    expect(() => commitStep(g, { swap: ['p1', 'p1'] })).toThrow();
  });

  it('pagi setelah tukar semua diberi tahu (tanpa nama), lengkap dengan clip', () => {
    const g = gameWith(['troublemaker', 'seer', 'werewolf', 'villager', 'villager']);
    beginFirstRound(g);
    toRole(g, 'troublemaker');
    commitStep(g, { swap: ['p1', 'p2'] });
    expect(morningAnnouncement(g)).toContain(TROUBLEMAKER_NOTICE);
    const clips = narrationFor(g)!.lines.flatMap((l) => l.clips);
    expect(clips).toContain('troublemaker_swap');
    expect(VOICE_CLIPS.troublemaker_swap).toBe(TROUBLEMAKER_NOTICE);
    expect(VOICE_CLIPS.wake_troublemaker).toBeTruthy();
  });
});
