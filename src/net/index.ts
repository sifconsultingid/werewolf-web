import type { Backend } from './backend';
import { FirebaseBackend, firebaseConfigFromEnv } from './firebase';
import { LocalBackend } from './local';

/**
 * Pilih backend realtime: Firebase jika konfigurasinya ada di `.env.local` (atau variabel
 * lingkungan saat build), selain itu mode lokal satu browser. `?local` memaksa mode lokal.
 */
export function getBackend(): Backend {
  const config = firebaseConfigFromEnv();
  if (config && !new URLSearchParams(location.search).has('local')) return new FirebaseBackend(config);
  return new LocalBackend();
}
