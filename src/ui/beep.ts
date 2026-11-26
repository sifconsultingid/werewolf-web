// Bunyi alarm (bip-bip) + getar tiap detik di 10 detik terakhir hitung mundur.
// Di HP host, bip diputar lewat elemen audio narator (izin audio sudah terbuka, ikut tombol suara,
// dan tidak menabrak narasi). Di HP pemain, pakai Web Audio (terbuka setelah ketukan pertama).

import type { Voice } from './voice';

const WARN_FROM = 10;
type Kind = 'tick' | 'urgent' | 'end';

export interface Beeper {
  /**
   * Panggil sesering mungkin dengan sisa detik timer yang tampil (null = tidak ada timer).
   * `source` membedakan layar yang memanggil (di HP host: layar host & layar pemain milik host),
   * supaya satu layar tanpa timer tidak me-reset hitungan layar lain (bip dobel).
   */
  update(secondsLeft: number | null, source?: string): void;
  /** Pakai pemutar narator untuk bip (HP host). */
  attachVoice(voice: Voice): void;
}

/** Nada: [frekuensi Hz, mulai dtk, durasi dtk] */
const PATTERNS: Record<Kind, [number, number, number][]> = {
  tick: [[1047, 0, 0.14], [1319, 0.18, 0.14]],
  urgent: [[1568, 0, 0.1], [1568, 0.15, 0.1], [1568, 0.3, 0.1]],
  end: [[880, 0, 0.25], [660, 0.25, 0.25], [440, 0.5, 0.6]],
};

/** Render pola nada jadi WAV (data URI) untuk diputar lewat elemen <audio>. */
function patternWav(kind: Kind): string {
  const rate = 22050;
  const tones = PATTERNS[kind];
  const total = Math.max(...tones.map(([, at, d]) => at + d)) + 0.05;
  const n = Math.ceil(total * rate);
  const pcm = new Int16Array(n);
  for (const [f, at, d] of tones) {
    const s0 = Math.floor(at * rate);
    const len = Math.floor(d * rate);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, i / (0.01 * rate), (len - i) / (0.03 * rate));
      const saw = 2 * ((t * f) % 1) - 1;
      pcm[s0 + i] += Math.round(saw * env * 0.35 * 32767);
    }
  }
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, pcm[i], true);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

let shared: Beeper | null = null;

/** Satu beeper per halaman (layar host + layar pemain di HP yang sama tidak bunyi dobel). */
export function createBeeper(): Beeper {
  return (shared ??= makeBeeper());
}

function makeBeeper(): Beeper {
  const AC: typeof AudioContext | undefined =
    typeof window !== 'undefined' ? (window.AudioContext ?? (window as any).webkitAudioContext) : undefined;
  let ctx: AudioContext | null = null;
  let last: number | null = null;
  /** Nilai terakhir dari tiap layar; yang tidak melapor > 1,5 dtk dianggap sudah tidak ada */
  const sources = new Map<string, { sec: number | null; at: number }>();
  let voice: Voice | null = null;
  const wavs: Partial<Record<Kind, string>> = {};

  const ensure = () => {
    // iOS 17+: tetap bunyi walau saklar silent menyala (kategori "playback")
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch { /* */ }
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch { return null; } }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* */ });
    return ctx;
  };
  if (typeof document !== 'undefined') {
    for (const ev of ['touchend', 'click'] as const) document.addEventListener(ev, () => { if (!voice) ensure(); }, true);
  }

  function webAudio(kind: Kind) {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    for (const [f, at, d] of PATTERNS[kind]) {
      const t = c.currentTime + at;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      gain.gain.setValueAtTime(0.35, t + d - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
  }

  /** iPhone tidak bisa bergetar dari web: kedipkan layar sebagai pengganti tanda visual */
  function flash(s: number) {
    if (typeof document === 'undefined') return;
    const b = document.body;
    b.classList.remove('beep-flash', 'beep-flash-urgent');
    void b.offsetWidth; // ulang animasi
    b.classList.add(s <= 3 ? 'beep-flash-urgent' : 'beep-flash');
  }

  function play(kind: Kind) {
    if (voice) {
      // Ikut tombol suara narator; dilewati kalau narator sedang bicara
      voice.sfx((wavs[kind] ??= patternWav(kind)));
      return;
    }
    webAudio(kind);
  }

  return {
    attachVoice(v) { voice = v; },
    update(secondsLeft, source = 'main') {
      const now = Date.now();
      sources.set(source, { sec: secondsLeft, at: now });
      let soonest: number | null = null;
      for (const [k, v] of sources) {
        if (now - v.at > 1500) { sources.delete(k); continue; }
        if (v.sec !== null && (soonest === null || v.sec < soonest)) soonest = v.sec;
      }
      if (soonest === null || soonest > WARN_FROM) { last = null; return; }
      const s = Math.max(0, Math.ceil(soonest));
      if (s === last) return;
      last = s;
      play(s === 0 ? 'end' : s <= 3 ? 'urgent' : 'tick');
      flash(s);
      try { navigator.vibrate?.(s === 0 ? [300, 100, 300] : s <= 3 ? 120 : 60); } catch { /* */ }
    },
  };
}
