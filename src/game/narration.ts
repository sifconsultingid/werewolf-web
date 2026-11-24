// Teks narasi yang dibacakan narator (ditampilkan di layar narator dan dibacakan oleh voice-over).
// Fungsi di sini murni (tanpa DOM) agar mudah dites.

import {
  cardStolenNotice, DEATH_CAUSE_TEXT, morningAnnouncement, player, spellSentence, winnerSubtitle, winnerTitle,
  type DeathEvent, type GameState,
} from './engine';
import { ROLE_INFO, sleepScript, WAKE_SCRIPT } from './roles';
import {
  clip, DISCUSSION_SCRIPT, HUNTER_SCRIPT, MORNING_COMES, NIGHT_FALLS, NO_EXECUTION_SCRIPT, VOTE_SCRIPT,
} from './voiceLines';

export {
  DISCUSSION_SCRIPT, HUNTER_SCRIPT, MORNING_COMES, NIGHT_FALLS, TIME_UP_SCRIPT, VOTE_SCRIPT,
} from './voiceLines';

export interface Line {
  /** Kalimat lengkap (dipakai suara browser). */
  text: string;
  /** Urutan klip rekaman pengganti kalimat ini (tanpa nama pemain). */
  clips: string[];
}

export interface Narration {
  /** Identitas layar. Selama key sama, `lines` hanya bertambah di akhir (append-only). */
  key: string;
  lines: Line[];
}

const L = (text: string, ...clips: string[]): Line => ({ text, clips });

function deathLines(g: GameState, list: DeathEvent[]): Line[] {
  return list.flatMap((e) => {
    const p = player(g, e.playerId);
    if (!p) return [];
    const reveal = g.settings.revealRoleOnDeath;
    const role = reveal ? `, dan ternyata dia adalah ${ROLE_INFO[p.role].name}` : '';
    const c = DEATH_CAUSE_TEXT[e.cause];
    const clips = [clip.death(e.cause), ...(reveal ? [clip.role(p.role)] : [])];
    return [L(`${p.name}, ${c.charAt(0).toLowerCase()}${c.slice(1)}${role}.`, ...clips)];
  });
}

/** Panggilan Hunter + hasil tembakannya, disusun append-only. */
function hunterLines(g: GameState): Line[] {
  const pending = g.pendingHunters.length > 0;
  const shots = deathLines(g, g.hunterDeaths);
  if (!pending && shots.length === 0) return [];
  const out = [L(HUNTER_SCRIPT, 'hunter'), ...shots];
  if (pending && shots.length) out.push(L(HUNTER_SCRIPT, 'hunter'));
  return out;
}

function morningClips(g: GameState): string[] {
  const out: string[] = [];
  if (g.lastDeaths.length === 0) out.push('peaceful');
  for (const e of g.lastDeaths) {
    const p = player(g, e.playerId);
    if (!p) continue;
    out.push(clip.death(e.cause));
    if (g.settings.revealRoleOnDeath) out.push(clip.role(p.role));
  }
  if (player(g, g.lastRevived)) out.push('revived');
  if (player(g, g.spellTarget)) out.push(`spell_${g.spellMode}`);
  if (cardStolenNotice(g)) out.push('thief_swap');
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
      const lines = [prev ? L(sleepScript(prev.role), clip.sleep(prev.role)) : L(NIGHT_FALLS, 'night_falls')];
      const wake = WAKE_SCRIPT[step.role];
      if (wake) lines.push(L(wake, clip.wake(step.role)));
      return { key: `${base}-${g.stepIndex}`, lines };
    }
    case 'morning': {
      const last = g.nightSteps[g.nightSteps.length - 1];
      const lines = last ? [L(sleepScript(last.role), clip.sleep(last.role))] : [];
      lines.push(L(MORNING_COMES, 'morning_comes'), L(morningAnnouncement(g), ...morningClips(g)), ...hunterLines(g));
      return { key: base, lines };
    }
    case 'day': {
      const s = player(g, g.spellTarget);
      const lines = [L(DISCUSSION_SCRIPT, 'discussion')];
      if (s && s.isAlive) lines.push(L(spellSentence(g.spellMode, s.name), `spell_${g.spellMode}`));
      return { key: base, lines };
    }
    case 'vote': {
      if (!g.executionDone) return { key: `${base}-v`, lines: [L(VOTE_SCRIPT, 'vote')] };
      const lines: Line[] = [];
      const prince = player(g, g.princeSaved);
      if (prince) lines.push(L(`${prince.name} ternyata adalah Prince, dan dia selamat dari eksekusi!`, 'prince_saved'));
      else if (g.executionDeaths.length) lines.push(...deathLines(g, g.executionDeaths));
      else lines.push(L(NO_EXECUTION_SCRIPT, 'no_execution'));
      lines.push(...hunterLines(g));
      return { key: `${base}-x`, lines };
    }
    case 'gameOver': {
      const w = g.winner;
      return w ? { key: base, lines: [L(`${winnerTitle(w)} ${winnerSubtitle(w)}`, clip.win(w.kind))] } : null;
    }
    default:
      return null;
  }
}
