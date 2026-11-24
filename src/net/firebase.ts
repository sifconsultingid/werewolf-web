import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence, browserSessionPersistence, getAuth, setPersistence, signInAnonymously, type Auth,
} from 'firebase/auth';
import {
  getDatabase, onChildAdded, onValue, push, ref, remove, serverTimestamp, set, type Database,
} from 'firebase/database';
import type { Backend, Unsub } from './backend';

// Backend online lewat Firebase Realtime Database + Anonymous Auth.
// Struktur data (lihat aturan keamanan di README):
//   rooms/{kode}/host            uid narator (diklaim sekali)
//   rooms/{kode}/public          JSON string, dibaca semua pemain
//   rooms/{kode}/private/{uid}   JSON string, hanya bisa dibaca pemain uid itu
//   rooms/{kode}/actions/{id}    { uid, action (JSON string), at } — ditulis pemain, dibaca & dihapus narator
// Data disimpan sebagai string JSON karena Firebase membuang array/objek kosong dan nilai undefined.

export function firebaseConfigFromEnv(): FirebaseOptions | null {
  const env = import.meta.env;
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_DATABASE_URL) return null;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
  };
}

const parse = (v: unknown): unknown | null => {
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
};

export class FirebaseBackend implements Backend {
  readonly label = 'Online (Firebase)';
  readonly localOnly = false;
  private auth: Auth;
  private db: Database;
  private ready: Promise<string>;
  private hostClaims = new Map<string, Promise<void>>();

  constructor(config: FirebaseOptions) {
    const app = initializeApp(config);
    this.auth = getAuth(app);
    this.db = getDatabase(app);
    // Saat pengembangan, tiap tab = pemain berbeda (session). Di produksi identitas bertahan
    // walau browser HP ditutup, supaya pemain bisa kembali ke kursinya.
    const perTab = import.meta.env.DEV || new URLSearchParams(location.search).has('tab');
    this.ready = setPersistence(this.auth, perTab ? browserSessionPersistence : browserLocalPersistence)
      .then(() => this.auth.authStateReady())
      .then(async () => this.auth.currentUser?.uid ?? (await signInAnonymously(this.auth)).user.uid);
  }

  uid(): Promise<string> {
    return this.ready;
  }

  private path(code: string, ...rest: string[]) {
    return ref(this.db, ['rooms', code, ...rest].join('/'));
  }

  /** Narator mengklaim ruang (sekali). Gagal jika kode sudah dipakai narator lain. */
  private claim(code: string): Promise<void> {
    let p = this.hostClaims.get(code);
    if (!p) {
      p = this.ready.then((uid) => set(this.path(code, 'host'), uid));
      this.hostClaims.set(code, p);
    }
    return p;
  }

  onActions(code: string, cb: (uid: string, action: unknown) => void): Unsub {
    let off: Unsub | null = null;
    let cancelled = false;
    void this.claim(code).then(() => {
      if (cancelled) return;
      off = onChildAdded(this.path(code, 'actions'), (snap) => {
        const v = snap.val() as { uid?: string; action?: string } | null;
        void remove(snap.ref).catch(() => { /* abaikan */ });
        if (v?.uid) cb(v.uid, parse(v.action));
      });
    }).catch((e) => console.error('Gagal mengklaim ruang', e));
    return () => { cancelled = true; off?.(); };
  }

  async publishPublic(code: string, data: unknown) {
    await this.claim(code);
    await set(this.path(code, 'public'), JSON.stringify(data));
  }

  async publishPrivate(code: string, uid: string, data: unknown) {
    await this.claim(code);
    await set(this.path(code, 'private', uid), JSON.stringify(data));
  }

  private watch(get: () => Promise<ReturnType<FirebaseBackend['path']>>, cb: (d: unknown | null) => void): Unsub {
    let off: Unsub | null = null;
    let cancelled = false;
    void get().then((r) => {
      if (cancelled) return;
      off = onValue(r, (snap) => cb(parse(snap.val())), (err) => { console.error(err); cb(null); });
    });
    return () => { cancelled = true; off?.(); };
  }

  watchPublic(code: string, cb: (data: unknown | null) => void): Unsub {
    return this.watch(async () => { await this.ready; return this.path(code, 'public'); }, cb);
  }

  watchPrivate(code: string, uid: string, cb: (data: unknown | null) => void): Unsub {
    return this.watch(async () => { await this.ready; return this.path(code, 'private', uid); }, cb);
  }

  async sendAction(code: string, action: unknown) {
    const uid = await this.ready;
    await push(this.path(code, 'actions'), { uid, action: JSON.stringify(action), at: serverTimestamp() });
  }
}
