// Port dari Werewolf/Models/GameEngine.swift.
// Semua fungsi di sini murni logika (tanpa DOM/jaringan) dan hanya dijalankan di sisi narator (host).
// Perbedaan dengan iOS hanya pada cara input masuk: di web, pilihan malam & voting datang dari HP
// pemain, jadi tiap langkah malam di-"commit" lewat `commitStep` dengan input yang divalidasi.

import { ROLES, ROLE_INFO, type Role, type RoleCounts } from './roles';

export type Phase = 'reveal' | 'night' | 'morning' | 'day' | 'vote' | 'gameOver';

export type Winner =
  | { kind: 'village' }
  | { kind: 'wolves' }
  | { kind: 'lovers' }
  | { kind: 'tanner'; name: string }
  | { kind: 'draw' };

export type DeathCause = 'wolves' | 'poison' | 'vote' | 'hunter' | 'heartbreak' | 'disease';

export const DEATH_CAUSE_TEXT: Record<DeathCause, string> = {
  wolves: 'Dimangsa serigala',
  poison: 'Diracun Witch',
  vote: 'Dieksekusi warga',
  hunter: 'Ditembak Hunter',
  heartbreak: 'Mati patah hati',
  disease: 'Tertular penyakit Diseased',
};

export const DEATH_CAUSE_ICON: Record<DeathCause, string> = {
  wolves: '🐾', poison: '☠️', vote: '🔨', hunter: '🎯', heartbreak: '💔', disease: '🦠',
};

export type SpellMode = 'mute' | 'noVote';

export function spellSentence(mode: SpellMode, name: string): string {
  return mode === 'mute'
    ? `${name} dibungkam: tidak boleh bicara hari ini.`
    : `${name} tidak boleh ikut voting hari ini.`;
}

export function winnerTitle(w: Winner): string {
  switch (w.kind) {
    case 'village': return 'Desa Menang!';
    case 'wolves': return 'Serigala Menang!';
    case 'lovers': return 'Cinta Menang!';
    case 'tanner': return 'Tanner Menang!';
    case 'draw': return 'Seri!';
  }
}

export function winnerSubtitle(w: Winner): string {
  switch (w.kind) {
    case 'village': return 'Semua werewolf telah dibasmi. Desa kembali damai.';
    case 'wolves': return 'Serigala menguasai desa. Lolongan menggema di bawah bulan purnama.';
    case 'lovers': return 'Sepasang kekasih bertahan sampai akhir, melawan dunia.';
    case 'tanner': return `${w.name} berhasil membuat dirinya dieksekusi. Semua orang lain kalah!`;
    case 'draw': return 'Tidak ada yang tersisa di desa. Serigala dan warga sama-sama binasa.';
  }
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  isAlive: boolean;
  princeRevealed: boolean;
}

export interface DeathEvent { playerId: string; cause: DeathCause }

export interface NightStep {
  role: Role;
  /** false jika pemegang peran sudah mati (narator tetap memanggil agar tidak ketahuan) */
  active: boolean;
}

export interface LogEntry { text: string; icon: string }

export interface Settings {
  discussionSeconds: number;
  revealRoleOnDeath: boolean;
  startWithNight: boolean;
  /** Langsung ke voting tanpa layar diskusi bertimer */
  skipDiscussion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  discussionSeconds: 180,
  revealRoleOnDeath: true,
  startWithNight: true,
  skipDiscussion: false,
};

/** `by` = pemain yang menerawang (hasilnya ikut orangnya, bukan kartunya; tidak ada = state lama) */
export interface SeerResult { night: number; targetId: string; isWolf: boolean; by?: string }
/** Thief menukar kartu (sekali sepanjang permainan, di malam mana pun) */
export interface ThiefSwap {
  thiefId: string; targetId: string; stolenRole: Role;
  /** Malam saat Thief mencuri (tidak ada = malam 1, untuk state lama) */
  night?: number;
  /** false = sudah dipilih tapi kartu baru ditukar saat pagi (resolveNight) */
  applied: boolean;
}
/** Batas tukar Troublemaker sepanjang permainan (maksimal sekali per malam) */
export const TROUBLEMAKER_MAX_SWAPS = 2;

/** Troublemaker menukar kartu dua pemain lain (malam mana pun, maks. TROUBLEMAKER_MAX_SWAPS kali) */
export interface TroublemakerSwap {
  troublemakerId: string;
  /** Malam saat tukar dipilih (tidak ada = malam 1, untuk state lama) */
  night?: number;
  /** Dua pemain yang kartunya ditukar */
  pids: [string, string];
  /** Peran baru masing-masing setelah ditukar (diisi saat pagi) */
  newRoles?: [Role, Role];
  /** false = sudah dipilih tapi kartu baru ditukar saat pagi (resolveNight), setelah curian Thief */
  applied: boolean;
}
export interface InsomniacResult { night: number; walked: boolean; nearestWolfIds: string[]; by?: string }

export interface GameState {
  settings: Settings;
  players: Player[];
  phase: Phase;
  dayNumber: number;
  nightNumber: number;
  winner: Winner | null;
  log: LogEntry[];

  // Malam
  nightSteps: NightStep[];
  stepIndex: number;
  lovers: string[];
  lastProtected: string | null;
  protectedTonight: string | null;
  wolfTarget: string | null;
  witchHealUsed: boolean;
  witchPoisonUsed: boolean;
  witchHealsTonight: boolean;
  witchPoisonTarget: string | null;
  seerTarget: string | null;
  /** Serigala yang ditunjuk Diseased (ikut mati saat pagi) */
  diseasedRevenge: string | null;
  necromancerUsed: boolean;
  necromancerTarget: string | null;
  /** Pemain yang dibangkitkan tadi malam (diumumkan pagi) */
  lastRevived: string | null;
  /** Mantra Perapal untuk siang ini */
  spellTarget: string | null;
  spellMode: SpellMode;
  /** Hasil curian Thief (null = belum/tidak mencuri) */
  thiefSwap?: ThiefSwap | null;
  /** Tukaran Troublemaker (null = belum/tidak menukar) */
  troublemakerSwap?: TroublemakerSwap | null;
  /** Berapa kali Troublemaker sudah menukar */
  troublemakerUses?: number;
  /** Semua tukaran Troublemaker (yang terakhir = troublemakerSwap) */
  troublemakerHistory?: TroublemakerSwap[];
  /** Pemain yang memilih kekasih (Cupid malam 1); catatan pasangan ikut orangnya, bukan kartunya */
  cupidId?: string | null;
  /** Kekebalan Prince sudah terpakai (ikut kartunya kalau kartu Prince pindah tangan) */
  princeUsed?: boolean;

  // Siang
  lastDeaths: DeathEvent[];
  pendingHunters: string[];
  huntersUsed: string[];
  /** Korban tembakan Hunter pada fase pagi/eksekusi yang sedang berjalan */
  hunterDeaths: DeathEvent[];
  /** Surat suara: pemilih → tersangka. Satu pemain hidup = satu suara. */
  ballots: Record<string, string>;
  executionDeaths: DeathEvent[];
  princeSaved: string | null;
  executionDone: boolean;
  /** Pemain yang dieksekusi hari ini (null = tidak ada eksekusi), hanya bermakna jika executionDone */
  executedId: string | null;

  // Khusus versi web
  /** Pilihan sementara tiap serigala malam ini: serigala → target */
  wolfVotes: Record<string, string>;
  seerHistory: SeerResult[];
  insomniacHistory: InsomniacResult[];
  /** Pemain yang sudah melihat kartunya di fase reveal */
  ready: string[];
  /** Waktu (ms epoch) diskusi berakhir, null jika timer dijeda */
  discussionEndsAt: number | null;
  /** Sisa detik saat timer dijeda */
  discussionPausedRemaining: number | null;
}

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// MARK: - Setup helpers

export function totalRoles(counts: RoleCounts): number {
  return ROLES.reduce((s, r) => s + (counts[r] ?? 0), 0);
}

export function balanceScore(counts: RoleCounts): number {
  return ROLES.reduce((s, r) => s + ROLE_INFO[r].balance * (counts[r] ?? 0), 0);
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 24;

export function setupError(playerCount: number, counts: RoleCounts): string | null {
  if (playerCount < MIN_PLAYERS) return 'Minimal 4 pemain.';
  const total = totalRoles(counts);
  if (total !== playerCount) {
    return `Jumlah peran (${total}) harus sama dengan jumlah pemain (${playerCount}).`;
  }
  const wolves = counts.werewolf ?? 0;
  if (wolves < 1) return 'Minimal harus ada 1 Werewolf.';
  if (wolves >= playerCount - wolves) return 'Terlalu banyak werewolf—mereka langsung menang.';
  for (const r of ROLES) {
    if (!ROLE_INFO[r].allowsMultiple && (counts[r] ?? 0) > 1) return `${ROLE_INFO[r].name} hanya boleh satu.`;
  }
  return null;
}

/** Komposisi otomatis yang seimbang — sama persis dengan `autoAssignRoles()` di iOS. */
export function autoAssignRoles(n: number): RoleCounts {
  const counts: RoleCounts = {};
  let wolves: number;
  if (n <= 7) wolves = 1;
  else if (n <= 11) wolves = 2;
  else if (n <= 15) wolves = 3;
  else wolves = 4;
  counts.werewolf = wolves;
  const specials: [Role, number][] = [
    ['seer', 4], ['bodyguard', 6], ['hunter', 7], ['witch', 9],
    ['cupid', 10], ['lycan', 10], ['diseased', 11], ['prince', 12], ['spellcaster', 13],
    ['tanner', 14], ['necromancer', 15], ['insomniac', 16],
  ];
  let used = wolves;
  for (const [role, minPlayers] of specials) {
    if (n >= minPlayers && used < n - 1) {
      counts[role] = 1;
      used += 1;
    }
  }
  counts.villager = Math.max(0, n - used);

  // Seimbangkan: target skor antara -3 dan +4
  let guardLoop = 0;
  while (guardLoop < 20) {
    guardLoop += 1;
    const s = balanceScore(counts);
    const flexible = (['tanner', 'cupid', 'lycan'] as Role[]).find((r) => (counts[r] ?? 0) > 0);
    if (s > 4 && wolves < Math.floor(n / 3) && (counts.villager ?? 0) > 0) {
      counts.villager = (counts.villager ?? 0) - 1;
      wolves += 1;
      counts.werewolf = wolves;
    } else if (s < -3 && flexible) {
      counts[flexible] = 0;
      counts.villager = (counts.villager ?? 0) + 1;
    } else if (s < -3 && wolves > 1) {
      wolves -= 1;
      counts.werewolf = wolves;
      counts.villager = (counts.villager ?? 0) + 1;
    } else {
      break;
    }
  }
  return counts;
}

export function changeCount(counts: RoleCounts, role: Role, delta: number, playerCount: number): RoleCounts {
  const current = counts[role] ?? 0;
  const maxValue = ROLE_INFO[role].allowsMultiple ? playerCount : 1;
  return { ...counts, [role]: Math.max(0, Math.min(maxValue, current + delta)) };
}

// MARK: - Start

export function createGame(
  seats: { id: string; name: string }[],
  counts: RoleCounts,
  settings: Settings = DEFAULT_SETTINGS,
  rng: Rng = Math.random,
): GameState {
  const err = setupError(seats.length, counts);
  if (err) throw new Error(err);
  let deck: Role[] = [];
  for (const role of ROLES) deck = deck.concat(Array(counts[role] ?? 0).fill(role));
  deck = shuffle(deck, rng);
  const players: Player[] = seats.map((s, i) => ({
    id: s.id,
    name: s.name.trim() || `Pemain ${i + 1}`,
    role: deck[i],
    isAlive: true,
    princeRevealed: false,
  }));
  return {
    settings: { ...settings },
    players,
    phase: 'reveal',
    dayNumber: 0,
    nightNumber: 0,
    winner: null,
    log: [],
    nightSteps: [],
    stepIndex: 0,
    lovers: [],
    lastProtected: null,
    protectedTonight: null,
    wolfTarget: null,
    witchHealUsed: false,
    witchPoisonUsed: false,
    witchHealsTonight: false,
    witchPoisonTarget: null,
    seerTarget: null,
    diseasedRevenge: null,
    necromancerUsed: false,
    necromancerTarget: null,
    lastRevived: null,
    spellTarget: null,
    spellMode: 'mute',
    thiefSwap: null,
    troublemakerSwap: null,
    lastDeaths: [],
    pendingHunters: [],
    huntersUsed: [],
    hunterDeaths: [],
    ballots: {},
    executionDeaths: [],
    princeSaved: null,
    executionDone: false,
    executedId: null,
    wolfVotes: {},
    seerHistory: [],
    insomniacHistory: [],
    ready: [],
    discussionEndsAt: null,
    discussionPausedRemaining: null,
  };
}

export function beginFirstRound(g: GameState, now = Date.now()): void {
  if (g.phase !== 'reveal') throw new Error('Permainan sudah dimulai.');
  if (g.settings.startWithNight) startNight(g);
  else startDay(g, true, now);
}

// MARK: - Queries

export function player(g: GameState, id: string | null | undefined): Player | undefined {
  if (!id) return undefined;
  return g.players.find((p) => p.id === id);
}

export function alivePlayers(g: GameState): Player[] {
  return g.players.filter((p) => p.isAlive);
}

export function isRoleAlive(g: GameState, role: Role): boolean {
  return g.players.some((p) => p.role === role && p.isAlive);
}

export function isRoleInGame(g: GameState, role: Role): boolean {
  return g.players.some((p) => p.role === role);
}

// MARK: - Night

export function startNight(g: GameState): void {
  g.nightNumber += 1;
  g.protectedTonight = null;
  g.wolfTarget = null;
  g.witchHealsTonight = false;
  g.witchPoisonTarget = null;
  g.seerTarget = null;
  g.diseasedRevenge = null;
  g.necromancerTarget = null;
  g.lastRevived = null;
  g.spellTarget = null;
  g.stepIndex = 0;
  g.wolfVotes = {};
  g.hunterDeaths = [];
  g.discussionEndsAt = null;
  g.discussionPausedRemaining = null;

  const ordered = ROLES
    .filter((r) => ROLE_INFO[r].nightOrder !== null && isRoleInGame(g, r))
    .sort((a, b) => (ROLE_INFO[a].nightOrder ?? 0) - (ROLE_INFO[b].nightOrder ?? 0));
  const steps: NightStep[] = [];
  for (const role of ordered) {
    if (role === 'cupid' && g.nightNumber !== 1) continue;
    // Troublemaker yang kesempatannya habis tetap dipanggil (tidak aktif) supaya tidak ketahuan
    const spent = role === 'troublemaker' && troublemakerLeft(g) <= 0;
    steps.push({ role, active: isRoleAlive(g, role) && !spent });
  }
  g.nightSteps = steps;
  g.phase = 'night';
}

export function currentStep(g: GameState): NightStep | undefined {
  return g.phase === 'night' ? g.nightSteps[g.stepIndex] : undefined;
}

/** Apakah serangan serigala malam ini benar-benar mengenai Diseased */
export function wolvesHitDiseased(g: GameState): boolean {
  const t = g.wolfTarget;
  if (!t || player(g, t)?.role !== 'diseased') return false;
  return g.protectedTonight !== t && !g.witchHealsTonight;
}

/** Tambah langkah Diseased di akhir malam jika ia dimangsa. */
export function insertConditionalSteps(g: GameState): void {
  if (
    wolvesHitDiseased(g) &&
    alivePlayers(g).some((p) => p.role === 'werewolf') &&
    !g.nightSteps.some((s) => s.role === 'diseased')
  ) {
    g.nightSteps.push({ role: 'diseased', active: true });
  }
}

/** Kandidat sah untuk tiap peran malam (sama dengan daftar yang ditampilkan di iOS). */
export function stepCandidates(g: GameState, role: Role): Player[] {
  const alive = alivePlayers(g);
  switch (role) {
    case 'cupid': return alive;
    case 'bodyguard': return alive.filter((p) => p.id !== g.lastProtected);
    case 'werewolf': return alive.filter((p) => p.role !== 'werewolf');
    case 'witch': return alive.filter((p) => p.role !== 'witch'); // target racun
    case 'seer': return alive.filter((p) => p.role !== 'seer');
    case 'necromancer': return g.necromancerUsed ? [] : g.players.filter((p) => !p.isAlive);
    case 'spellcaster': return alive;
    case 'diseased': return alive.filter((p) => p.role === 'werewolf');
    case 'thief': return alive.filter((p) => p.role !== 'thief');
    case 'troublemaker': return troublemakerLeft(g) > 0 ? alive.filter((p) => p.role !== 'troublemaker') : [];
    default: return [];
  }
}

/** Werewolf hidup yang duduk paling dekat dengan pemain ini (melingkar sesuai urutan duduk). */
export function nearestWerewolves(g: GameState, fromId: string): string[] {
  const n = g.players.length;
  const from = g.players.findIndex((p) => p.id === fromId);
  if (from < 0) return [];
  let best = Infinity;
  let result: string[] = [];
  g.players.forEach((p, i) => {
    if (!p.isAlive || p.role !== 'werewolf' || p.id === fromId) return;
    const d = Math.min(Math.abs(i - from), n - Math.abs(i - from));
    if (d < best) { best = d; result = [p.id]; } else if (d === best) result.push(p.id);
  });
  return result;
}

export interface StepInput {
  /** Cupid: dua kekasih */
  lovers?: [string, string];
  /** Guardian, Werewolf, Seer, Diseased, Thief: satu target (Thief tanpa target = tidak mencuri) */
  target?: string;
  /** Troublemaker: dua pemain yang kartunya ditukar (kosong = tidak menukar) */
  swap?: [string, string];
  /** Witch */
  heal?: boolean;
  poison?: string | null;
  /** Necromancer (null = tidak membangkitkan) */
  revive?: string | null;
  /** Spellcaster (target null = tanpa mantra) */
  spell?: { target: string | null; mode: SpellMode };
  /** Insomniac */
  walk?: boolean;
}

function assertCandidate(g: GameState, role: Role, id: string | null | undefined): asserts id is string {
  if (!id || !stepCandidates(g, role).some((p) => p.id === id)) {
    throw new Error('Pilihan tidak sah.');
  }
}

function assertStep(g: GameState, role: Role): void {
  const step = currentStep(g);
  if (!step || step.role !== role || !step.active) throw new Error('Bukan giliranmu.');
}

/**
 * Seer melihat hasil lebih dulu (sebelum langkahnya selesai) supaya hasilnya bisa ditunjukkan
 * sebelum malam berganti pagi. Hanya sekali per malam.
 */
export function seerPeek(g: GameState, target: string): SeerResult {
  assertStep(g, 'seer');
  const existing = g.seerHistory.find((h) => h.night === g.nightNumber);
  if (existing) return existing;
  assertCandidate(g, 'seer', target);
  const r: SeerResult = {
    night: g.nightNumber,
    targetId: target,
    isWolf: ROLE_INFO[player(g, target)!.role].looksLikeWerewolf,
    by: g.players.find((p) => p.role === 'seer' && p.isAlive)?.id,
  };
  g.seerTarget = target;
  g.seerHistory.push(r);
  return r;
}

/** Insomniac memutuskan jalan-jalan atau tidak; hasilnya langsung terlihat. Sekali per malam. */
export function insomniacPeek(g: GameState, walk: boolean): InsomniacResult {
  assertStep(g, 'insomniac');
  const existing = g.insomniacHistory.find((h) => h.night === g.nightNumber);
  if (existing) return existing;
  const ins = g.players.find((p) => p.role === 'insomniac' && p.isAlive);
  const r: InsomniacResult = {
    night: g.nightNumber,
    walked: walk,
    nearestWolfIds: walk && ins ? nearestWerewolves(g, ins.id) : [],
    by: ins?.id,
  };
  g.insomniacHistory.push(r);
  return r;
}

/**
 * Menyelesaikan langkah malam yang sedang berjalan. Untuk langkah yang tidak aktif (pemegang peran
 * sudah mati), panggil tanpa input. Mengembalikan true jika malam selesai (pagi tiba).
 * Berbeda dari iOS (yang mewajibkan pilihan), di web narator boleh melewati langkah pemain yang
 * tidak merespons; Guardian/Werewolf/Seer tanpa target dianggap tidak beraksi.
 */
export function commitStep(g: GameState, input: StepInput = {}, now = Date.now(), skip = false): boolean {
  const step = currentStep(g);
  if (!step) throw new Error('Bukan waktunya aksi malam.');
  // skip = narator melewati langkah ini tanpa aksi (mis. pemain tidak merespons)
  if (step.active && !skip) {
    switch (step.role) {
      case 'cupid': {
        const l = input.lovers;
        if (!l || l[0] === l[1]) throw new Error('Pilih dua kekasih yang berbeda.');
        assertCandidate(g, 'cupid', l[0]);
        assertCandidate(g, 'cupid', l[1]);
        g.lovers = [l[0], l[1]];
        g.cupidId = g.players.find((p) => p.role === 'cupid' && p.isAlive)?.id ?? null;
        break;
      }
      case 'bodyguard':
        if (input.target != null) assertCandidate(g, 'bodyguard', input.target);
        g.protectedTonight = input.target ?? null;
        break;
      case 'werewolf':
        if (input.target != null) assertCandidate(g, 'werewolf', input.target);
        g.wolfTarget = input.target ?? null;
        break;
      case 'witch': {
        const heal = !!input.heal && !g.witchHealUsed && g.wolfTarget !== null;
        let poison = input.poison ?? null;
        if (g.witchPoisonUsed) poison = null;
        if (poison) assertCandidate(g, 'witch', poison);
        g.witchHealsTonight = heal;
        g.witchPoisonTarget = poison;
        break;
      }
      case 'seer': {
        const peeked = g.seerHistory.find((h) => h.night === g.nightNumber);
        if (peeked) g.seerTarget = peeked.targetId;
        else if (input.target != null) seerPeek(g, input.target);
        break;
      }
      case 'necromancer': {
        const r = input.revive ?? null;
        if (r) assertCandidate(g, 'necromancer', r);
        g.necromancerTarget = r;
        break;
      }
      case 'spellcaster': {
        const t = input.spell?.target ?? null;
        if (t) assertCandidate(g, 'spellcaster', t);
        g.spellTarget = t;
        g.spellMode = input.spell?.mode ?? 'mute';
        break;
      }
      case 'insomniac':
        if (!g.insomniacHistory.some((h) => h.night === g.nightNumber)) insomniacPeek(g, !!input.walk);
        break;
      case 'diseased':
        if (input.target != null) assertCandidate(g, 'diseased', input.target);
        g.diseasedRevenge = input.target ?? null;
        break;
      case 'thief':
        if (input.target != null) {
          assertCandidate(g, 'thief', input.target);
          thiefSteal(g, input.target);
        }
        break;
      case 'troublemaker':
        if (input.swap) {
          const [a, b] = input.swap;
          if (a === b) throw new Error('Pilih dua orang yang berbeda.');
          assertCandidate(g, 'troublemaker', a);
          assertCandidate(g, 'troublemaker', b);
          const tm = g.players.find((p) => p.role === 'troublemaker' && p.isAlive);
          if (tm && troublemakerLeft(g) > 0) {
            g.troublemakerSwap = { troublemakerId: tm.id, pids: [a, b], applied: false, night: g.nightNumber };
            g.troublemakerHistory = [...(g.troublemakerHistory ?? []), g.troublemakerSwap];
            g.troublemakerUses = (g.troublemakerUses ?? 0) + 1;
          }
        }
        break;
      default:
        break;
    }
  }
  g.wolfVotes = {};
  // Diseased baru diketahui setelah semua pilihan malam dibuat
  if (g.stepIndex === g.nightSteps.length - 1) insertConditionalSteps(g);
  if (g.stepIndex + 1 < g.nightSteps.length) {
    g.stepIndex += 1;
    return false;
  }
  resolveNight(g, now);
  return true;
}

/**
 * Thief memilih kartu yang dicuri, sekali sepanjang permainan di malam mana pun. Selama belum mencuri
 * ia tetap berperan Thief dan dibangunkan tiap malam (setelah peran lain). Kartunya baru
 * ditukar saat pagi (applyThiefSwap), jadi malam itu semua peran beraksi dengan pemilik aslinya
 * dan tidak ada yang "terbangun sia-sia".
 */
function thiefSteal(g: GameState, targetId: string): void {
  const thief = g.players.find((p) => p.role === 'thief' && p.isAlive);
  const target = player(g, targetId);
  if (!thief || !target || g.thiefSwap) return;
  g.thiefSwap = { thiefId: thief.id, targetId: target.id, stolenRole: target.role, applied: false, night: g.nightNumber };
}

function applyThiefSwap(g: GameState): void {
  const s = g.thiefSwap;
  if (!s || s.applied) return;
  const thief = player(g, s.thiefId);
  const target = player(g, s.targetId);
  s.applied = true;
  if (!thief || !target) return;
  s.stolenRole = target.role;
  thief.role = target.role;
  target.role = 'villager';
  g.log.push({ text: `${thief.name} mencuri kartu ${ROLE_INFO[s.stolenRole].name} dari ${target.name}`, icon: ROLE_INFO.thief.icon });
}

export function troublemakerLeft(g: GameState): number {
  return TROUBLEMAKER_MAX_SWAPS - (g.troublemakerUses ?? 0);
}

/** Tukar kartu pilihan Troublemaker. Dijalankan setelah curian Thief, jadi yang ditukar adalah kartu hasil curian. */
function applyTroublemakerSwap(g: GameState): void {
  const s = g.troublemakerSwap;
  if (!s || s.applied) return;
  s.applied = true;
  const a = player(g, s.pids[0]);
  const b = player(g, s.pids[1]);
  if (!a || !b) return;
  [a.role, b.role] = [b.role, a.role];
  s.newRoles = [a.role, b.role];
  // Setelah state dimuat ulang dari JSON, entri riwayat terakhir bukan objek yang sama lagi
  const h = g.troublemakerHistory;
  if (h?.length) h[h.length - 1] = s;
  g.log.push({ text: `Troublemaker menukar kartu ${a.name} (sekarang ${ROLE_INFO[a.role].name}) dan ${b.name} (sekarang ${ROLE_INFO[b.role].name})`, icon: ROLE_INFO.troublemaker.icon });
}

export function resolveNight(g: GameState, now = Date.now()): void {
  // Semua peran beraksi dengan pemilik aslinya malam ini, jadi "serigala mengenai Diseased" dihitung
  // sebelum kartu ditukar (sama dengan saat langkah Diseased disisipkan).
  const hitDiseased = wolvesHitDiseased(g);
  applyThiefSwap(g);
  applyTroublemakerSwap(g);
  const killed: [string, DeathCause][] = [];
  if (g.wolfTarget) {
    const isProtected = g.protectedTonight === g.wolfTarget;
    if (!isProtected && !g.witchHealsTonight) killed.push([g.wolfTarget, 'wolves']);
  }
  if (g.witchHealsTonight) g.witchHealUsed = true;
  if (g.witchPoisonTarget) {
    g.witchPoisonUsed = true;
    const poison = g.witchPoisonTarget;
    if (!killed.some(([id]) => id === poison)) killed.push([poison, 'poison']);
  }
  if (g.diseasedRevenge && hitDiseased) killed.push([g.diseasedRevenge, 'disease']);
  g.lastProtected = g.protectedTonight;
  // Necromancer membangkitkan sebelum korban malam ini dihitung
  const revived = player(g, g.necromancerTarget);
  if (revived && !revived.isAlive) {
    g.necromancerUsed = true;
    revived.isAlive = true;
    g.lastRevived = revived.id;
    g.log.push({ text: `${revived.name} dibangkitkan Necromancer`, icon: ROLE_INFO.necromancer.icon });
  }
  const spelled = player(g, g.spellTarget);
  if (spelled) g.log.push({ text: `Mantra: ${spellSentence(g.spellMode, spelled.name)}`, icon: '🤫' });
  g.lastDeaths = applyDeaths(g, killed);
  if (g.lastDeaths.length === 0 && g.lastRevived === null) {
    g.log.push({ text: `Malam ${g.nightNumber}: tidak ada yang mati`, icon: '🌙' });
  }
  startDay(g, false, now);
}

// MARK: - Deaths

/** Membunuh pemain + rantai kekasih. Mengembalikan semua event kematian. */
export function applyDeaths(g: GameState, list: [string, DeathCause][]): DeathEvent[] {
  const events: DeathEvent[] = [];
  const queue = list.slice();
  while (queue.length) {
    const [id, cause] = queue.shift()!;
    const p = player(g, id);
    if (!p || !p.isAlive) continue;
    p.isAlive = false;
    events.push({ playerId: id, cause });
    g.log.push({ text: `${p.name} (${ROLE_INFO[p.role].name}) — ${DEATH_CAUSE_TEXT[cause]}`, icon: DEATH_CAUSE_ICON[cause] });
    if (p.role === 'hunter' && !g.huntersUsed.includes(id)) g.pendingHunters.push(id);
    if (g.lovers.includes(id)) {
      const other = g.lovers.find((l) => l !== id);
      if (other) queue.push([other, 'heartbreak']);
    }
  }
  return events;
}

/** Hunter menembak (target null = melewatkan). Mengembalikan event kematian akibat tembakan. */
export function hunterShoots(g: GameState, target: string | null): DeathEvent[] {
  const hunter = g.pendingHunters[0];
  if (!hunter) return [];
  if (target !== null && !alivePlayers(g).some((p) => p.id === target)) throw new Error('Target tidak sah.');
  g.pendingHunters.shift();
  g.huntersUsed.push(hunter);
  if (target === null) {
    g.log.push({ text: `${player(g, hunter)?.name ?? 'Hunter'} tidak menembak`, icon: '🎯' });
    return [];
  }
  const events = applyDeaths(g, [[target, 'hunter']]);
  g.hunterDeaths.push(...events);
  return events;
}

// MARK: - Day

function startDiscussionTimer(g: GameState, now: number): void {
  g.discussionEndsAt = now + g.settings.discussionSeconds * 1000;
  g.discussionPausedRemaining = null;
}

/** Sisa waktu diskusi dalam detik (0 jika tidak ada timer berjalan). */
export function discussionLeft(g: GameState, now = Date.now()): number {
  if (g.discussionPausedRemaining !== null) return g.discussionPausedRemaining;
  if (g.discussionEndsAt === null) return 0;
  return Math.max(0, (g.discussionEndsAt - now) / 1000);
}

export function startDay(g: GameState, firstDay: boolean, now = Date.now()): void {
  g.dayNumber += 1;
  if (firstDay) g.lastDeaths = [];
  g.ballots = {};
  g.executionDeaths = [];
  g.princeSaved = null;
  g.executionDone = false;
  g.executedId = null;
  g.hunterDeaths = [];
  if (firstDay && g.pendingHunters.length === 0 && checkWinner(g)) return;
  if (firstDay && g.settings.skipDiscussion) goToVote(g);
  else if (firstDay) { g.phase = 'day'; startDiscussionTimer(g, now); }
  else g.phase = 'morning';
}

/** Dari layar pagi → diskusi (atau langsung voting / hasil akhir). */
export function goToDiscussion(g: GameState, now = Date.now()): void {
  if (g.pendingHunters.length) throw new Error('Hunter belum menembak.');
  if (checkWinner(g)) return;
  if (g.settings.skipDiscussion) goToVote(g);
  else { g.phase = 'day'; startDiscussionTimer(g, now); }
}

export function goToVote(g: GameState): void {
  g.ballots = {};
  g.executionDeaths = [];
  g.princeSaved = null;
  g.executionDone = false;
  g.executedId = null;
  g.hunterDeaths = [];
  g.discussionEndsAt = null;
  g.discussionPausedRemaining = null;
  g.phase = 'vote';
}

/** Pemain yang boleh memberi suara hari ini (hidup & tidak dilarang Spellcaster) */
export function eligibleVoters(g: GameState): Player[] {
  return alivePlayers(g).filter((p) => !(g.spellMode === 'noVote' && g.spellTarget === p.id));
}

/** Jumlah suara per tersangka, dihitung dari surat suara yang sah. */
export function votes(g: GameState): Record<string, number> {
  const voters = new Set(eligibleVoters(g).map((p) => p.id));
  const alive = new Set(alivePlayers(g).map((p) => p.id));
  const tally: Record<string, number> = {};
  for (const [voter, target] of Object.entries(g.ballots)) {
    if (voters.has(voter) && alive.has(target)) tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}

export function votesCast(g: GameState): number {
  return Object.values(votes(g)).reduce((a, b) => a + b, 0);
}

/** Beri, ganti (pilih tersangka lain), atau batalkan (null) suara seorang pemilih. */
export function castVote(g: GameState, voter: string, target: string | null): void {
  if (g.phase !== 'vote' || g.executionDone) throw new Error('Voting belum/tidak dibuka.');
  if (!eligibleVoters(g).some((p) => p.id === voter)) throw new Error('Kamu tidak boleh memilih hari ini.');
  if (target && target !== voter) {
    if (!alivePlayers(g).some((p) => p.id === target)) throw new Error('Tersangka tidak sah.');
    g.ballots[voter] = target;
  } else {
    delete g.ballots[voter];
  }
}

export function resetBallots(g: GameState): void {
  g.ballots = {};
}

export function voteLeaders(g: GameState): string[] {
  const v = votes(g);
  const max = Math.max(0, ...Object.values(v));
  if (max <= 0) return [];
  return Object.keys(v).filter((k) => v[k] === max);
}

export function execute(g: GameState, id: string | null): void {
  if (g.phase !== 'vote' || g.executionDone) throw new Error('Tidak bisa mengeksekusi sekarang.');
  g.executionDone = true;
  g.executedId = id;
  const p = player(g, id);
  if (!p) {
    g.log.push({ text: `Hari ${g.dayNumber}: tidak ada yang dieksekusi`, icon: '✋' });
    return;
  }
  // Kekebalan melekat di kartu Prince: sekali saja walau kartunya dicuri/ditukar
  const princeUsed = g.princeUsed ?? g.players.some((x) => x.princeRevealed);
  if (p.role === 'prince' && !princeUsed) {
    p.princeRevealed = true;
    g.princeUsed = true;
    g.princeSaved = p.id;
    g.log.push({ text: `${p.name} ternyata Prince dan selamat!`, icon: '👑' });
    return;
  }
  g.executionDeaths = applyDeaths(g, [[p.id, 'vote']]);
  if (p.role === 'tanner') g.winner = { kind: 'tanner', name: p.name };
}

export function finishDay(g: GameState): void {
  if (g.pendingHunters.length) throw new Error('Hunter belum menembak.');
  if (checkWinner(g)) return;
  startNight(g);
}

// MARK: - Win check

export function checkWinner(g: GameState): boolean {
  if (g.winner === null) g.winner = computeWinner(g);
  if (g.winner !== null) {
    g.phase = 'gameOver';
    g.discussionEndsAt = null;
    return true;
  }
  return false;
}

export function computeWinner(g: GameState): Winner | null {
  const alive = alivePlayers(g);
  if (
    alive.length === 2 && g.lovers.length === 2 &&
    alive.every((p) => g.lovers.includes(p.id)) &&
    new Set(alive.map((p) => ROLE_INFO[p.role].team === 'wolves')).size === 2
  ) {
    return { kind: 'lovers' };
  }
  if (alive.length === 0) return { kind: 'draw' };
  const wolves = alive.filter((p) => p.role === 'werewolf').length;
  const others = alive.length - wolves;
  if (wolves === 0) return { kind: 'village' };
  if (wolves >= others) return { kind: 'wolves' };
  return null;
}

/** Kalimat pengumuman pagi (untuk dibacakan narator). */
export const THIEF_NOTICE = 'Semalam ada kartu yang dicuri! Seseorang di desa ini sudah bukan dirinya yang dulu.';

/** Pagi setelah malam curian: umumkan ke semua bahwa Thief beraksi (tanpa menyebut siapa). */
export function cardStolenNotice(g: GameState): boolean {
  const s = g.thiefSwap;
  return !!s && s.applied && (s.night ?? 1) === g.nightNumber && (g.phase === 'morning' || g.phase === 'day');
}

export const TROUBLEMAKER_NOTICE = 'Ada yang membuat onar semalam! Kartu dua orang di desa ini sudah ditukar.';

/** Pagi setelah malam tukar: umumkan ke semua bahwa Troublemaker beraksi (tanpa menyebut siapa). */
export function cardsSwappedNotice(g: GameState): boolean {
  const s = g.troublemakerSwap;
  return !!s && s.applied && (s.night ?? 1) === g.nightNumber && (g.phase === 'morning' || g.phase === 'day');
}

export function morningAnnouncement(g: GameState): string {
  // Urutan sama dengan klip rekaman (narration.ts: morningClips)
  let extra = '';
  const r = player(g, g.lastRevived);
  if (r) extra += ` ${r.name} bangkit kembali dari kematian!`;
  const s = player(g, g.spellTarget);
  if (s && s.isAlive) extra += ' ' + spellSentence(g.spellMode, s.name);
  if (cardStolenNotice(g)) extra += ' ' + THIEF_NOTICE;
  if (cardsSwappedNotice(g)) extra += ' ' + TROUBLEMAKER_NOTICE;
  if (g.lastDeaths.length === 0) return 'Malam yang damai. Tidak ada yang mati semalam.' + extra;
  const parts = g.lastDeaths.flatMap((e) => {
    const p = player(g, e.playerId);
    if (!p) return [];
    const role = g.settings.revealRoleOnDeath ? `, dan ternyata dia adalah ${ROLE_INFO[p.role].name}` : '';
    const c = DEATH_CAUSE_TEXT[e.cause];
    return [`${p.name}, ${c.charAt(0).toLowerCase()}${c.slice(1)}${role}`];
  });
  return 'Semalam, ' + parts.join('. Lalu ') + '.' + extra;
}
