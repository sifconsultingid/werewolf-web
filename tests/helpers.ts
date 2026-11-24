import { createGame, DEFAULT_SETTINGS, type GameState, type Settings } from '../src/game/engine';
import type { Role } from '../src/game/roles';

/** RNG deterministik (mulberry32) agar tes bisa diulang. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Membuat permainan dengan peran yang ditentukan persis (pemain p0, p1, ... sesuai urutan `roles`).
 */
export function gameWith(roles: Role[], settings: Partial<Settings> = {}): GameState {
  const seats = roles.map((_, i) => ({ id: `p${i}`, name: `Pemain ${i + 1}` }));
  const counts: Partial<Record<Role, number>> = {};
  for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;
  const g = createGame(seats, counts, { ...DEFAULT_SETTINGS, ...settings });
  g.players.forEach((p, i) => { p.role = roles[i]; });
  return g;
}

export const id = (g: GameState, role: Role, nth = 0): string =>
  g.players.filter((p) => p.role === role)[nth].id;
