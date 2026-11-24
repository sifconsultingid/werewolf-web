// Voice-over narator memakai Web Speech API bawaan browser (speechSynthesis).
// Gratis, tanpa API key, berjalan di perangkat narator. Suara bahasa Indonesia dipilih otomatis
// jika tersedia di perangkat (Chrome/Edge/Safari umumnya punya "id-ID").

import type { Narration } from '../game/narration';

const PREF_KEY = 'ww:voice';

interface VoicePrefs { enabled: boolean; rate: number; voiceURI: string | null }

function loadPrefs(): VoicePrefs {
  const d: VoicePrefs = { enabled: true, rate: 1, voiceURI: null };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* abaikan */ }
  return d;
}

export interface Voice {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly rate: number;
  readonly voiceURI: string | null;
  /** Suara bahasa Indonesia (jika ada), lalu suara lain. */
  voices(): SpeechSynthesisVoice[];
  /** Ada suara Indonesia di perangkat ini? */
  hasIndonesian(): boolean;
  isSpeaking(): boolean;
  setEnabled(on: boolean): void;
  setRate(rate: number): void;
  setVoice(uri: string | null): void;
  /** Bacakan narasi layar; hanya baris yang belum dibacakan untuk key yang sama. */
  narrate(n: Narration | null): void;
  /** Catat narasi layar tanpa membacakannya (mis. saat halaman dimuat ulang). */
  prime(n: Narration | null): void;
  /** Bacakan ulang seluruh narasi terakhir. */
  replay(): void;
  say(text: string): void;
  stop(): void;
  /** Dipanggil saat daftar suara berubah (dimuat asinkron di Chrome). */
  onChange(fn: () => void): void;
}

export function createVoice(): Voice {
  const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const supported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
  let prefs = loadPrefs();
  let lastKey = '';
  let lastLines: string[] = [];
  const listeners: (() => void)[] = [];

  const save = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* */ } };

  const allVoices = (): SpeechSynthesisVoice[] => {
    if (!supported) return [];
    const list = synth!.getVoices();
    const isId = (v: SpeechSynthesisVoice) => /^id([-_]|$)/i.test(v.lang);
    return [...list.filter(isId), ...list.filter((v) => !isId(v))];
  };

  const pickVoice = (): SpeechSynthesisVoice | null => {
    const list = allVoices();
    if (prefs.voiceURI) {
      const chosen = list.find((v) => v.voiceURI === prefs.voiceURI);
      if (chosen) return chosen;
    }
    const id = list.filter((v) => /^id([-_]|$)/i.test(v.lang));
    // Utamakan suara "online/natural" (biasanya lebih halus) lalu suara lokal.
    return id.find((v) => /natural|online|google/i.test(v.name)) ?? id[0] ?? null;
  };

  const speak = (text: string) => {
    if (!supported || !prefs.enabled || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'id-ID';
    u.rate = prefs.rate;
    u.pitch = 0.9;
    synth!.speak(u);
  };

  if (supported) {
    synth!.addEventListener?.('voiceschanged', () => listeners.forEach((fn) => fn()));
  }

  return {
    supported,
    get enabled() { return prefs.enabled; },
    get rate() { return prefs.rate; },
    get voiceURI() { return prefs.voiceURI; },
    voices: allVoices,
    hasIndonesian: () => allVoices().some((v) => /^id([-_]|$)/i.test(v.lang)),
    isSpeaking: () => supported && (synth!.speaking || synth!.pending),
    setEnabled(on) {
      prefs = { ...prefs, enabled: on };
      save();
      if (!on) synth?.cancel();
    },
    setRate(rate) { prefs = { ...prefs, rate: Math.max(0.6, Math.min(1.4, rate)) }; save(); },
    setVoice(uri) { prefs = { ...prefs, voiceURI: uri }; save(); },
    narrate(n) {
      if (!n) { lastKey = ''; lastLines = []; return; }
      let from = 0;
      if (n.key === lastKey) {
        while (from < n.lines.length && from < lastLines.length && n.lines[from] === lastLines[from]) from++;
      }
      lastKey = n.key;
      lastLines = n.lines.slice();
      for (const line of n.lines.slice(from)) speak(line);
    },
    prime(n) { lastKey = n?.key ?? ''; lastLines = n?.lines.slice() ?? []; },
    replay() {
      synth?.cancel();
      for (const line of lastLines) speak(line);
    },
    say(text) { speak(text); },
    stop() { synth?.cancel(); },
    onChange(fn) { listeners.push(fn); },
  };
}
