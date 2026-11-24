// Teks narasi yang dibacakan narator (ditampilkan di layar narator dan dibacakan oleh voice-over).
// Fungsi di sini murni (tanpa DOM) agar mudah dites.

import {
  DEATH_CAUSE_TEXT, morningAnnouncement, player, spellSentence, winnerSubtitle, winnerTitle,
  type DeathEvent, type GameState,
} from './engine';
import { ROLE_INFO, sleepScript, WAKE_SCRIPT } from './roles';

export const NIGHT_FALLS = 'Malam telah tiba. Semua warga desa, tutup mata kalian.';
export const MORNING_COMES = 'Pagi telah tiba. Semua warga desa, buka mata kalian.';
export const VOTE_SCRIPT = 'Saatnya voting. Pilih orang yang kalian curigai sebagai serigala di HP masing-masing.';
export const HUNTER_SCRIPT = 'Pemburu, sebelum mati, tembak satu orang!';
export const DISCUSSION_SCRIPT = 'Silakan berdiskusi. Cari tahu siapa serigala di antara kalian.';
export const TIME_UP_SCRIPT = 'Waktu diskusi habis.';

export interface Narration {
  /** Identitas layar. Selama key sama, `lines` hanya bertambah di akhir (append-only). */
  key: string;
  lines: string[];
}

function deathSentences(g: GameState, list: DeathEvent[]): string[] {
  return list.flatMap((e) => {
    const p = player(g, e.playerId);
    if (!p) return [];
    const role = g.settings.revealRoleOnDeath ? `, dan ternyata dia adalah ${ROLE_INFO[p.role].name}` : '';
    const c = DEATH_CAUSE_TEXT[e.cause];
    return [`${p.name}, ${c.charAt(0).toLowerCase()}${c.slice(1)}${role}.`];
  });
}

/** Panggilan Pemburu + hasil tembakannya, disusun append-only. */
function hunterLines(g: GameState): string[] {
  const pending = g.pendingHunters.length > 0;
  const shots = deathSentences(g, g.hunterDeaths);
  if (!pending && shots.length === 0) return [];
  const out = [HUNTER_SCRIPT, ...shots];
  if (pending && shots.length) out.push(HUNTER_SCRIPT);
  return out;
}

/** Narasi untuk layar narator saat ini. `null` jika tidak ada yang perlu dibacakan. */
export function narrationFor(g: GameState): Narration | null {
  const base = `${g.phase}-${g.nightNumber}-${g.dayNumber}`;
  switch (g.phase) {
    case 'night': {
      const step = g.nightSteps[g.stepIndex];
      if (!step) return null;
      const prev = g.nightSteps[g.stepIndex - 1];
      const lines = [prev ? sleepScript(prev.role) : NIGHT_FALLS];
      const wake = WAKE_SCRIPT[step.role];
      if (wake) lines.push(wake);
      return { key: `${base}-${g.stepIndex}`, lines };
    }
    case 'morning': {
      const last = g.nightSteps[g.nightSteps.length - 1];
      const lines = last ? [sleepScript(last.role)] : [];
      lines.push(MORNING_COMES, morningAnnouncement(g), ...hunterLines(g));
      return { key: base, lines };
    }
    case 'day': {
      const s = player(g, g.spellTarget);
      const lines = [DISCUSSION_SCRIPT];
      if (s && s.isAlive) lines.push(spellSentence(g.spellMode, s.name));
      return { key: base, lines };
    }
    case 'vote': {
      if (!g.executionDone) return { key: `${base}-v`, lines: [VOTE_SCRIPT] };
      const lines: string[] = [];
      const prince = player(g, g.princeSaved);
      if (prince) lines.push(`${prince.name} ternyata adalah Pangeran, dan dia selamat dari eksekusi!`);
      else if (g.executionDeaths.length) lines.push(...deathSentences(g, g.executionDeaths));
      else lines.push('Tidak ada yang dieksekusi hari ini.');
      lines.push(...hunterLines(g));
      return { key: `${base}-x`, lines };
    }
    case 'gameOver': {
      const w = g.winner;
      return w ? { key: base, lines: [`${winnerTitle(w)} ${winnerSubtitle(w)}`] } : null;
    }
    default:
      return null;
  }
}
