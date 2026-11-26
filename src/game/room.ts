// "Ruang" permainan: kursi pemain + state permainan, aksi dari pemain, dan tampilan yang
// disaring per pemain. Semua dijalankan di sisi narator. Fungsi di sini murni (tanpa jaringan)
// supaya bisa dites.

import {
  alivePlayers, autoAssignRoles, castVote, commitStep, createGame, currentStep, DEFAULT_SETTINGS,
  eligibleVoters, hunterShoots, insomniacPeek, cardStolenNotice, cardsSwappedNotice, morningAnnouncement, seerPeek, player, troublemakerLeft, stepCandidates, votes,
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
  /** Permintaan kembali ke kursi dari perangkat/browser baru (uid baru → pid kursi), menunggu host */
  reclaims?: Record<string, { pid: string; at: number }>;
}

/** Pesan galat pemain hanya tampil sebentar (tidak menempel sampai permainan selesai) */
export const NOTICE_MS = 8000;

export interface RoomOptions {
  autoNarrator?: boolean;
  timings?: AutoTimings;
}

export type PlayerAction =
  | { type: 'join'; name: string }
  | { type: 'hello' }
  | { type: 'ready' }
  | { type: 'night'; input: StepInput }
  /** Seer/Insomniac: lihat hasil dulu, lalu kirim 'night' untuk tidur kembali */
  | { type: 'peek'; target?: string; walk?: boolean }
  | { type: 'wolfVote'; target: string | null }
  | { type: 'vote'; target: string | null }
  | { type: 'hunter'; target: string | null }
  /** Pemain yang pindah perangkat/browser minta dikembalikan ke kursinya (disetujui host) */
  | { type: 'reclaim'; pid: string | null };

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

  if (action.type === 'reclaim') {
    if (seat || inLobby(room)) return false;
    room.reclaims ??= {};
    if (action.pid === null) { delete room.reclaims[uid]; return true; }
    const target = room.seats.find((s) => s.pid === action.pid);
    if (!target || target.uid === room.hostUid) return fail('Kursi tidak ditemukan.');
    room.reclaims[uid] = { pid: target.pid, at: now };
    return true;
  }

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
  // Saat dijeda host, tidak ada aksi permainan yang diproses (termasuk antrean lama saat host memuat ulang)
  if (room.auto?.paused && action.type !== 'ready') return fail('Permainan sedang dijeda host.');
  // Aksi sah berikutnya menghapus pesan galat lama
  const ok = () => { delete room.notices[uid]; return true; };

  try {
    switch (action.type) {
      case 'ready':
        if (g.phase !== 'reveal' || g.ready.includes(me.id)) return false;
        g.ready.push(me.id);
        return ok();

      case 'wolfVote': {
        const step = currentStep(g);
        if (!step || step.role !== 'werewolf' || !step.active || me.role !== 'werewolf' || !me.isAlive) {
          return fail('Bukan giliranmu.');
        }
        if (action.target === null) {
          delete g.wolfVotes[me.id];
          return ok();
        }
        if (!stepCandidates(g, 'werewolf').some((p) => p.id === action.target)) return fail('Target tidak sah.');
        g.wolfVotes[me.id] = action.target;
        if (room.auto) return ok(); // narator otomatis menutup langkah setelah durasi minimum
        const pack = alivePlayers(g).filter((p) => p.role === 'werewolf');
        const picks = pack.map((w) => g.wolfVotes[w.id]);
        if (picks.every((t) => t && t === picks[0])) commitStep(g, { target: picks[0] }, now);
        return ok();
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
          return ok();
        }
        commitStep(g, input, now);
        return ok();
      }

      case 'peek': {
        const step = currentStep(g);
        if (!step || !step.active || me.role !== step.role || !me.isAlive) return fail('Bukan giliranmu.');
        if (step.role === 'seer' && typeof action.target === 'string') seerPeek(g, action.target);
        else if (step.role === 'insomniac') insomniacPeek(g, !!action.walk);
        else return fail('Aksi tidak sah.');
        return ok();
      }

      case 'vote':
        castVote(g, me.id, action.target ?? null);
        return ok();

      case 'hunter':
        if (g.pendingHunters[0] !== me.id) return fail('Bukan giliranmu.');
        hunterShoots(g, action.target ?? null);
        return ok();

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
  if (Array.isArray(i.swap) && i.swap.length === 2) {
    const [a, b] = i.swap.map(str);
    if (a && b) out.swap = [a, b];
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
  room.reclaims = {};
  room.auto = room.autoNarrator ? newAutoState() : null;
}

/** Host menyetujui (atau menolak) pemain yang kembali dari perangkat/browser baru. */
export function resolveReclaim(room: Room, uid: string, approve: boolean): void {
  const req = room.reclaims?.[uid];
  if (!req) return;
  delete room.reclaims![uid];
  if (!approve || seatOf(room, uid)) return;
  const seat = room.seats.find((s) => s.pid === req.pid);
  if (!seat || seat.uid === room.hostUid) return;
  delete room.notices[seat.uid];
  seat.uid = uid;
  // Permintaan lain untuk kursi yang sama tidak berlaku lagi
  for (const [u, r] of Object.entries(room.reclaims!)) if (r.pid === req.pid) delete room.reclaims![u];
}

/** Kembali ke lobi dengan pemain yang sama (untuk main lagi). */
export function backToLobby(room: Room): void {
  room.game = null;
  room.auto = null;
  room.notices = {};
  room.reclaims = {};
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
  /** Thief beraksi semalam (diumumkan ke semua, tanpa nama) */
  cardStolen?: boolean;
  /** Troublemaker beraksi semalam (diumumkan ke semua, tanpa nama) */
  cardsSwapped?: boolean;
  /** Mode narator otomatis */
  auto?: {
    paused: boolean;
    /** Batas waktu tahap ini (reveal, voting, Hunter) */
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
  /** Witch: korban serigala malam ini */
  victim?: string | null;
  canHeal?: boolean;
  canPoison?: boolean;
  /** Bodyguard: tidak boleh melindungi orang ini */
  lastProtected?: string | null;
  /** Necromancer: kekuatan sudah terpakai */
  used?: boolean;
  /** Seer: hasil terawangan malam ini (sudah dilihat, tinggal tidur kembali) */
  peeked?: { pid: string; isWolf: boolean };
  /** Insomniac: keputusan malam ini */
  walked?: { walked: boolean; nearestWolves: string[] };
  /** Troublemaker: sisa kesempatan menukar */
  left?: number;
}

export interface PrivateView {
  v: 1;
  joined: boolean;
  pid?: string;
  name?: string;
  notice?: string;
  /** Menunggu host menyetujui kembali ke kursi ini */
  reclaiming?: string;
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
  /** Thief: kartu yang kamu curi / korban: kartumu dicuri (peranmu sekarang ada di `role`) */
  thief?: { stole: boolean; otherPid?: string; stolenRole: Role; night: number };
  /** Troublemaker: dua orang yang kamu tukar (tanpa kartunya) / korban: peran barumu (tanpa nama pelaku) */
  troublemaker?: { swapped: string[]; night: number; left: number } | { newRole: Role; night: number };
  action?: ActionPrompt | null;
  updatedAt: number;
}

/**
 * Peran yang boleh dilihat semua orang untuk kursi ini (undefined = rahasia).
 * Prince yang selamat dari voting tetap tampil sebagai Prince: itu fakta yang sudah diumumkan.
 * Kalau kartunya kemudian dicuri/ditukar, peran barunya TIDAK boleh ikut terbuka.
 */
function publicRole(g: GameState, pid: string): Role | undefined {
  const p = player(g, pid);
  if (!p) return undefined;
  if (g.phase === 'gameOver') return p.role;
  if (!p.isAlive && g.settings.revealRoleOnDeath) return p.role;
  // Tanner yang dieksekusi selalu terbuka
  if (!p.isAlive && p.role === 'tanner' && g.executedId === p.id) return p.role;
  if (p.princeRevealed) return 'prince';
  return undefined;
}

function publicDeaths(g: GameState, list: { playerId: string; cause: DeathCause }[]): PublicDeath[] {
  return list.map((d) => {
    const p = player(g, d.playerId);
    return {
      pid: d.playerId,
      cause: d.cause,
      role: (d.cause === 'vote' && p?.role === 'tanner') ? p.role : publicRole(g, d.playerId),
    };
  });
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
      role: publicRole(g, p.id),
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
    cardStolen: cardStolenNotice(g) || undefined,
    cardsSwapped: cardsSwappedNotice(g) || undefined,
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
    case 'troublemaker':
      return { key, kind: 'troublemaker', candidates, left: troublemakerLeft(g) };
    default:
      return { key, kind: step.role, candidates };
  }
}

export function buildPrivateView(room: Room, uid: string, now = Date.now()): PrivateView {
  const seat = seatOf(room, uid);
  const n = room.notices[uid];
  const notice = n && now - n.at < NOTICE_MS ? n.text : undefined;
  if (!seat) return { v: 1, joined: false, notice, reclaiming: room.reclaims?.[uid]?.pid, updatedAt: now };
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
  // Catatan rahasia ikut ORANG yang melakukannya, bukan kartunya (kartu bisa dicuri/ditukar).
  // State lama tanpa `by`/`cupidId`: pakai pemegang kartu saat ini.
  const mine = (by: string | undefined, role: Role) => (by ? by === me.id : me.role === role);
  if (g.lovers.length && (g.cupidId != null ? g.cupidId === me.id : me.role === 'cupid')) view.coupled = [...g.lovers];
  const seen = g.seerHistory.filter((s) => mine(s.by, 'seer'));
  if (seen.length || me.role === 'seer') view.seerHistory = seen.map((s) => ({ night: s.night, pid: s.targetId, isWolf: s.isWolf }));
  const swap = g.thiefSwap;
  // Korban baru tahu saat pagi (kartu ditukar saat pagi); Thief langsung tahu curiannya
  if (swap && (swap.thiefId === me.id || (swap.applied && swap.targetId === me.id))) {
    const stole = swap.thiefId === me.id;
    // Korban tidak diberi tahu siapa Thiefnya
    view.thief = { stole, otherPid: stole ? swap.targetId : undefined, stolenRole: swap.stolenRole, night: swap.night ?? 1 };
  }
  const swaps = g.troublemakerHistory?.length ? g.troublemakerHistory : g.troublemakerSwap ? [g.troublemakerSwap] : [];
  // Korban baru tahu saat pagi; Troublemaker tahu siapa yang ditukar tapi tidak melihat kartunya.
  // Peran baru korban = perannya sekarang (bisa sudah berubah lagi setelah itu).
  const hit = [...swaps].reverse().find((t) => t.applied && t.pids.includes(me.id));
  const own = [...swaps].reverse().find((t) => t.troublemakerId === me.id);
  if (hit && (!own || (hit.night ?? 1) >= (own.night ?? 1))) view.troublemaker = { newRole: me.role, night: hit.night ?? 1 };
  else if (own) view.troublemaker = { swapped: [...own.pids], night: own.night ?? 1, left: troublemakerLeft(g) };
  const walks = g.insomniacHistory.filter((h) => mine(h.by, 'insomniac'));
  if (walks.length || me.role === 'insomniac') {
    view.insomniacHistory = walks.map((h) => ({ night: h.night, walked: h.walked, nearestWolves: h.nearestWolfIds }));
  }
  return view;
}
