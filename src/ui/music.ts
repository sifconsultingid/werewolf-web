// Musik latar per fase, diputar di HP host (narator).
//
// Semua musik dibuat sendiri dengan kode (Web Audio, OfflineAudioContext) saat pertama dibutuhkan:
// tanpa file MP3, tanpa lisensi pihak ketiga, ukuran unduhan ±0 KB.
// Tiap fase punya loop sendiri yang tersambung mulus (ekor nada di akhir loop dilipat ke awal).
//
// Diputar lewat Web Audio (bukan <audio>) karena Safari iOS mengabaikan `audio.volume`;
// dengan GainNode, musik bisa dikecilkan (ducking) saat narator bicara.

export type Mood = 'reveal' | 'night' | 'morning' | 'day' | 'vote' | 'gameOver';

export const MOOD_LABEL: Record<Mood, string> = {
  reveal: 'Lihat kartu',
  night: 'Malam',
  morning: 'Pagi',
  day: 'Diskusi',
  vote: 'Voting',
  gameOver: 'Akhir permainan',
};

const PREF_KEY = 'ww:music';
const SR = 24000;
const TAIL = 7; // detik ekor (release + gema) yang dilipat ke awal loop
const DUCK = 0.25; // volume musik saat narator bicara
const FADE = 1.5; // detik crossfade antar fase

interface MusicPrefs { enabled: boolean; volume: number }

function loadPrefs(): MusicPrefs {
  const d: MusicPrefs = { enabled: true, volume: 0.5 };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* abaikan */ }
  return d;
}

export interface Music {
  readonly supported: boolean;
  readonly enabled: boolean;
  /** 0..1 */
  readonly volume: number;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  /** Ganti musik sesuai fase (null = hening, mis. di setup/lobi). */
  setMood(m: Mood | null): void;
  /** Kecilkan musik (narator sedang bicara / permainan dijeda). */
  setDucked(on: boolean): void;
  /** Panggil dari dalam ketukan pengguna (izin audio iOS). */
  unlock(): void;
}

// ---------- Sintesis ----------

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
/** 'A4' → 440 */
export function hz(n: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`nada? ${n}`);
  const midi = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** PRNG kecil supaya musik selalu sama tiap kali dibuat. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

class Synth {
  readonly dry: GainNode;
  readonly wet: GainNode;
  private noiseBuf: AudioBuffer;
  constructor(readonly ctx: OfflineAudioContext, readonly loop: number, reverbSec = 3) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(comp);
    // Gema: impuls dari noise yang meluruh
    const conv = ctx.createConvolver();
    const len = Math.floor(reverbSec * SR);
    const ir = ctx.createBuffer(2, len, SR);
    const r = rng(7);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.wet.connect(conv).connect(comp);
    this.noiseBuf = ctx.createBuffer(1, SR * 2, SR);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  }

  /** Amplop gain: naik `att`, tahan sampai `t+dur`, turun `rel`. */
  private env(t: number, dur: number, peak: number, att: number, rel: number, wet: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, t + Math.max(att, dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(att, dur) + rel);
    g.connect(this.dry);
    if (wet > 0) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.wet);
    }
    return { g, end: t + Math.max(att, dur) + rel + 0.05 };
  }

  /** Akor pad lembut: tiap nada 2 osilator agak sumbang, lewat lowpass. */
  pad(notes: string[], t: number, dur: number, o: { gain?: number; cutoff?: number; type?: OscillatorType; att?: number; rel?: number; wet?: number } = {}) {
    const { g, end } = this.env(t, dur, o.gain ?? 0.05, o.att ?? 2.5, o.rel ?? 3.5, o.wet ?? 0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff ?? 900;
    f.Q.value = 0.5;
    f.connect(g);
    for (const n of notes) {
      for (const cents of [-8, 8]) {
        const osc = this.ctx.createOscillator();
        osc.type = o.type ?? 'sawtooth';
        osc.frequency.value = hz(n);
        osc.detune.value = cents;
        osc.connect(f);
        osc.start(t);
        osc.stop(end);
      }
    }
  }

  /** Nada dengung rendah (sinus). */
  drone(note: string, t: number, dur: number, gain = 0.08, att = 4, rel = 4) {
    const { g, end } = this.env(t, dur, gain, att, rel, 0.2);
    for (const [mul, type, lvl] of [[1, 'sine', 1], [2, 'triangle', 0.25]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(note) * mul;
      const l = this.ctx.createGain();
      l.gain.value = lvl;
      osc.connect(l).connect(g);
      osc.start(t);
      osc.stop(end);
    }
  }

  /** Lonceng/celesta: sinus + parsial inharmonik, meluruh. */
  bell(note: string, t: number, gain = 0.05, decay = 3, wet = 0.9) {
    const f0 = hz(note);
    for (const [mul, lvl, dk] of [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.12, 0.25]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * mul;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * lvl, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * dk);
      osc.connect(g);
      g.connect(this.dry);
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.wet);
      osc.start(t);
      osc.stop(t + decay * dk + 0.05);
    }
  }

  /** Petikan pendek (segitiga lewat lowpass yang menutup). */
  pluck(note: string, t: number, gain = 0.06, decay = 0.6, wet = 0.4) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(f).connect(g);
    g.connect(this.dry);
    const s = this.ctx.createGain();
    s.gain.value = wet;
    g.connect(s).connect(this.wet);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** Detak jantung: dua dentum rendah. */
  thump(t: number, gain = 0.5) {
    for (const [dt, lvl] of [[0, 1], [0.22, 0.7]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, t + dt);
      osc.frequency.exponentialRampToValueAtTime(38, t + dt + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(gain * lvl, t + dt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.28);
      osc.connect(g).connect(this.dry);
      osc.start(t + dt);
      osc.stop(t + dt + 0.3);
    }
  }

  /** Desau angin: noise lewat bandpass yang frekuensinya bergoyang (periode membagi loop). */
  wind(t: number, dur: number, gain = 0.03, lo = 250, hi = 900, cycles = 2) {
    const { g, end } = this.env(t, dur, gain, 4, 4, 0.3);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.value = (lo + hi) / 2;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = cycles / this.loop;
    const depth = this.ctx.createGain();
    depth.gain.value = (hi - lo) / 2;
    lfo.connect(depth).connect(f.frequency);
    src.connect(f).connect(g);
    src.start(t);
    src.stop(end);
    lfo.start(0);
    lfo.stop(end);
  }

  /** Bunyi "tsk" halus (perkusi). */
  tick(t: number, gain = 0.02) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(f).connect(g).connect(this.dry);
    src.start(t, (t * 0.37) % 1.5);
    src.stop(t + 0.08);
  }

  /** Sumber yang terus berbunyi dipotong jadi dua segmen bersilang supaya sambungan loop mulus. */
  sustained(fn: (t: number, dur: number) => void) {
    const half = this.loop / 2;
    fn(0, half);
    fn(half, half);
  }
}

interface Track { loop: number; seed: number; reverb?: number; compose(s: Synth, r: () => number): void }

const TRACKS: Record<Mood, Track> = {
  // Malam: gelap, A minor, dengung + angin + lonceng jarang
  night: {
    loop: 32, seed: 11, reverb: 3.5,
    compose(s, r) {
      const chords = [['A2', 'C3', 'E3'], ['F2', 'A2', 'C3'], ['D2', 'F2', 'A2'], ['E2', 'G#2', 'B2']];
      chords.forEach((c, i) => s.pad(c, i * 8, 8, { gain: 0.035, cutoff: 650, att: 3, rel: 4 }));
      s.sustained((t, d) => s.drone('A1', t, d, 0.1));
      s.sustained((t, d) => s.wind(t, d, 0.035, 250, 800, 2));
      const scale = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5'];
      for (let t = 1.5; t < 31; t += 2.5 + r() * 2.5) s.bell(scale[Math.floor(r() * scale.length)], t, 0.035, 3.5);
    },
  },
  // Lihat kartu: misterius, D minor, kilau arpeggio
  reveal: {
    loop: 16, seed: 23,
    compose(s, r) {
      s.sustained((t, d) => s.pad(['D3', 'A3', 'E4'], t, d, { gain: 0.03, cutoff: 1200, type: 'triangle', att: 3, rel: 3 }));
      s.sustained((t, d) => s.drone('D2', t, d, 0.07));
      const arp = ['D5', 'F5', 'A5', 'E5', 'C6', 'A5', 'F5', 'E5'];
      for (let i = 0; i < 32; i++) {
        if (i % 4 === 3 && r() < 0.6) continue;
        s.bell(arp[i % arp.length], i * 0.5, 0.022 + r() * 0.012, 2.2);
      }
    },
  },
  // Pagi: lega, C mayor, petikan pentatonik
  morning: {
    loop: 24, seed: 31,
    compose(s, r) {
      const chords = [['C3', 'E3', 'G3'], ['B2', 'D3', 'G3'], ['A2', 'C3', 'E3'], ['F2', 'A2', 'C3']];
      chords.forEach((c, i) => s.pad(c, i * 6, 6, { gain: 0.035, cutoff: 1500, type: 'triangle', att: 2, rel: 3 }));
      const scale = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'];
      for (let t = 0.5; t < 23.5; t += 0.75) if (r() < 0.55) s.pluck(scale[Math.floor(r() * scale.length)], t, 0.04, 0.9, 0.6);
    },
  },
  // Diskusi: tenang tapi ada denyut, 90 bpm, D minor
  day: {
    loop: 16, seed: 41,
    compose(s, r) {
      const beat = 60 / 90;
      const chords = [['D3', 'F3', 'A3', 'C4'], ['Bb2', 'D3', 'F3', 'A3'], ['G2', 'Bb2', 'D3', 'F3'], ['A2', 'C#3', 'E3', 'G3']];
      chords.forEach((c, i) => s.pad(c, i * 4, 4, { gain: 0.022, cutoff: 1000, att: 1.5, rel: 2.5 }));
      const bass = ['D2', 'Bb1', 'G1', 'A1'];
      const ost = [['D4', 'A4', 'F4', 'A4'], ['D4', 'F4', 'Bb4', 'F4'], ['D4', 'G4', 'Bb4', 'G4'], ['C#4', 'E4', 'A4', 'E4']];
      for (let b = 0; b < 24; b++) {
        const bar = Math.floor((b * beat) / 4);
        const t = b * beat;
        if (b % 2 === 0) s.pluck(bass[bar], t, 0.07, 0.8, 0.2);
        for (let k = 0; k < 2; k++) s.pluck(ost[bar][(b * 2 + k) % 4], t + k * beat / 2, 0.028 + r() * 0.01, 0.35, 0.35);
        s.tick(t + beat / 2, 0.012);
      }
    },
  },
  // Voting: tegang, detak jantung 75 bpm, akor dengan tritone
  vote: {
    loop: 12, seed: 53,
    compose(s, r) {
      const beat = 0.8;
      s.sustained((t, d) => s.pad(['E2', 'B2', 'G3', 'A#3'], t, d, { gain: 0.028, cutoff: 700, att: 2, rel: 2.5 }));
      s.sustained((t, d) => s.drone('E1', t, d, 0.09, 2, 3));
      for (let b = 0; b < 15; b++) {
        s.thump(b * beat, 0.45);
        for (let k = 0; k < 4; k++) if (k !== 0 || r() < 0.5) s.pluck(k % 2 ? 'E3' : 'E2', b * beat + k * beat / 4, 0.03, 0.18, 0.1);
      }
      for (let t = 2; t < 12; t += 4) s.bell('A#5', t, 0.015, 2.5);
    },
  },
  // Akhir: hangat, F mayor, pelan
  gameOver: {
    loop: 24, seed: 67, reverb: 3.5,
    compose(s, r) {
      const chords = [['F2', 'A2', 'C3', 'E3'], ['C3', 'E3', 'G3'], ['D3', 'G3', 'A3'], ['C3', 'F3', 'A3']];
      chords.forEach((c, i) => s.pad(c, i * 6, 6, { gain: 0.032, cutoff: 1400, type: 'triangle', att: 2.5, rel: 3.5 }));
      s.sustained((t, d) => s.drone('F1', t, d, 0.07));
      const scale = ['F5', 'G5', 'A5', 'C6', 'D6'];
      for (let t = 1; t < 23; t += 1.5 + r() * 1.5) s.bell(scale[Math.floor(r() * scale.length)], t, 0.03, 3);
    },
  },
};

type OAC = typeof OfflineAudioContext;

/** Render satu loop (stereo, mulus saat diulang). */
export async function renderMood(mood: Mood, Offline: OAC, target: BaseAudioContext): Promise<AudioBuffer> {
  const tr = TRACKS[mood];
  const loopN = Math.round(tr.loop * SR);
  const ctx = new Offline(2, loopN + TAIL * SR, SR);
  const s = new Synth(ctx, tr.loop, tr.reverb);
  tr.compose(s, rng(tr.seed));
  const out = await ctx.startRendering();
  const buf = target.createBuffer(2, loopN, SR);
  let peak = 0;
  const chans: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const src = out.getChannelData(c);
    const dst = new Float32Array(loopN);
    for (let i = 0; i < loopN; i++) {
      // Lipat ekor (TAIL detik setelah akhir loop) ke awal, berkali-kali jika loop pendek
      let v = src[i];
      for (let j = i + loopN; j < src.length; j += loopN) v += src[j];
      dst[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    chans.push(dst);
  }
  const norm = peak > 0 ? 0.8 / peak : 1;
  chans.forEach((d, c) => {
    for (let i = 0; i < d.length; i++) d[i] *= norm;
    buf.getChannelData(c).set(d);
  });
  return buf;
}

// ---------- Pemutar ----------

export function createMusic(): Music {
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  const AC: typeof AudioContext | undefined = w ? (w.AudioContext ?? w.webkitAudioContext) : undefined;
  const Offline: OAC | undefined = w ? (w.OfflineAudioContext ?? w.webkitOfflineAudioContext) : undefined;
  const supported = !!AC && !!Offline;
  let prefs = loadPrefs();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let mood: Mood | null = null;
  let ducked = false;
  let current: { mood: Mood; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  const cache = new Map<Mood, Promise<AudioBuffer>>();

  const save = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* */ } };

  function ensure(): AudioContext | null {
    if (!supported) return null;
    if (!ctx) {
      try {
        // iOS 17+: putar walau sakelar senyap aktif, dan campur dengan suara narator
        const session = (navigator as any).audioSession;
        if (session && session.type !== 'playback') session.type = 'playback';
      } catch { /* */ }
      try { ctx = new AC!(); } catch { return null; }
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  const level = () => (prefs.enabled ? prefs.volume * 0.6 * (ducked ? DUCK : 1) : 0);

  function applyLevel(time = 0.4) {
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(level(), ctx.currentTime, time / 3);
  }

  function buffer(m: Mood): Promise<AudioBuffer> {
    let p = cache.get(m);
    if (!p) {
      p = renderMood(m, Offline!, ctx!);
      p.catch(() => cache.delete(m));
      cache.set(m, p);
    }
    return p;
  }

  function fadeOut(cur: NonNullable<typeof current>) {
    if (!ctx) return;
    const t = ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + FADE);
    try { cur.src.stop(t + FADE + 0.1); } catch { /* */ }
  }

  async function sync() {
    if (!prefs.enabled || !mood) {
      if (current) { fadeOut(current); current = null; }
      return;
    }
    if (!ensure() || ctx!.state !== 'running') return;
    if (current?.mood === mood) return;
    const want = mood;
    let buf: AudioBuffer;
    try { buf = await buffer(want); } catch (e) { console.warn('musik gagal dibuat', e); return; }
    if (mood !== want || current?.mood === want || !ctx) return;
    if (current) fadeOut(current);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE);
    src.connect(gain).connect(master!);
    src.start(t);
    current = { mood: want, src, gain };
    applyLevel();
    // Siapkan musik fase berikutnya yang paling mungkin, supaya perpindahan tidak menunggu
    const next: Partial<Record<Mood, Mood>> = { reveal: 'night', night: 'morning', morning: 'day', day: 'vote', vote: 'night' };
    const n = next[want];
    if (n) setTimeout(() => { void buffer(n); }, 2000);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => { /* */ });
      else if (prefs.enabled && mood) void ctx.resume().then(() => sync()).catch(() => { /* */ });
    });
  }

  return {
    supported,
    get enabled() { return prefs.enabled; },
    get volume() { return prefs.volume; },
    setEnabled(on) {
      prefs = { ...prefs, enabled: on };
      save();
      applyLevel();
      if (on) this.unlock(); else void sync();
    },
    setVolume(v) {
      prefs = { ...prefs, volume: Math.max(0, Math.min(1, Math.round(v * 10) / 10)) };
      save();
      applyLevel(0.15);
    },
    setMood(m) {
      if (m === mood) return;
      mood = m;
      void sync();
    },
    setDucked(on) {
      if (on === ducked) return;
      ducked = on;
      applyLevel(on ? 0.3 : 1.2);
    },
    unlock() {
      if (!prefs.enabled || !ensure()) return;
      if (ctx!.state !== 'running') {
        // Di dalam ketukan: resume() diizinkan
        void ctx!.resume().then(() => sync()).catch(() => { /* */ });
      } else void sync();
    },
  };
}
