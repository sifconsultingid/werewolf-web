// Lapisan sinkronisasi realtime.
//
// Modelnya sengaja sederhana agar bisa dipetakan ke layanan realtime apa pun:
//   rooms/{code}/public          ← ditulis narator, dibaca semua orang (tanpa info rahasia)
//   rooms/{code}/private/{uid}   ← ditulis narator, hanya dibaca pemain dengan uid itu
//   rooms/{code}/actions/{uid}   ← ditulis pemain, dibaca narator
// Semua keputusan (pengacakan peran, hasil malam, dst.) dibuat di HP/browser narator.

export type Unsub = () => void;

export interface Backend {
  /** Nama mode untuk ditampilkan, mis. "Lokal (satu browser)". */
  readonly label: string;
  /** Jika true, link hanya bisa dibuka di browser yang sama (mode uji coba). */
  readonly localOnly: boolean;
  /** Identitas unik perangkat/tab ini. */
  uid(): Promise<string>;

  // --- Narator ---
  /** Mendengarkan aksi dari pemain. */
  onActions(code: string, cb: (uid: string, action: unknown) => void): Unsub;
  publishPublic(code: string, data: unknown): Promise<void>;
  publishPrivate(code: string, uid: string, data: unknown): Promise<void>;

  // --- Pemain ---
  watchPublic(code: string, cb: (data: unknown | null) => void): Unsub;
  watchPrivate(code: string, uid: string, cb: (data: unknown | null) => void): Unsub;
  sendAction(code: string, action: unknown): Promise<void>;
}
