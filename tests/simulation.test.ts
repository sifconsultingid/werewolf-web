import { describe, expect, it } from 'vitest';
import {
  alivePlayers, autoAssignRoles, beginFirstRound, castVote, changeCount, commitStep, createGame,
  currentStep, DEFAULT_SETTINGS, eligibleVoters, execute, finishDay, goToDiscussion, goToVote,
  hunterShoots, setupError, stepCandidates, voteLeaders, type GameState, type StepInput,
} from '../src/game/engine';
import { ROLES, ROLE_INFO, type Role, type RoleCounts } from '../src/game/roles';
import { seeded } from './helpers';

type R = () => number;
const pick = <T>(rng: R, arr: T[]): T | undefined => (arr.length ? arr[Math.floor(rng() * arr.length)] : undefined);
const chance = (rng: R, p: number) => rng() < p;

/** Komposisi acak: mulai dari komposisi otomatis lalu ubah beberapa peran secara acak. */
function randomComposition(rng: R, n: number): RoleCounts {
  let c = autoAssignRoles(n);
  for (let k = 0; k < 6; k++) {
    const add = pick(rng, ROLES as unknown as Role[])!;
    if ((c.villager ?? 0) > 0 && (ROLE_INFO[add].allowsMultiple || (c[add] ?? 0) === 0)) {
      const next = changeCount(changeCount(c, 'villager', -1, n), add, 1, n);
      if (setupError(n, next) === null) c = next;
    }
  }
  return c;
}

function randomStepInput(rng: R, g: GameState): StepInput {
  const step = currentStep(g)!;
  const cands = stepCandidates(g, step.role).map((p) => p.id);
  switch (step.role) {
    case 'cupid': {
      const a = pick(rng, cands)!;
      const b = pick(rng, cands.filter((x) => x !== a))!;
      return { lovers: [a, b] };
    }
    case 'bodyguard':
    case 'seer':
    case 'diseased':
      return { target: chance(rng, 0.9) ? pick(rng, cands) : undefined };
    case 'werewolf':
      return { target: chance(rng, 0.95) ? pick(rng, cands) : undefined };
    case 'witch':
      return { heal: chance(rng, 0.4), poison: chance(rng, 0.25) ? pick(rng, cands) ?? null : null };
    case 'necromancer':
      return { revive: chance(rng, 0.3) ? pick(rng, cands) ?? null : null };
    case 'spellcaster':
      return { spell: { target: chance(rng, 0.7) ? pick(rng, cands) ?? null : null, mode: chance(rng, 0.5) ? 'mute' : 'noVote' } };
    case 'insomniac':
      return { walk: chance(rng, 0.5) };
    default:
      return {};
  }
}

function resolveHunters(rng: R, g: GameState) {
  while (g.pendingHunters.length) {
    hunterShoots(g, chance(rng, 0.85) ? pick(rng, alivePlayers(g).map((p) => p.id)) ?? null : null);
  }
}

/** Mainkan satu permainan acak sampai selesai. Mengembalikan state akhir. */
function playRandomGame(seed: number): { g: GameState; votedOut: string[] } {
  const rng = seeded(seed);
  const n = 4 + Math.floor(rng() * 21);
  const counts = randomComposition(rng, n);
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Pemain ${i + 1}` }));
  const g = createGame(seats, counts, {
    ...DEFAULT_SETTINGS,
    startWithNight: chance(rng, 0.8),
    skipDiscussion: chance(rng, 0.3),
    revealRoleOnDeath: chance(rng, 0.5),
  }, rng);
  const votedOut: string[] = [];
  beginFirstRound(g);
  let guard = 0;
  while (g.phase !== 'gameOver') {
    if (++guard > 5000) throw new Error(`Permainan seed ${seed} tidak selesai`);
    const before = alivePlayers(g).map((p) => p.id);
    switch (g.phase) {
      case 'night': {
        commitStep(g, currentStep(g)!.active ? randomStepInput(rng, g) : {});
        break;
      }
      case 'morning':
        resolveHunters(rng, g);
        goToDiscussion(g);
        break;
      case 'day':
        goToVote(g);
        break;
      case 'vote': {
        for (const v of eligibleVoters(g)) {
          if (chance(rng, 0.9)) {
            const t = pick(rng, alivePlayers(g).filter((p) => p.id !== v.id).map((p) => p.id));
            if (t) castVote(g, v.id, t);
          }
        }
        const leaders = voteLeaders(g);
        const target = leaders.length === 1 ? leaders[0] : null;
        execute(g, target);
        if (target && g.executionDeaths.some((d) => d.playerId === target)) votedOut.push(target);
        resolveHunters(rng, g);
        finishDay(g);
        break;
      }
      default:
        throw new Error(`Fase tak terduga: ${g.phase}`);
    }
    // Invarian: pemain hanya hidup kembali lewat Necromancer
    const after = new Set(alivePlayers(g).map((p) => p.id));
    for (const id of after) {
      if (!before.includes(id)) expect(g.lastRevived).toBe(id);
    }
  }
  return { g, votedOut };
}

/** Periksa bahwa pemenang sesuai dengan keadaan akhir permainan. */
function assertWinnerIsLegal(g: GameState, votedOut: string[]) {
  const w = g.winner!;
  expect(w).not.toBeNull();
  const alive = alivePlayers(g);
  const wolves = alive.filter((p) => p.role === 'werewolf').length;
  const others = alive.length - wolves;
  switch (w.kind) {
    case 'village':
      expect(wolves).toBe(0);
      expect(alive.length).toBeGreaterThan(0);
      break;
    case 'wolves':
      expect(wolves).toBeGreaterThan(0);
      expect(wolves).toBeGreaterThanOrEqual(others);
      break;
    case 'lovers':
      expect(alive.length).toBe(2);
      expect(alive.every((p) => g.lovers.includes(p.id))).toBe(true);
      expect(alive.filter((p) => ROLE_INFO[p.role].team === 'wolves').length).toBe(1);
      break;
    case 'tanner': {
      const tanner = g.players.find((p) => p.role === 'tanner')!;
      expect(tanner.name).toBe(w.name);
      expect(tanner.isAlive).toBe(false);
      expect(votedOut).toContain(tanner.id);
      break;
    }
    case 'draw':
      expect(alive.length).toBe(0);
      break;
  }
}

describe('simulasi acak', () => {
  it('5000 permainan acak selalu selesai dengan pemenang yang sah', () => {
    const tally: Record<string, number> = {};
    for (let seed = 1; seed <= 5000; seed++) {
      const { g, votedOut } = playRandomGame(seed);
      assertWinnerIsLegal(g, votedOut);
      tally[g.winner!.kind] = (tally[g.winner!.kind] ?? 0) + 1;
    }
    // Semua jenis kemenangan muncul setidaknya sekali dalam 5000 permainan
    for (const k of ['village', 'wolves', 'lovers', 'tanner', 'draw']) {
      expect(tally[k] ?? 0, `kemenangan ${k}`).toBeGreaterThan(0);
    }
  });
});
