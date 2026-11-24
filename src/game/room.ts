// "Ruang" permainan: kursi pemain + state permainan, aksi dari pemain, dan tampilan yang
// disaring per pemain. Semua dijalankan di sisi narator. Fungsi di sini murni (tanpa jaringan)
// supaya bisa dites.

import {
  alivePlayers, autoAssignRoles, castVote, commitStep, createGame, currentStep, DEFAULT_SETTINGS,
  eligibleVoters, hunterShoots, insomniacPeek, morningAnnouncement, seerPeek, player, stepCandidates, votes,
  type DeathCause, type GameState, type Phase, type Rng, type Settings, type SpellMode, type StepInput,
  type Winner, MAX_PLAYERS,
} from './engine';
import { ROLE_INFO, type Role, type RoleCounts, type Team } from './roles';
import { DEFAULT_TIMINGS, newAutoState, publicDeadline, stageOf, type AutoState, type AutoTimings } from './auto';

export interface Seat { uid: string; pid: string; name: string }

export interface Room {
  code: string;
  seats: Seat[];
  counts: RoleCounts;
  /** Komposisi mengikuti jumlah pemain secara otomatis sampai narator mengubahnya manual */
  autoCounts: boolean;
  settings: Settings;
  game: GameState | null;
  /** Pesan galat terakhir per pemain (ditampilkan di HP-nya) */
  notices: Record<string, { text: string; at: number }>;
  /** Mode "host ikut main": narator dijalankan sistem (lihat auto.ts) */
  autoNarrator?: boolean;
  /** uid host (pembuat ruang) jika ia ikut bermain */
  hostUid?: string | null;
  timings?: AutoTimings;
  /** State narator otomatis selama permainan berjalan */
  auto?: AutoState | null;
}

export interface RoomOptions {
  autoNarrator?: boolean;
  timings?: AutoTimings;
}

export type PlayerAction =
  | { type: 'join'; name: string }
  | { type: 'hello' }
  | { type: 'ready' }
  | { type: 'night'; input: StepInput }
  /** Peramal/Insomnia: lihat hasil dulu, lalu kirim 'night' untuk tidur kembali */
  | { type: 'peek'; target?: string; walk?: boolean }
  | { type: 'wolfVote'; target: string | null }
  | { type: 'vote'; target: string | null }
  | { type: 'hunter'; target: string | null };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(rng: Rng = Math.random, len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

function randomPid(rng: Rng): string {
  return 'p' + Math.floor(rng() * 36 ** 6).toString(36).padStart(6, '0');
}

export function createRoom(code: string, expectedPlayers: number, settings: Settings = DEFAULT_SETTINGS, opts: RoomOptions = {}): Room {
  return {
    autoNarrator: !!opts.autoNarrator,
    hostUid: null,
    timings: { ...DEFAULT_TIMINGS, ...opts.timings },
    auto: null,
    code,
    seats: [],
    counts: autoAssignRoles(Math.max(4, expectedPlayers)),
    autoCounts: true,
    settings: { ...settings },
    game: null,
    notices: {},
  };
}

export function inLobby(room: Room): boolean {
  return room.game === null;
}

function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function uniqueName(room: Room, name: string, uid: string): string {
  const taken = new Set(room.seats.filter((s) => s.uid !== uid).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const n = `${name} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

export function syncAutoCounts(room: Room): void {
  if (room.autoCounts && room.seats.length >= 4) room.counts = autoAssignRoles(room.seats.length);
}

export function seatOf(room: Room, uid: string): Seat | undefined {
  return room.seats.find((s) => s.uid === uid);
}

/**
 * Terapkan aksi dari seorang pemain. Mengembalikan true jika state berubah.
 * Aksi yang tidak sah diabaikan dan pesan galat disimpan untuk pemain tsb.
 */
export function applyPlayerAction(room: Room, uid: string, action: PlayerAction, rng: Rng = Math.random, now = Date.now()): boolean {
  const fail = (text: string) => { room.notices[uid] = { text, at: now }; return true; };
  if (!action || typeof action !== 'object') return false;
  const seat = seatOf(room, uid);

  if (action.type === 'hello') return false;

  if (action.type === 'join') {
    const name = cleanName(action.name);
    if (!name) return fail('Nama tidak boleh kosong.');
    if (seat) {
      if (!inLobby(room)) return false; // nama dikunci setelah permainan dimulai
      seat.name = uniqueName(room, name, uid);
      return true;
    }
    if (!inLobby(room)) return fail('Permainan sudah dimulai. Tunggu permainan berikutnya.');
    if (room.seats.length >= MAX_PLAYERS) return fail(`Ruang penuh (maks ${MAX_PLAYERS} pemain).`);
    let pid = randomPid(rng);
    while (room.seats.some((s) => s.pid === pid)) pid = randomPid(rng);
    room.seats.push({ uid, pid, name: uniqueName(room, name, uid) });
    delete room.notices[uid];
    syncAutoCounts(room);
    return true;
  }

  const g = room.game;
  if (!seat || !g) return false;
  const me = player(g, seat.pid);
  if (!me) return false;

  try {
    switch (action.type) {
      case 'ready':
        if (g.phase !== 'reveal' || g.ready.includes(me.id)) return false;
        g.ready.push(me.id);
        return true;

      case 'wolfVote': {
        const step = currentStep(g);
        if (!step || step.role !== 'werewolf' || !step.active || me.role !== 'werewolf' || !me.isAlive) {
          return fail('Bukan giliranmu.');
        }
        if (action.target === null) {
          delete g.wolfVotes[me.id];
          return true;
        }
        if (!stepCandidates(g, 'werewolf').some((p) => p.id === action.target)) return fail('Target tidak sah.');
        g.wolfVotes[me.id] = action.target;
        if (room.auto) return true; // narator otomatis menutup langkah setelah durasi minimum
        const pack = alivePlayers(g).filter((p) => p.role === 'werewolf');
        const picks = pack.map((w) => g.wolfVotes[w.id]);
        if (picks.every((t) => t && t === picks[0])) commitStep(g, { target: picks[0] }, now);
        return true;
      }

      case 'night': {
        const step = currentStep(g);
        if (!step || !step.active || step.role === 'werewolf' || me.role !== step.role || !me.isAlive) {
          return fail('Bukan giliranmu.');
        }
        const input = sanitizeInput(action.input);
        if (room.auto) {
          // Validasi dulu di salinan, lalu tunggu durasi minimum langkah (lihat autoTick)
          commitStep(structuredClone(g), input, now);
          room.auto.pending = { stage: stageOf(g, room.auto).key, input };
          return true;
        }
        commitStep(g, input, now);
        return true;
      }

      case 'peek': {
        const step = currentStep(g);
        if (!step || !step.active || me.role !== step.role || !me.isAlive) return fail('Bukan giliranmu.');
        if (step.role === 'seer' && typeof action.target === 'string') seerPeek(g, action.target);
        else if (step.role === 'insomniac') insomniacPeek(g, !!action.walk);
        else return fail('Aksi tidak sah.');
        return true;
      }

      case 'vote':
        castVote(g, me.id, action.target ?? null);
        return true;

      case 'hunter':
        if (g.pendingHunters[0] !== me.id) return fail('Bukan giliranmu.');
        hunterShoots(g, action.target ?? null);
        return true;

      default:
        return false;
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Aksi gagal.');
  }
}

function sanitizeInput(raw: StepInput | undefined): StepInput {
  const i = raw ?? {};
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
  const out: StepInput = {};
  if (Array.isArray(i.lovers) && i.lovers.length === 2) {
    const [a, b] = i.lovers.map(str);
    if (a && b) out.lovers = [a, b];
  }
  if (str(i.target)) out.target = i.target;
  if (typeof i.heal === 'boolean') out.heal = i.heal;
  if (i.poison === null || str(i.poison)) out.poison = i.poison ?? null;
  if (i.revive === null || str(i.revive)) out.revive = i.revive ?? null;
  if (i.spell && (i.spell.mode === 'mute' || i.spell.mode === 'noVote')) {
    out.spell = { target: str(i.spell.target) ?? null, mode: i.spell.mode };
  }
  if (typeof i.walk === 'boolean') out.walk = i.walk;
  return out;
}

/** Narator menekan Mulai: server/host mengacak peran. */
export function startGame(room: Room, rng: Rng = Math.random): void {
  room.game = createGame(room.seats.map((s) => ({ id: s.pid, name: s.name })), room.counts, room.settings, rng);
  room.notices = {};
  room.auto = room.autoNarrator ? newAutoState() : null;
}

/** Kembali ke lobi dengan pemain yang sama (untuk main lagi). */
export function backToLobby(room: Room): void {
  room.game = null;
  room.auto = null;
  room.notices = {};
  syncAutoCounts(room);
}

export function removeSeat(room: Room, pid: string): void {
  if (!inLobby(room)) return;
  if (room.hostUid && seatOf(room, room.hostUid)?.pid === pid) return; // host tidak bisa dikeluarkan
  room.seats = room.seats.filter((s) => s.pid !== pid);
  syncAutoCounts(room);
}

export function moveSeat(room: Room, pid: string, delta: number): void {
  if (!inLobby(room)) return;
  const i = room.seats.findIndex((s) => s.pid === pid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= room.seats.length) return;
  [room.seats[i], room.seats[j]] = [room.seats[j], room.seats[i]];
}

// MARK: - Tampilan

export interface PublicSeat {
  pid: string;
  name: string;
  alive: boolean;
  /** Hanya diisi jika peran sudah terbuka untuk umum */
  role?: Role;
  princeRevealed?: boolean;
  ready?: boolean;
}

export interface PublicDeath { pid: string; cause: DeathCause; role?: Role }

export interface PublicView {
  v: 1;
  code: string;
  phase: 'lobby' | Phase;
  seats: PublicSeat[];
  settings: Settings;
  dayNumber: number;
  nightNumber: number;
  night?: { role: Role; index: number; total: number };
  lastDeaths: PublicDeath[];
  lastRevived: string | null;
  spell: { pid: string; mode: SpellMode } | null;
  pendingHunter: string | null;
  hunterDeaths: PublicDeath[];
  ballots: Record<string, string>;
  tally: Record<string, number>;
  eligible: string[];
  executionDone: boolean;
  executedId: string | null;
  executionDeaths: PublicDeath[];
  princeSaved: string | null;
  discussionEndsAt: number | null;
  discussionPausedRemaining: number | null;
  winner: Winner | null;
  lovers: string[];
  announcement: string | null;
  /** Mode narator otomatis */
  auto?: {
    paused: boolean;
    /** Batas waktu tahap ini (reveal, voting, Pemburu) */
    endsAt: number | null;
    /** Voting ulang karena seri */
    revote: boolean;
  };
  /** pid host yang ikut bermain */
  hostPid?: string;
  updatedAt: number;
}

export interface ActionPrompt {
  key: string;
  kind: Role | 'hunter';
  candidates: string[];
  /** Penyihir: korban serigala malam ini */
  victim?: string | null;
  canHeal?: boolean;
  canPoison?: boolean;
  /** Pengawal: tidak boleh melindungi orang ini */
  lastProtected?: string | null;
  /** Nekromancer: kekuatan sudah terpakai */
  used?: boolean;
  /** Peramal: hasil terawangan malam ini (sudah dilihat, tinggal tidur kembali) */
  peeked?: { pid: string; isWolf: boolean };
  /** Insomnia: keputusan malam ini */
  walked?: { walked: boolean; nearestWolves: string[] };
}

export interface PrivateView {
  v: 1;
  joined: boolean;
  pid?: string;
  name?: string;
  notice?: string;
  role?: Role;
  team?: Team;
  alive?: boolean;
  pack?: { pid: string; name: string; alive: boolean }[];
  wolfVotes?: Record<string, string>;
  /** Pasangan kekasihmu */
  lover?: string;
  /** Cupid: pasangan yang ia pilih */
  coupled?: string[];
  seerHistory?: { night: number; pid: string; isWolf: boolean }[];
  insomniacHistory?: { night: number; walked: boolean; nearestWolves: string[] }[];
  /** Pencuri: kartu yang kamu curi / korban: kartumu dicuri (peranmu sekarang ada di `role`) */
  thief?: { stole: boolean; otherPid?: string; stolenRole: Role };
  action?: ActionPrompt | null;
  updatedAt: number;
}

function roleIsPublic(g: GameState, pid: string): boolean {
  const p = player(g, pid);
  if (!p) return false;
  if (g.phase === 'gameOver') return true;
  if (p.princeRevealed) return true;
  if (p.isAlive) return false;
  if (g.settings.revealRoleOnDeath) return true;
  // Si Penyamak yang dieksekusi selalu terbuka
  return p.role === 'tanner' && g.executedId === p.id;
}

function publicDeaths(g: GameState, list: { playerId: string; cause: DeathCause }[]): PublicDeath[] {
  return list.map((d) => ({
    pid: d.playerId,
    cause: d.cause,
    role: roleIsPublic(g, d.playerId) || (d.cause === 'vote' && player(g, d.playerId)?.role === 'tanner')
      ? player(g, d.playerId)?.role : undefined,
  }));
}

export function buildPublicView(room: Room, now = Date.now()): PublicView {
  const g = room.game;
  if (!g) {
    return {
      v: 1, code: room.code, phase: 'lobby',
      seats: room.seats.map((s) => ({ pid: s.pid, name: s.name, alive: true })),
      settings: room.settings, dayNumber: 0, nightNumber: 0, lastDeaths: [], lastRevived: null, spell: null,
      pendingHunter: null, hunterDeaths: [], ballots: {}, tally: {}, eligible: [], executionDone: false,
      executedId: null, executionDeaths: [], princeSaved: null, discussionEndsAt: null,
      discussionPausedRemaining: null, winner: null, lovers: [], announcement: null,
      hostPid: room.hostUid ? seatOf(room, room.hostUid)?.pid : undefined, updatedAt: now,
    };
  }
  const step = currentStep(g);
  const showDayInfo = g.phase === 'morning' || g.phase === 'day' || g.phase === 'vote';
  const spelled = showDayInfo && g.spellTarget && player(g, g.spellTarget)?.isAlive
    ? { pid: g.spellTarget, mode: g.spellMode } : null;
  return {
    v: 1,
    code: room.code,
    phase: g.phase,
    seats: g.players.map((p) => ({
      pid: p.id,
      name: p.name,
      alive: p.isAlive,
      role: roleIsPublic(g, p.id) ? p.role : undefined,
      princeRevealed: p.princeRevealed || undefined,
      ready: g.phase === 'reveal' ? g.ready.includes(p.id) : undefined,
    })),
    settings: g.settings,
    dayNumber: g.dayNumber,
    nightNumber: g.nightNumber,
    night: step ? { role: step.role, index: g.stepIndex, total: g.nightSteps.length } : undefined,
    lastDeaths: g.phase === 'night' || g.phase === 'reveal' ? [] : publicDeaths(g, g.lastDeaths),
    lastRevived: g.phase === 'night' ? null : g.lastRevived,
    spell: spelled,
    pendingHunter: g.pendingHunters[0] ?? null,
    hunterDeaths: publicDeaths(g, g.hunterDeaths),
    ballots: g.phase === 'vote' ? { ...g.ballots } : {},
    tally: g.phase === 'vote' ? votes(g) : {},
    eligible: g.phase === 'vote' ? eligibleVoters(g).map((p) => p.id) : [],
    executionDone: g.executionDone,
    executedId: g.executedId,
    executionDeaths: publicDeaths(g, g.executionDeaths),
    princeSaved: g.princeSaved,
    discussionEndsAt: g.discussionEndsAt,
    discussionPausedRemaining: g.discussionPausedRemaining,
    winner: g.winner,
    lovers: g.phase === 'gameOver' ? g.lovers : [],
    announcement: g.phase === 'morning' ? morningAnnouncement(g) : null,
    auto: room.auto ? {
      paused: room.auto.paused,
      endsAt: publicDeadline(g, room.auto),
      revote: g.phase === 'vote' && room.auto.revoteDay === g.dayNumber,
    } : undefined,
    hostPid: room.hostUid ? seatOf(room, room.hostUid)?.pid : undefined,
    updatedAt: now,
  };
}

function actionFor(g: GameState, pid: string, auto?: AutoState | null): ActionPrompt | null {
  const me = player(g, pid);
  if (!me) return null;
  if (g.pendingHunters[0] === pid) {
    return { key: `hunter-${g.dayNumber}-${g.phase}`, kind: 'hunter', candidates: alivePlayers(g).map((p) => p.id) };
  }
  const step = currentStep(g);
  if (!step || !step.active || !me.isAlive || me.role !== step.role) return null;
  // Aksi sudah dikirim, tinggal menunggu narator otomatis menutup langkah
  if (auto?.pending && auto.pending.stage === stageOf(g, auto).key) return null;
  const key = `n${g.nightNumber}-s${g.stepIndex}-${step.role}`;
  const candidates = stepCandidates(g, step.role).map((p) => p.id);
  switch (step.role) {
    case 'witch':
      return {
        key, kind: 'witch', candidates,
        victim: g.wolfTarget,
        canHeal: !g.witchHealUsed && g.wolfTarget !== null,
        canPoison: !g.witchPoisonUsed,
      };
    case 'bodyguard':
      return { key, kind: 'bodyguard', candidates, lastProtected: g.lastProtected };
    case 'necromancer':
      return { key, kind: 'necromancer', candidates, used: g.necromancerUsed };
    case 'seer': {
      const h = g.seerHistory.find((x) => x.night === g.nightNumber);
      return { key, kind: 'seer', candidates, peeked: h ? { pid: h.targetId, isWolf: h.isWolf } : undefined };
    }
    case 'insomniac': {
      const h = g.insomniacHistory.find((x) => x.night === g.nightNumber);
      return { key, kind: 'insomniac', candidates, walked: h ? { walked: h.walked, nearestWolves: h.nearestWolfIds } : undefined };
    }
    default:
      return { key, kind: step.role, candidates };
  }
}

export function buildPrivateView(room: Room, uid: string, now = Date.now()): PrivateView {
  const seat = seatOf(room, uid);
  const notice = room.notices[uid]?.text;
  if (!seat) return { v: 1, joined: false, notice, updatedAt: now };
  const g = room.game;
  const base: PrivateView = { v: 1, joined: true, pid: seat.pid, name: seat.name, notice, updatedAt: now };
  if (!g) return base;
  const me = player(g, seat.pid);
  if (!me) return base;
  const view: PrivateView = {
    ...base,
    role: me.role,
    team: ROLE_INFO[me.role].team,
    alive: me.isAlive,
    action: actionFor(g, me.id, room.auto),
  };
  if (me.role === 'werewolf') {
    view.pack = g.players.filter((p) => p.role === 'werewolf').map((p) => ({ pid: p.id, name: p.name, alive: p.isAlive }));
    if (currentStep(g)?.role === 'werewolf') view.wolfVotes = { ...g.wolfVotes };
  }
  if (g.lovers.includes(me.id)) view.lover = g.lovers.find((l) => l !== me.id);
  if (me.role === 'cupid' && g.lovers.length) view.coupled = [...g.lovers];
  if (me.role === 'seer') view.seerHistory = g.seerHistory.map((s) => ({ night: s.night, pid: s.targetId, isWolf: s.isWolf }));
  const swap = g.thiefSwap;
  if (swap && (swap.thiefId === me.id || swap.targetId === me.id)) {
    const stole = swap.thiefId === me.id;
    // Korban tidak diberi tahu siapa Pencurinya
    view.thief = { stole, otherPid: stole ? swap.targetId : undefined, stolenRole: swap.stolenRole };
  }
  if (me.role === 'insomniac') {
    view.insomniacHistory = g.insomniacHistory.map((h) => ({ night: h.night, walked: h.walked, nearestWolves: h.nearestWolfIds }));
  }
  return view;
}
