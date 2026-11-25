// Lolongan serigala, dibuat dengan kode (tanpa file audio / lisensi pihak ketiga).
// Dua serigala melolong bersahutan: nada naik, ditahan dengan vibrato, lalu turun.
// Hasilnya WAV (data URI) supaya bisa diputar lewat elemen audio narator yang izinnya sudah terbuka.

const RATE = 22050;

/** Kontur nada (Hz) satu lolongan pada waktu t (detik) dari awal lolongan. */
function pitch(t: number, base: number, len: number): number {
  const rise = 0.55;
  const fall = 0.7;
  if (t < rise) {
    const k = t / rise;
    return base * (0.62 + 0.38 * (1 - Math.pow(1 - k, 2)));
  }
  if (t < len - fall) {
    const k = (t - rise) / (len - fall - rise);
    return base * (1 + 0.04 * Math.sin(Math.PI * k)); // sedikit melengkung naik-turun
  }
  const k = (t - (len - fall)) / fall;
  return base * (1 - 0.38 * k * k);
}

function voice(out: Float32Array, startSec: number, len: number, base: number, gain: number, seed: number) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const s0 = Math.floor(startSec * RATE);
  const n = Math.floor(len * RATE);
  let phase = 0;
  let breath = 0;
  // Bobot harmonik ala vokal "uu" yang membuka jadi "oo" di puncak
  const harm = [1, 0.45, 0.22, 0.12, 0.06];
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / RATE;
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.8);
    const f = pitch(t, base, len) * vib;
    phase += (2 * Math.PI * f) / RATE;
    const open = Math.min(1, t / 0.6) * (t > len - 0.5 ? (len - t) / 0.5 : 1);
    let v = 0;
    harm.forEach((a, h) => { v += a * (h === 0 ? 1 : 0.3 + 0.7 * open) * Math.sin(phase * (h + 1)); });
    breath = breath * 0.97 + rnd() * 0.03; // desah napas halus
    const env = Math.min(1, t / 0.18) * Math.min(1, (len - t) / 0.35);
    out[s0 + i] += (v * 0.55 + breath * 2.5) * env * gain;
  }
}

let cached: string | null = null;

export function howlWav(): string {
  if (cached) return cached;
  const total = 5.2;
  const n = Math.floor(total * RATE);
  const dry = new Float32Array(n);
  voice(dry, 0, 3.0, 560, 0.6, 3);
  voice(dry, 1.1, 2.9, 640, 0.42, 9); // serigala kedua menyahut, sedikit lebih tinggi
  // Gema sederhana (beberapa pantulan) supaya terdengar di hutan, bukan di kamar
  const out = new Float32Array(n);
  const taps: [number, number][] = [[0, 1], [0.17, 0.35], [0.29, 0.25], [0.43, 0.18], [0.61, 0.12], [0.83, 0.08]];
  for (const [d, a] of taps) {
    const off = Math.floor(d * RATE);
    for (let i = 0; i + off < n; i++) out[i + off] += dry[i] * a;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = peak ? 0.85 / peak : 1;
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, out[i] * norm)) * 32767), true);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return (cached = 'data:audio/wav;base64,' + btoa(bin));
}
