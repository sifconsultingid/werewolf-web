import { describe, expect, it } from 'vitest';
import {
  autoAssignRoles, balanceScore, beginFirstRound, castVote, commitStep, computeWinner, createGame,
  currentStep, eligibleVoters, execute, finishDay, goToDiscussion, goToVote, hunterShoots,
  MAX_PLAYERS, MIN_PLAYERS, morningAnnouncement, nearestWerewolves, setupError, startNight,
  totalRoles, voteLeaders, votes,
} from '../src/game/engine';
import { ROLES, ROLE_INFO } from '../src/game/roles';
import { gameWith, seeded } from './helpers';

describe('setup', () => {
  it('komposisi otomatis selalu sah untuk 4–24 pemain', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const c = autoAssignRoles(n);
      expect(totalRoles(c)).toBe(n);
      expect(setupError(n, c)).toBeNull();
    }
  });

  it('komposisi otomatis sama dengan versi iOS (contoh 8 & 12 pemain)', () => {
    expect(autoAssignRoles(8)).toEqual({ werewolf: 2, seer: 1, bodyguard: 1, hunter: 1, villager: 3 });
    const c12 = autoAssignRoles(12);
    expect(c12.werewolf).toBe(3);
    expect(c12.prince).toBe(1);
    expect(balanceScore(c12)).toBeLessThanOrEqual(4);
  });

  it('menolak komposisi tidak sah', () => {
    expect(setupError(3, { werewolf: 1, villager: 2 })).toMatch(/Minimal 4/);
    expect(setupError(5, { werewolf: 1, villager: 3 })).toMatch(/harus sama/);
    expect(setupError(5, { villager: 5 })).toMatch(/1 Werewolf/);
    expect(setupError(6, { werewolf: 3, villager: 3 })).toMatch(/Terlalu banyak/);
    expect(setupError(6, { werewolf: 1, seer: 2, villager: 3 })).toMatch(/hanya boleh satu/);
  });

  it('pengacakan membagi tepat sesuai komposisi', () => {
    const counts = autoAssignRoles(10);
    const seats = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: '' }));
    const g = createGame(seats, counts, undefined, seeded(42));
    for (const r of ROLES) expect(g.players.filter((p) => p.role === r).length).toBe(counts[r] ?? 0);
    expect(g.players[3].name).toBe('Pemain 4');
    expect(g.phase).toBe('reveal');
  });
});

describe('malam', () => {
  it('urutan bangun sama dengan iOS dan Cupid hanya malam pertama', () => {
    const g = gameWith(['werewolf', 'cupid', 'seer', 'bodyguard', 'witch', 'necromancer', 'spellcaster', 'insomniac', 'villager', 'villager', 'hunter', 'werewolf']);
    beginFirstRound(g);
    expect(g.nightSteps.map((s) => s.role)).toEqual(['cupid', 'bodyguard', 'werewolf', 'witch', 'necromancer', 'spellcaster', 'seer', 'insomniac']);
    startNight(g);
    expect(g.nightSteps[0].role).toBe('bodyguard');
  });

  it('peran yang pemegangnya mati tetap dipanggil tapi tidak aktif', () => {
    const g = gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']);
    g.players[1].isAlive = false;
    startNight(g);
    expect(g.nightSteps.find((s) => s.role === 'seer')?.active).toBe(false);
  });

  it('serigala memangsa; pengawal melindungi; tidak boleh lindungi orang sama 2 malam', () => {
    const g = gameWith(['werewolf', 'bodyguard', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' }); // pengawal
    commitStep(g, { target: 'p2' }); // serigala
    expect(g.phase).toBe('morning');
    expect(g.lastDeaths).toEqual([]);
    expect(morningAnnouncement(g)).toMatch(/Malam yang damai/);
    goToDiscussion(g);
    goToVote(g);
    execute(g, null);
    finishDay(g);
    expect(() => commitStep(g, { target: 'p2' })).toThrow();
    commitStep(g, { target: 'p1' });
    commitStep(g, { target: 'p2' });
    expect(g.lastDeaths).toEqual([{ playerId: 'p2', cause: 'wolves' }]);
  });

  it('serigala tidak boleh memangsa sesama serigala', () => {
    const g = gameWith(['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    expect(() => commitStep(g, { target: 'p1' })).toThrow();
  });

  it('Witch menyembuhkan & meracun, masing-masing sekali', () => {
    const g = gameWith(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' });
    commitStep(g, { heal: true, poison: 'p0' });
    expect(g.lastDeaths).toEqual([{ playerId: 'p0', cause: 'poison' }]);
    expect(g.witchHealUsed && g.witchPoisonUsed).toBe(true);
    expect(computeWinner(g)).toEqual({ kind: 'village' });
  });

  it('Witch tidak bisa menyembuhkan lagi setelah dipakai', () => {
    const g = gameWith(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager', 'werewolf']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' });
    commitStep(g, { heal: true });
    goToDiscussion(g); goToVote(g); execute(g, null); finishDay(g);
    commitStep(g, { target: 'p3' });
    commitStep(g, { heal: true });
    expect(g.lastDeaths).toEqual([{ playerId: 'p3', cause: 'wolves' }]);
  });

  it('Diseased dibangunkan hanya jika dimangsa, lalu menulari satu serigala', () => {
    const g = gameWith(['werewolf', 'werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' }); // serigala memangsa Diseased
    expect(currentStep(g)?.role).toBe('seer');
    commitStep(g, { target: 'p0' }); // peramal → langkah terakhir → Diseased disisipkan
    expect(currentStep(g)?.role).toBe('diseased');
    expect(() => commitStep(g, { target: 'p3' })).toThrow(); // harus serigala
    commitStep(g, { target: 'p1' });
    expect(g.lastDeaths.map((d) => [d.playerId, d.cause])).toEqual([['p2', 'wolves'], ['p1', 'disease']]);
    expect(g.seerHistory).toMatchObject([{ night: 1, targetId: 'p0', isWolf: true }]);
  });

  it('Diseased tidak dibangunkan jika dilindungi', () => {
    const g = gameWith(['werewolf', 'bodyguard', 'diseased', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' });
    commitStep(g, { target: 'p2' });
    expect(g.phase).toBe('morning');
    expect(g.nightSteps.some((s) => s.role === 'diseased')).toBe(false);
  });

  it('Lycan terlihat sebagai werewolf oleh peramal', () => {
    const g = gameWith(['werewolf', 'seer', 'lycan', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p3' });
    commitStep(g, { target: 'p2' });
    expect(g.seerHistory[0].isWolf).toBe(true);
    expect(ROLE_INFO.lycan.team).toBe('village');
  });

  it('Necromancer membangkitkan sekali', () => {
    const g = gameWith(['werewolf', 'necromancer', 'villager', 'villager', 'villager', 'villager', 'werewolf']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' });
    commitStep(g, { revive: null });
    expect(g.players[2].isAlive).toBe(false);
    goToDiscussion(g); goToVote(g); execute(g, null); finishDay(g);
    commitStep(g, { target: 'p3' });
    commitStep(g, { revive: 'p2' });
    expect(g.players[2].isAlive).toBe(true);
    expect(g.lastRevived).toBe('p2');
    expect(morningAnnouncement(g)).toMatch(/bangkit kembali/);
    goToDiscussion(g); goToVote(g); execute(g, null); finishDay(g);
    commitStep(g, { target: 'p4' });
    expect(() => commitStep(g, { revive: 'p3' })).toThrow();
  });

  it('Spellcaster melarang voting', () => {
    const g = gameWith(['werewolf', 'spellcaster', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    commitStep(g, { target: 'p2' });
    commitStep(g, { spell: { target: 'p3', mode: 'noVote' } });
    goToDiscussion(g); goToVote(g);
    expect(eligibleVoters(g).map((p) => p.id)).not.toContain('p3');
    expect(() => castVote(g, 'p3', 'p0')).toThrow();
  });

  it('Insomniac melihat werewolf terdekat (urutan duduk melingkar)', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'insomniac', 'villager', 'villager', 'werewolf']);
    expect(nearestWerewolves(g, 'p3').sort()).toEqual(['p0', 'p6']);
    g.players[6].isAlive = false;
    expect(nearestWerewolves(g, 'p3')).toEqual(['p0']);
    const g2 = gameWith(['werewolf', 'villager', 'insomniac', 'villager', 'villager', 'villager', 'villager']);
    beginFirstRound(g2);
    commitStep(g2, { target: 'p1' });
    commitStep(g2, { walk: true });
    expect(g2.insomniacHistory).toMatchObject([{ night: 1, walked: true, nearestWolfIds: ['p0'] }]);
  });
});

describe('kekasih', () => {
  it('jika satu kekasih mati, yang lain ikut mati', () => {
    const g = gameWith(['werewolf', 'cupid', 'villager', 'villager', 'villager', 'villager', 'werewolf']);
    beginFirstRound(g);
    commitStep(g, { lovers: ['p2', 'p3'] });
    commitStep(g, { target: 'p2' });
    expect(g.lastDeaths).toEqual([
      { playerId: 'p2', cause: 'wolves' },
      { playerId: 'p3', cause: 'heartbreak' },
    ]);
  });

  it('kekasih beda tim menang jika tinggal berdua', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'cupid']);
    g.lovers = ['p0', 'p1'];
    g.players[2].isAlive = false;
    g.players[3].isAlive = false;
    expect(computeWinner(g)).toEqual({ kind: 'lovers' });
    // kekasih satu tim (keduanya desa) tidak memicu kemenangan cinta
    const g2 = gameWith(['werewolf', 'villager', 'villager', 'cupid']);
    g2.lovers = ['p1', 'p2'];
    g2.players[0].isAlive = false;
    g2.players[3].isAlive = false;
    expect(computeWinner(g2)).toEqual({ kind: 'village' });
  });

  it('Cupid harus memilih dua orang berbeda', () => {
    const g = gameWith(['werewolf', 'cupid', 'villager', 'villager', 'villager']);
    beginFirstRound(g);
    expect(() => commitStep(g, { lovers: ['p2', 'p2'] })).toThrow();
  });
});

describe('siang & voting', () => {
  it('satu pemain satu suara, bisa diganti & dibatalkan, tidak boleh memilih diri sendiri', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    expect(g.phase).toBe('vote');
    castVote(g, 'p1', 'p0');
    castVote(g, 'p2', 'p0');
    castVote(g, 'p3', 'p1');
    castVote(g, 'p3', 'p0'); // ganti
    castVote(g, 'p4', 'p4'); // diri sendiri = batal
    expect(votes(g)).toEqual({ p0: 3 });
    castVote(g, 'p2', null);
    expect(votes(g)).toEqual({ p0: 2 });
    expect(voteLeaders(g)).toEqual(['p0']);
  });

  it('suara seri menghasilkan lebih dari satu pemimpin', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    castVote(g, 'p1', 'p0');
    castVote(g, 'p0', 'p1');
    expect(voteLeaders(g).sort()).toEqual(['p0', 'p1']);
  });

  it('suara untuk pemain yang mati tidak dihitung', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    castVote(g, 'p1', 'p2');
    g.players[2].isAlive = false;
    expect(votes(g)).toEqual({});
  });

  it('Prince selamat dari eksekusi pertama saja', () => {
    const g = gameWith(['werewolf', 'prince', 'villager', 'villager', 'villager', 'villager', 'werewolf'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    execute(g, 'p1');
    expect(g.princeSaved).toBe('p1');
    expect(g.players[1].isAlive).toBe(true);
    finishDay(g);
    commitStep(g, { target: 'p2' });
    goToDiscussion(g);
    execute(g, 'p1');
    expect(g.players[1].isAlive).toBe(false);
  });

  it('Tanner menang jika dieksekusi', () => {
    const g = gameWith(['werewolf', 'tanner', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    execute(g, 'p1');
    finishDay(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toEqual({ kind: 'tanner', name: 'Pemain 2' });
  });

  it('Hunter menembak saat mati, dan harus menembak sebelum lanjut', () => {
    const g = gameWith(['werewolf', 'hunter', 'villager', 'villager', 'villager', 'villager', 'werewolf']);
    beginFirstRound(g);
    commitStep(g, { target: 'p1' });
    expect(g.pendingHunters).toEqual(['p1']);
    expect(() => goToDiscussion(g)).toThrow();
    expect(() => hunterShoots(g, 'p1')).toThrow(); // sudah mati
    hunterShoots(g, 'p0');
    expect(g.hunterDeaths).toEqual([{ playerId: 'p0', cause: 'hunter' }]);
    expect(g.pendingHunters).toEqual([]);
    goToDiscussion(g);
    expect(g.phase).toBe('day');
  });

  it('serigala menang jika jumlahnya ≥ sisa pemain', () => {
    const g = gameWith(['werewolf', 'villager', 'villager', 'villager'], { startWithNight: false, skipDiscussion: true });
    beginFirstRound(g);
    execute(g, 'p1');
    finishDay(g);
    commitStep(g, { target: 'p2' });
    goToDiscussion(g);
    expect(g.winner).toEqual({ kind: 'wolves' });
    expect(g.phase).toBe('gameOver');
  });

  it('seri jika semua mati', () => {
    const g = gameWith(['werewolf', 'hunter', 'villager', 'villager']);
    g.players[2].isAlive = false;
    g.players[3].isAlive = false;
    g.lovers = ['p0', 'p1'];
    // lovers + hunter: kekasih (1 serigala, 1 desa) masih hidup berdua → cinta menang
    expect(computeWinner(g)).toEqual({ kind: 'lovers' });
    g.players[0].isAlive = false;
    g.players[1].isAlive = false;
    expect(computeWinner(g)).toEqual({ kind: 'draw' });
  });
});
