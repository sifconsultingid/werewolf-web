// Bunyi alarm (bip-bip) + getar tiap detik di 10 detik terakhir hitung mundur (Web Audio, tanpa file suara).

const WARN_FROM = 10;

export interface Beeper {
  /** Panggil sesering mungkin dengan sisa detik timer yang tampil (null = tidak ada timer). */
  update(secondsLeft: number | null): void;
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

  const ensure = () => {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch { return null; } }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* */ });
    return ctx;
  };
  // Safari iOS: audio baru boleh bunyi setelah ada ketukan
  if (typeof document !== 'undefined') {
    for (const ev of ['touchend', 'click'] as const) document.addEventListener(ev, () => { ensure(); }, true);
  }

  /** Satu nada alarm. `at` = detik dari sekarang. */
  function tone(c: AudioContext, freq: number, at: number, dur: number, vol = 0.35) {
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.setValueAtTime(vol, t + dur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function alarm(s: number) {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    if (s === 0) {
      // Waktu habis: buzzer panjang turun
      tone(c, 880, 0, 0.25); tone(c, 660, 0.25, 0.25); tone(c, 440, 0.5, 0.6);
    } else if (s <= 3) {
      // 3 detik terakhir: tiga bip cepat bernada tinggi
      tone(c, 1568, 0, 0.1); tone(c, 1568, 0.15, 0.1); tone(c, 1568, 0.3, 0.1);
    } else {
      // Bip-bip ala alarm
      tone(c, 1047, 0, 0.14); tone(c, 1319, 0.18, 0.14);
    }
  }

  return {
    update(secondsLeft) {
      if (secondsLeft === null || secondsLeft > WARN_FROM) { last = null; return; }
      const s = Math.max(0, Math.ceil(secondsLeft));
      if (s === last) return;
      last = s;
      alarm(s);
      try { navigator.vibrate?.(s === 0 ? [300, 100, 300] : s <= 3 ? 120 : 60); } catch { /* */ }
    },
  };
}
