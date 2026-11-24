// Narator otomatis: mode "host ikut main". Tidak ada orang yang menekan tombol narator; HP host
// memanggil `autoTick()` beberapa kali per detik, dan fungsi ini memindahkan fase permainan
// berdasarkan aksi pemain dan batas waktu. Fungsi di sini murni (waktu & "sedang bicara" dikirim
// sebagai parameter) supaya bisa dites tanpa browser.

import {
  alivePlayers, beginFirstRound, commitStep, currentStep, discussionLeft, eligibleVoters, execute, finishDay,
  goToDiscussion, goToVote, hunterShoots, resetBallots, votesCast, voteLeaders,
  type GameState, type Rng, type StepInput,
} from './engine';

export interface AutoTimings {
  /** Batas waktu membalik kartu & menekan Siap */
  revealSeconds: number;
  /** Batas waktu tiap peran malam */
  nightStepSeconds: number;
  /** Batas waktu voting */
  voteSeconds: number;
  /** Batas waktu Pemburu menembak */
  hunterSeconds: number;
}

export const DEFAULT_TIMINGS: AutoTimings = {
  revealSeconds: 60,
  nightStepSeconds: 30,
  voteSeconds: 60,
  hunterSeconds: 20,
};

/**
 * Durasi minimum langkah malam (acak). Langkah peran yang pemegangnya sudah mati juga memakai
 * rentang yang mirip, supaya dari lamanya langkah tidak ketahuan apakah peran itu masih hidup.
 */
export const NIGHT_MIN_MS: [number, number] = [9000, 15000];
export const NIGHT_DEAD_MS: [number, number] = [10000, 20000];
/** Jeda setelah narasi pagi / hasil voting sebelum lanjut */
export const MORNING_GRACE_MS = 4000;
export const RESULT_GRACE_MS = 5000;
/** Jeda setelah semua pemain memilih (masih boleh mengganti pilihan) */
export const ALL_VOTED_GRACE_MS = 3000;
/** Jeda setelah semua pemain menekan Siap */
export const ALL_READY_GRACE_MS = 2000;

export interface AutoState {
  /** Identitas tahap saat ini (berganti → timer baru) */
  stage: string;
  /** Kapan timer tahap ini mulai (null = menunggu narasi selesai) */
  startedAt: number | null;
  /** Batas waktu tahap ini */
  endsAt: number | null;
  /** Langkah malam: paling cepat boleh ditutup */
  minAt: number | null;
  /** Aksi malam yang sudah dikirim, menunggu durasi minimum */
  pending: { stage: string; input: StepInput } | null;
  /** Hari ketika voting ulang sudah dipakai */
  revoteDay: number;
  paused: boolean;
  pausedAt: number | null;
  /** Diskusi ikut dijeda oleh tombol Jeda host */
  pausedDiscussion: boolean;
}

export function newAutoState(): AutoState {
  return {
    stage: '', startedAt: null, endsAt: null, minAt: null, pending: null, revoteDay: 0,
    paused: false, pausedAt: null, pausedDiscussion: false,
  };
}

export type StageKind = 'reveal' | 'night' | 'morning' | 'hunter' | 'day' | 'vote' | 'result' | 'over';

export function stageOf(g: GameState, a: AutoState): { key: string; kind: StageKind } {
  switch (g.phase) {
    case 'reveal': return { key: 'reveal', kind: 'reveal' };
    case 'night': return { key: `n${g.nightNumber}-s${g.stepIndex}-${currentStep(g)?.role}`, kind: 'night' };
    case 'morning':
      return g.pendingHunters.length
        ? { key: `hunter-m${g.dayNumber}-${g.pendingHunters[0]}`, kind: 'hunter' }
        : { key: `morning-${g.dayNumber}`, kind: 'morning' };
    case 'day': return { key: `day-${g.dayNumber}`, kind: 'day' };
    case 'vote':
      if (!g.executionDone) return { key: `vote-${g.dayNumber}-${a.revoteDay === g.dayNumber ? 1 : 0}`, kind: 'vote' };
      return g.pendingHunters.length
        ? { key: `hunter-v${g.dayNumber}-${g.pendingHunters[0]}`, kind: 'hunter' }
        : { key: `result-${g.dayNumber}`, kind: 'result' };
    case 'gameOver': return { key: 'over', kind: 'over' };
  }
}

const between = (rng: Rng, [lo, hi]: [number, number]) => lo + Math.floor(rng() * (hi - lo));

function wolvesAgree(g: GameState): string | null {
  const pack = alivePlayers(g).filter((p) => p.role === 'werewolf');
  const picks = pack.map((w) => g.wolfVotes[w.id]);
  return pack.length && picks.every((t) => t && t === picks[0]) ? picks[0] : null;
}

/** Tutup langkah malam. Jika input tidak sah (mis. timeout Cupid), langkah dilewati tanpa aksi. */
function closeStep(g: GameState, input: StepInput, now: number): void {
  try { commitStep(g, input, now); } catch { commitStep(g, {}, now, true); }
}

export interface TickOptions {
  /** Voice-over sedang membacakan narasi: timer belum mulai & fase tidak berpindah */
  speaking?: boolean;
  rng?: Rng;
  timings?: AutoTimings;
}

/**
 * Jalankan narator otomatis satu kali. Mengembalikan true jika state berubah
 * (perlu disimpan & dikirim ulang ke pemain).
 */
export function autoTick(g: GameState, a: AutoState, now: number, opts: TickOptions = {}): boolean {
  const t = opts.timings ?? DEFAULT_TIMINGS;
  const rng = opts.rng ?? Math.random;
  if (a.paused) return false;
  let changed = false;

  const st = stageOf(g, a);
  if (a.stage !== st.key) {
    a.stage = st.key;
    a.startedAt = null;
    a.endsAt = null;
    a.minAt = null;
    if (a.pending && a.pending.stage !== st.key) a.pending = null;
    changed = true;
  }
  if (st.kind === 'over') return changed;

  // Timer baru mulai setelah narasi selesai dibacakan
  if (a.startedAt === null) {
    if (opts.speaking) return changed;
    a.startedAt = now;
    switch (st.kind) {
      case 'reveal': a.endsAt = now + t.revealSeconds * 1000; break;
      case 'night': {
        const step = currentStep(g)!;
        if (step.active) {
          a.minAt = now + between(rng, NIGHT_MIN_MS);
          a.endsAt = now + t.nightStepSeconds * 1000;
        } else {
          a.endsAt = now + between(rng, NIGHT_DEAD_MS);
        }
        break;
      }
      case 'morning': a.endsAt = now + MORNING_GRACE_MS; break;
      case 'hunter': a.endsAt = now + t.hunterSeconds * 1000; break;
      case 'vote': a.endsAt = now + t.voteSeconds * 1000; break;
      case 'result': a.endsAt = now + RESULT_GRACE_MS; break;
      case 'day': break; // memakai timer diskusi milik engine
    }
    changed = true;
  }
  if (opts.speaking) return changed;

  const due = a.endsAt !== null && now >= a.endsAt;
  switch (st.kind) {
    case 'reveal':
      if (!due && g.ready.length >= g.players.length) {
        const soon = now + ALL_READY_GRACE_MS;
        if (a.endsAt === null || a.endsAt > soon) { a.endsAt = soon; changed = true; }
        break;
      }
      if (due) { beginFirstRound(g, now); changed = true; }
      break;

    case 'night': {
      const step = currentStep(g)!;
      const minOk = a.minAt === null || now >= a.minAt;
      if (!step.active) {
        if (due) { closeStep(g, {}, now); changed = true; }
      } else if (step.role === 'werewolf') {
        const target = wolvesAgree(g);
        // Serigala tidak sepakat sampai waktu habis → tidak ada korban
        if (target && minOk) { closeStep(g, { target }, now); changed = true; }
        else if (due) { commitStep(g, {}, now, true); changed = true; }
      } else if (a.pending && a.pending.stage === a.stage && minOk) {
        closeStep(g, a.pending.input, now);
        a.pending = null;
        changed = true;
      } else if (due) {
        closeStep(g, {}, now);
        a.pending = null;
        changed = true;
      }
      break;
    }

    case 'morning':
      if (due) { goToDiscussion(g, now); changed = true; }
      break;

    case 'hunter':
      if (due) { hunterShoots(g, null); changed = true; }
      break;

    case 'day':
      if (g.discussionEndsAt !== null && discussionLeft(g, now) <= 0) { goToVote(g); changed = true; }
      break;

    case 'vote': {
      const eligible = eligibleVoters(g).length;
      if (!due && eligible > 0 && votesCast(g) >= eligible) {
        const soon = now + ALL_VOTED_GRACE_MS;
        if (a.endsAt === null || a.endsAt > soon) { a.endsAt = soon; changed = true; }
        break;
      }
      if (!due) break;
      const leaders = voteLeaders(g);
      if (leaders.length === 1) execute(g, leaders[0]);
      else if (leaders.length > 1 && a.revoteDay !== g.dayNumber) {
        // Seri → voting ulang sekali
        a.revoteDay = g.dayNumber;
        resetBallots(g);
      } else execute(g, null);
      changed = true;
      break;
    }

    case 'result':
      if (due) { finishDay(g); changed = true; }
      break;
  }

  // Tahap baru memulai timernya di tick berikutnya, setelah narasinya sempat dibacakan.
  return changed;
}

/** Tombol Jeda / Lanjut milik host. */
export function setPaused(g: GameState, a: AutoState, paused: boolean, now: number): void {
  if (paused === a.paused) return;
  if (paused) {
    a.paused = true;
    a.pausedAt = now;
    if (g.phase === 'day' && g.discussionEndsAt !== null) {
      g.discussionPausedRemaining = discussionLeft(g, now);
      g.discussionEndsAt = null;
      a.pausedDiscussion = true;
    }
    return;
  }
  const delta = now - (a.pausedAt ?? now);
  if (a.endsAt !== null) a.endsAt += delta;
  if (a.minAt !== null) a.minAt += delta;
  if (a.pausedDiscussion && g.phase === 'day' && g.discussionPausedRemaining !== null) {
    g.discussionEndsAt = now + g.discussionPausedRemaining * 1000;
    g.discussionPausedRemaining = null;
  }
  a.pausedDiscussion = false;
  a.paused = false;
  a.pausedAt = null;
}

/** Batas waktu yang boleh ditampilkan ke semua pemain (bukan malam: bisa membocorkan peran mati). */
export function publicDeadline(g: GameState, a: AutoState): number | null {
  const kind = stageOf(g, a).kind;
  return kind === 'reveal' || kind === 'vote' || kind === 'hunter' ? a.endsAt : null;
}
