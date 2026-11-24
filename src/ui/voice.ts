// Voice-over narator.
// 1) Utama: klip rekaman MP3 (suara neural Bahasa Indonesia, mis. Gadis) di public/vo/<suara>/.
//    Sama di semua browser dan tanpa API key saat game berjalan.
// 2) Cadangan: Web Speech API bawaan browser (speechSynthesis), dipakai jika rekaman tidak ada
//    atau pengguna memilih suara browser.

import type { Line, Narration } from '../game/narration';
import { GREETING_SCRIPT, VOICE_CLIPS } from '../game/voiceLines';

const PREF_KEY = 'ww:voice';
/** Nilai voiceURI khusus untuk memakai klip rekaman. */
export const RECORDED = 'recorded';
const RECORDED_VOICE = 'gadis';
const RECORDED_LABEL = 'Gadis — rekaman (paling natural)';

interface VoicePrefs { enabled: boolean; rate: number; voiceURI: string | null }

function loadPrefs(): VoicePrefs {
  const d: VoicePrefs = { enabled: true, rate: 1, voiceURI: null };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* abaikan */ }
  return d;
}

type Item = { kind: 'clip'; id: string } | { kind: 'tts'; text: string };

export interface Voice {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly rate: number;
  /** null = otomatis (rekaman jika ada, lalu suara Indonesia terbaik). */
  readonly voiceURI: string | null;
  readonly recordedAvailable: boolean;
  readonly recordedLabel: string;
  /** Suara browser: bahasa Indonesia (jika ada), lalu suara lain. */
  voices(): SpeechSynthesisVoice[];
  hasIndonesian(): boolean;
  /** Sedang memakai klip rekaman? */
  usingRecorded(): boolean;
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
  /** Bacakan satu kalimat; pakai klip `clipId` jika rekaman aktif. */
  say(text: string, clipId?: string): void;
  /** Contoh suara yang sedang dipilih. */
  test(): void;
  stop(): void;
  /** Dipanggil saat daftar suara / ketersediaan rekaman berubah. */
  onChange(fn: () => void): void;
}

const isId = (v: SpeechSynthesisVoice) => /^id([-_]|$)/i.test(v.lang);

export function createVoice(): Voice {
  const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
  const audioSupported = typeof Audio !== 'undefined';
  let prefs = loadPrefs();
  let lastKey = '';
  let lastLines: Line[] = [];
  let recordedAvailable = false;
  const listeners: (() => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn());

  // Antrean pemutaran gabungan (klip & TTS), satu per satu.
  let queue: Item[] = [];
  let playing = false;
  let audio: HTMLAudioElement | null = null;
  let gen = 0;

  const save = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* */ } };

  const clipUrl = (id: string) => `${import.meta.env.BASE_URL}vo/${RECORDED_VOICE}/${id}.mp3`;

  // Cek apakah klip rekaman tersedia (manifest dibuat oleh scripts/generate-vo.sh).
  if (audioSupported && typeof fetch !== 'undefined') {
    fetch(`${import.meta.env.BASE_URL}vo/${RECORDED_VOICE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { clips?: string[] } | null) => {
        recordedAvailable = !!m?.clips?.length;
        notify();
      })
      .catch(() => { /* tidak ada rekaman → suara browser */ });
  }

  const allVoices = (): SpeechSynthesisVoice[] => {
    if (!ttsSupported) return [];
    const list = synth!.getVoices();
    return [...list.filter(isId), ...list.filter((v) => !isId(v))];
  };

  const useRecorded = () => recordedAvailable && (prefs.voiceURI === null || prefs.voiceURI === RECORDED);

  const pickVoice = (): SpeechSynthesisVoice | null => {
    const list = allVoices();
    if (prefs.voiceURI && prefs.voiceURI !== RECORDED) {
      const chosen = list.find((v) => v.voiceURI === prefs.voiceURI);
      if (chosen) return chosen;
    }
    const id = list.filter(isId);
    // Utamakan suara "online/natural" (biasanya lebih halus) lalu suara lokal.
    return id.find((v) => /natural|online|google/i.test(v.name)) ?? id[0] ?? null;
  };

  function next() {
    const my = gen;
    const item = queue.shift();
    if (!item) { playing = false; return; }
    playing = true;
    const done = () => { if (my === gen) next(); };
    if (item.kind === 'clip') {
      audio = new Audio(clipUrl(item.id));
      audio.playbackRate = prefs.rate;
      audio.onended = done;
      audio.onerror = () => {
        // Klip hilang → bacakan teksnya dengan suara browser.
        const text = VOICE_CLIPS[item.id];
        if (text && my === gen) queue.unshift({ kind: 'tts', text });
        done();
      };
      audio.play().catch(() => done());
    } else {
      if (!ttsSupported) { done(); return; }
      const u = new SpeechSynthesisUtterance(item.text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? 'id-ID';
      u.rate = prefs.rate;
      u.pitch = 0.9;
      u.onend = done;
      u.onerror = done;
      synth!.speak(u);
    }
  }

  function enqueue(items: Item[]) {
    if (!prefs.enabled || !items.length) return;
    queue.push(...items);
    if (!playing) next();
  }

  function stop() {
    gen++;
    queue = [];
    playing = false;
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio = null; }
    synth?.cancel();
  }

  const itemsFor = (lines: Line[]): Item[] =>
    lines.flatMap((l): Item[] =>
      useRecorded() && l.clips.length
        ? l.clips.map((id) => ({ kind: 'clip', id }))
        : l.text.trim() ? [{ kind: 'tts', text: l.text }] : []);

  if (ttsSupported) synth!.addEventListener?.('voiceschanged', notify);

  return {
    supported: ttsSupported || audioSupported,
    get enabled() { return prefs.enabled; },
    get rate() { return prefs.rate; },
    get voiceURI() { return prefs.voiceURI; },
    get recordedAvailable() { return recordedAvailable; },
    recordedLabel: RECORDED_LABEL,
    voices: allVoices,
    hasIndonesian: () => allVoices().some(isId),
    usingRecorded: useRecorded,
    isSpeaking: () => playing || (ttsSupported && (synth!.speaking || synth!.pending)),
    setEnabled(on) {
      prefs = { ...prefs, enabled: on };
      save();
      if (!on) stop();
    },
    setRate(rate) { prefs = { ...prefs, rate: Math.max(0.6, Math.min(1.4, rate)) }; save(); },
    setVoice(uri) { prefs = { ...prefs, voiceURI: uri }; save(); },
    narrate(n) {
      if (!n) { lastKey = ''; lastLines = []; return; }
      let from = 0;
      if (n.key === lastKey) {
        while (from < n.lines.length && from < lastLines.length && n.lines[from].text === lastLines[from].text) from++;
      }
      lastKey = n.key;
      lastLines = n.lines.slice();
      enqueue(itemsFor(n.lines.slice(from)));
    },
    prime(n) { lastKey = n?.key ?? ''; lastLines = n?.lines.slice() ?? []; },
    replay() { stop(); enqueue(itemsFor(lastLines)); },
    say(text, clipId) { enqueue(itemsFor([{ text, clips: clipId ? [clipId] : [] }])); },
    test() { stop(); enqueue(itemsFor([{ text: GREETING_SCRIPT, clips: ['greeting'] }])); },
    stop,
    onChange(fn) { listeners.push(fn); },
  };
}
