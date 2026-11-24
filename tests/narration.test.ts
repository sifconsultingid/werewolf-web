import { describe, expect, it } from 'vitest';
import { beginFirstRound, commitStep, execute, finishDay, goToDiscussion, goToVote, hunterShoots } from '../src/game/engine';
import { HUNTER_SCRIPT, MORNING_COMES, narrationFor, NIGHT_FALLS, VOTE_SCRIPT } from '../src/game/narration';
import { WAKE_SCRIPT } from '../src/game/roles';
import { VOICE_CLIPS } from '../src/game/voiceLines';

const texts = (n: ReturnType<typeof narrationFor>) => n!.lines.map((l) => l.text);
const clipsOf = (n: ReturnType<typeof narrationFor>) => n!.lines.flatMap((l) => l.clips);
import { gameWith, id } from './helpers';

describe('narasi voice-over', () => {
  it('malam: langkah pertama "malam tiba", lalu "tidur" peran sebelumnya + "bangun" peran berikutnya', () => {
    const g = gameWith(['werewolf', 'seer', 'bodyguard', 'villager', 'villager']);
    beginFirstRound(g);
    const first = narrationFor(g)!;
    expect(texts(first)).toEqual([NIGHT_FALLS, WAKE_SCRIPT.bodyguard]);
    expect(clipsOf(first)).toEqual(['night_falls', 'wake_bodyguard']);
    commitStep(g, { target: id(g, 'villager') });
    const second = narrationFor(g)!;
    expect(second.key).not.toBe(first.key);
    expect(texts(second)).toEqual(['Pengawal, tidurlah kembali.', WAKE_SCRIPT.werewolf]);
  });

  it('pagi: mengumumkan korban, lalu memanggil Pemburu (append-only, key tetap)', () => {
    const g = gameWith(['werewolf', 'hunter', 'villager', 'villager', 'villager', 'werewolf', 'villager']);
    beginFirstRound(g);
    while (g.phase === 'night') commitStep(g, { target: id(g, 'hunter') });
    expect(g.phase).toBe('morning');
    const m = narrationFor(g)!;
    expect(texts(m)).toContain(MORNING_COMES);
    expect(clipsOf(m)).toContain('death_wolves');
    expect(clipsOf(m)).toContain('role_hunter');
    expect(texts(m)[m.lines.length - 1]).toBe(HUNTER_SCRIPT);
    hunterShoots(g, id(g, 'werewolf'));
    const after = narrationFor(g)!;
    expect(after.key).toBe(m.key);
    expect(texts(after).slice(0, m.lines.length)).toEqual(texts(m));
    expect(after.lines.length).toBeGreaterThan(m.lines.length);
  });

  it('voting lalu hasil eksekusi', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false });
    beginFirstRound(g);
    goToVote(g);
    expect(texts(narrationFor(g))).toEqual([VOTE_SCRIPT]);
    execute(g, id(g, 'villager'));
    expect(texts(narrationFor(g))[0]).toMatch(/Pemain \d, dieksekusi warga/);
    expect(clipsOf(narrationFor(g))).toEqual(['death_vote', 'role_villager']);
  });

  it('akhir permainan membacakan pemenang', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    if (g.phase === 'day') goToDiscussion(g);
    if (g.phase !== 'vote') goToVote(g);
    execute(g, id(g, 'werewolf'));
    finishDay(g);
    expect(g.winner?.kind ?? null).toBe('village');
    expect(texts(narrationFor(g))[0]).toMatch(/Desa Menang/);
    expect(clipsOf(narrationFor(g))).toEqual(['win_village']);
  });

  it('semua klip yang dipakai ada di katalog rekaman', () => {
    const g = gameWith(['werewolf', 'hunter', 'seer', 'bodyguard', 'witch', 'cupid', 'villager', 'werewolf']);
    beginFirstRound(g);
    const used = new Set<string>();
    while (g.phase === 'night') { clipsOf(narrationFor(g)).forEach((c) => used.add(c)); commitStep(g, {}, Date.now(), true); }
    clipsOf(narrationFor(g)).forEach((c) => used.add(c));
    for (const c of used) expect(VOICE_CLIPS[c], c).toBeTruthy();
    expect(Object.keys(VOICE_CLIPS).length).toBeGreaterThan(50);
  });
});
