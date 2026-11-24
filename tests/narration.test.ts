import { describe, expect, it } from 'vitest';
import { beginFirstRound, commitStep, execute, finishDay, goToDiscussion, goToVote, hunterShoots } from '../src/game/engine';
import { HUNTER_SCRIPT, MORNING_COMES, narrationFor, NIGHT_FALLS, VOTE_SCRIPT } from '../src/game/narration';
import { WAKE_SCRIPT } from '../src/game/roles';
import { gameWith, id } from './helpers';

describe('narasi voice-over', () => {
  it('malam: langkah pertama "malam tiba", lalu "tidur" peran sebelumnya + "bangun" peran berikutnya', () => {
    const g = gameWith(['werewolf', 'seer', 'bodyguard', 'villager', 'villager']);
    beginFirstRound(g);
    const first = narrationFor(g)!;
    expect(first.lines).toEqual([NIGHT_FALLS, WAKE_SCRIPT.bodyguard]);
    commitStep(g, { target: id(g, 'villager') });
    const second = narrationFor(g)!;
    expect(second.key).not.toBe(first.key);
    expect(second.lines).toEqual(['Pengawal, tidurlah kembali.', WAKE_SCRIPT.werewolf]);
  });

  it('pagi: mengumumkan korban, lalu memanggil Pemburu (append-only, key tetap)', () => {
    const g = gameWith(['werewolf', 'hunter', 'villager', 'villager', 'villager', 'werewolf', 'villager']);
    beginFirstRound(g);
    while (g.phase === 'night') commitStep(g, { target: id(g, 'hunter') });
    expect(g.phase).toBe('morning');
    const m = narrationFor(g)!;
    expect(m.lines).toContain(MORNING_COMES);
    expect(m.lines[m.lines.length - 1]).toBe(HUNTER_SCRIPT);
    hunterShoots(g, id(g, 'werewolf'));
    const after = narrationFor(g)!;
    expect(after.key).toBe(m.key);
    expect(after.lines.slice(0, m.lines.length)).toEqual(m.lines);
    expect(after.lines.length).toBeGreaterThan(m.lines.length);
  });

  it('voting lalu hasil eksekusi', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false });
    beginFirstRound(g);
    goToVote(g);
    expect(narrationFor(g)!.lines).toEqual([VOTE_SCRIPT]);
    execute(g, id(g, 'villager'));
    expect(narrationFor(g)!.lines[0]).toMatch(/Pemain \d, dieksekusi warga/);
  });

  it('akhir permainan membacakan pemenang', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    if (g.phase === 'day') goToDiscussion(g);
    if (g.phase !== 'vote') goToVote(g);
    execute(g, id(g, 'werewolf'));
    finishDay(g);
    expect(g.winner?.kind ?? null).toBe('village');
    expect(narrationFor(g)?.lines[0] ?? '').toMatch(/Desa Menang/);
  });
});
