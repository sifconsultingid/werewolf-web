import type { Backend, Unsub } from './backend';

// Backend uji coba tanpa server: semua tab di SATU browser saling berkomunikasi lewat
// BroadcastChannel, dan data terakhir disimpan di localStorage agar tab baru langsung mendapatkannya.
// Tiap tab punya identitas sendiri (sessionStorage), jadi beberapa tab = beberapa pemain.
// Catatan: di mode ini semua tab berbagi penyimpanan yang sama, jadi tidak ada kerahasiaan sungguhan —
// cocok untuk mencoba alur permainan, bukan untuk bermain sungguhan dengan banyak HP.

type Msg =
  | { t: 'public'; code: string }
  | { t: 'private'; code: string; uid: string }
  | { t: 'action'; code: string; uid: string; action: unknown; id: string };

const CHANNEL = 'werewolf-local-v1';
const key = {
  pub: (code: string) => `ww:local:${code}:public`,
  priv: (code: string, uid: string) => `ww:local:${code}:private:${uid}`,
  act: (code: string, uid: string) => `ww:local:${code}:act:${uid}`,
};

function readJSON(k: string): unknown | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class LocalBackend implements Backend {
  readonly label = 'Lokal (uji coba di satu browser)';
  readonly localOnly = true;
  private ch = new BroadcastChannel(CHANNEL);
  private listeners = new Set<(m: Msg) => void>();
  private myUid: string;

  constructor() {
    let id: string | null = null;
    try { id = sessionStorage.getItem('ww:local:uid'); } catch { /* abaikan */ }
    if (!id) {
      id = randomId();
      try { sessionStorage.setItem('ww:local:uid', id); } catch { /* abaikan */ }
    }
    this.myUid = id;
    this.ch.onmessage = (e: MessageEvent<Msg>) => this.listeners.forEach((l) => l(e.data));
  }

  /** Ganti identitas tab ini (untuk menjadi pemain baru di tab yang sama). */
  resetIdentity(): void {
    try { sessionStorage.removeItem('ww:local:uid'); } catch { /* abaikan */ }
  }

  private listen(fn: (m: Msg) => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async uid() { return this.myUid; }

  /** Dengar perubahan localStorage dari tab lain (jalur kedua selain BroadcastChannel). */
  private onStorage(fn: (key: string, value: string | null) => void): Unsub {
    const h = (e: StorageEvent) => { if (e.key) fn(e.key, e.newValue); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }

  onActions(code: string, cb: (uid: string, action: unknown) => void): Unsub {
    // Aksi dikirim lewat dua jalur; id mencegah aksi yang sama diproses dua kali.
    const seen = new Set<string>();
    const handle = (uid: string, id: string, action: unknown) => {
      if (seen.has(id)) return;
      seen.add(id);
      cb(uid, action);
    };
    const prefix = key.act(code, '');
    const a = this.listen((m) => { if (m.t === 'action' && m.code === code) handle(m.uid, m.id, m.action); });
    const b = this.onStorage((k, v) => {
      if (!k.startsWith(prefix) || !v) return;
      try {
        const { id, action } = JSON.parse(v);
        handle(k.slice(prefix.length), id, action);
      } catch { /* abaikan */ }
    });
    return () => { a(); b(); };
  }

  async publishPublic(code: string, data: unknown) {
    localStorage.setItem(key.pub(code), JSON.stringify(data));
    this.ch.postMessage({ t: 'public', code } satisfies Msg);
  }

  async publishPrivate(code: string, uid: string, data: unknown) {
    localStorage.setItem(key.priv(code, uid), JSON.stringify(data));
    this.ch.postMessage({ t: 'private', code, uid } satisfies Msg);
  }

  private watchKey(k: string, isMine: (m: Msg) => boolean, cb: (data: unknown | null) => void): Unsub {
    let last = '';
    const emit = () => {
      const raw = localStorage.getItem(k) ?? '';
      if (raw === last) return;
      last = raw;
      cb(readJSON(k));
    };
    queueMicrotask(emit);
    const a = this.listen((m) => { if (isMine(m)) emit(); });
    const b = this.onStorage((changed) => { if (changed === k) emit(); });
    // Penyelamat: periksa ulang saat tab kembali terlihat
    const vis = () => { if (document.visibilityState === 'visible') emit(); };
    document.addEventListener('visibilitychange', vis);
    return () => { a(); b(); document.removeEventListener('visibilitychange', vis); };
  }

  watchPublic(code: string, cb: (data: unknown | null) => void): Unsub {
    return this.watchKey(key.pub(code), (m) => m.t === 'public' && m.code === code, cb);
  }

  watchPrivate(code: string, uid: string, cb: (data: unknown | null) => void): Unsub {
    return this.watchKey(key.priv(code, uid), (m) => m.t === 'private' && m.code === code && m.uid === uid, cb);
  }

  async sendAction(code: string, action: unknown) {
    const id = randomId();
    this.ch.postMessage({ t: 'action', code, uid: this.myUid, action, id } satisfies Msg);
    try { localStorage.setItem(key.act(code, this.myUid), JSON.stringify({ id, action })); } catch { /* */ }
  }
}
