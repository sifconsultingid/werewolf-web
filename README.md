# Werewolf — Versi Web Multipemain

Versi web dari aplikasi iOS Werewolf (aplikasi iOS-nya ada di repo/folder terpisah). Satu browser menjadi **narator**, pemain lain
masuk lewat **link/QR** dari HP masing-masing, peran diacak otomatis, dan aksi malam serta voting
dilakukan pemain sendiri di HP-nya. Aturan & peran sama dengan `Werewolf/Models/Role.swift` dan
`Werewolf/Models/GameEngine.swift` (logikanya di-port ke TypeScript di `src/game/`).

> Status: mode **online** aktif lewat Firebase (proyek `werewolf-979fe`, konfigurasi di `.env.local`).
> Tanpa `.env.local`, atau dengan `?local` di alamat, aplikasi memakai mode **lokal** (beberapa tab
> dalam satu browser, untuk uji coba). Saat `npm run dev`, tiap tab dianggap pemain berbeda.

## Menjalankan di komputer

Butuh Node.js 20+ (`brew install node` di Mac).

```bash
npm install
cp .env.example .env.local   # lalu isi VITE_FIREBASE_API_KEY untuk mode online
npm run dev
```

Buka <http://localhost:5173>:

1. Klik **Buat Permainan** (narator) → atur perkiraan jumlah pemain, komposisi peran
   (otomatis seimbang, bisa diubah dengan − / +), dan pengaturan → **Buat Ruang**.
2. Klik **➕ Buka tab pemain** beberapa kali (atau buka link `?room=KODE` di tab baru).
   Di tiap tab ketik nama lalu **Masuk ke ruang**. Narator melihat daftar yang masuk.
3. Narator menekan **Mulai & Acak Peran**. Tiap tab pemain membalik kartunya sendiri; serigala
   melihat kawanannya. Tekan **Saya Siap**, lalu narator menekan **Mulai Malam Pertama**.
4. Malam: tab pemain yang perannya sedang bangun mendapat tombol aksi (Cupid → Pengawal → Werewolf →
   Penyihir → Nekromancer → Perapal Mantra → Peramal → Insomnia; Si Sakit hanya jika dimangsa).
   Semua serigala hidup harus memilih korban yang sama. Peran yang pemegangnya sudah mati tetap
   "dipanggil" dan lanjut otomatis setelah beberapa detik agar tidak ketahuan.
5. Pagi → diskusi bertimer → voting dari HP masing-masing (satu pemain satu suara, bisa diganti/dibatalkan)
   → narator mengeksekusi → malam berikutnya … sampai ada pemenang.

Narator punya panel **Catatan Rahasia** (semua peran, kekasih, ramuan, log) yang bisa disembunyikan,
plus tombol untuk melewati pemain yang tidak merespons.

Uji coba di HP sungguhan dalam satu Wi-Fi juga bisa untuk *melihat tampilan* (`npm run dev` sudah
memakai `--host`, buka alamat Network yang tercetak), tapi di mode lokal setiap browser terpisah,
jadi HP lain tidak bisa saling terhubung sebelum mode online diaktifkan.

## Mode host ikut main (narator otomatis)

Default di layar **Buat Permainan**: toggle **🙋 Saya ikut main (narator otomatis)** + isi nama.
Pembuat ruang (host) dapat kursi dan peran acak seperti pemain lain, dan layar HP-nya jadi layar
pemain biasa plus bar kecil (🔊/🔁, ⏸ Jeda / ▶️ Lanjut, 🔁 Main lagi, Tutup). Tidak ada info rahasia di layar host.
Narator dijalankan `src/game/auto.ts` (`autoTick()` dipanggil tiap 0,5 detik di HP host), dan suaranya diputar dari HP host:

| Tahap | Lanjut otomatis ketika |
|-------|-------------------------|
| Lihat kartu | semua menekan Siap (+2 dtk) atau batas waktu (default 60 dtk) |
| Tiap peran malam | aksi dikirim **dan** durasi minimum acak 9–15 dtk lewat, atau batas waktu (30 dtk) → dilewati. Peran yang sudah mati: 10–20 dtk acak, jadi lamanya langkah tidak membocorkan apa-apa |
| Serigala | semua serigala hidup sepakat; tidak sepakat sampai waktu habis = **tidak ada korban** |
| Pagi | narasi selesai + 4 dtk → diskusi (atau voting) |
| Diskusi | timer diskusi habis |
| Voting | semua memilih (+3 dtk) atau batas waktu (60 dtk). Seri → voting ulang sekali, seri lagi → tidak ada eksekusi |
| Pemburu | menembak, atau batas waktu (20 dtk) → tidak menembak |

Timer tiap tahap baru mulai setelah voice-over selesai membacakan narasinya. Batas waktu bisa diubah
di kartu "Batas waktu narator otomatis". Mode lama (narator tidak ikut main, tombol manual) tetap ada:
matikan toggle-nya.

Catatan: HP host tetap memegang state lengkap (bisa diintip lewat DevTools). Layar HP host dijaga tetap
menyala (Screen Wake Lock), permainan otomatis dijeda kalau HP host dikunci/pindah aplikasi atau halaman
host dibuka ulang, dan pemain melihat "Koneksi ke host terputus" kalau detak host (tiap 10 dtk) hilang > 25 dtk.

## Tes

```bash
npm test          # tes logika (vitest)
npm run typecheck # cek TypeScript
npm run build     # build produksi ke dist/
```

- `tests/engine.test.ts` — tiap peran & aturan: urutan malam, pengawal, penyihir, Si Sakit, Lycan,
  Nekromancer, Perapal Mantra, Insomnia, kekasih, Pangeran, Si Penyamak, Pemburu, voting, kondisi menang.
- `tests/room.test.ts` — lobi, penyaringan info rahasia per pemain, kesepakatan serigala, voting.
- `tests/simulation.test.ts` — 5000 permainan acak (4–24 pemain, komposisi & pilihan acak) dan
  memastikan setiap permainan selesai dengan pemenang yang sah (desa, serigala, kekasih, penyamak, atau seri).

## Arsitektur

```
src/game/roles.ts    data peran (port Role.swift)
src/game/engine.ts   logika permainan murni (port GameEngine.swift)
src/game/room.ts     ruang, aksi pemain, dan tampilan yang disaring per pemain
src/net/backend.ts   antarmuka sinkronisasi realtime
src/net/local.ts     backend lokal (BroadcastChannel + localStorage, satu browser)
src/host.ts          layar narator
src/player.ts        layar pemain
```

Browser narator adalah satu-satunya yang memegang state lengkap: ia mengacak peran, memvalidasi
setiap aksi, dan menghitung hasil malam. Ke jaringan ia hanya menulis:

| Jalur                          | Ditulis oleh | Dibaca oleh       | Isi |
|--------------------------------|--------------|-------------------|-----|
| `rooms/{kode}/public`          | narator      | semua             | fase, nama, siapa hidup/mati, suara voting, pengumuman (tanpa peran pemain hidup) |
| `rooms/{kode}/private/{uid}`   | narator      | pemain `uid` saja | peran sendiri, kawanan serigala, pasangan kekasih, hasil Peramal/Insomnia, aksi yang harus dilakukan |
| `rooms/{kode}/actions/{uid}`   | pemain `uid` | narator           | aksi pemain (masuk, siap, pilihan malam, suara) |

State narator disimpan di `localStorage` browser narator, jadi kalau halaman narator ter-refresh,
permainan berlanjut (buka lagi `?host=KODE` atau tombol "Lanjutkan ruang" di beranda).
Halaman narator harus tetap terbuka selama permainan.

## Mode online — Firebase

Sudah diatur di proyek **WEREwolf** (`werewolf-979fe`): Anonymous Auth aktif, Realtime Database di
Singapura dengan aturan keamanan di bawah, dan web app `werewolf-web`. Kodenya di `src/net/firebase.ts`
(data disimpan sebagai string JSON; aksi pemain di `rooms/{kode}/actions`, dihapus narator setelah diproses).
Langkah di bawah ini untuk membuat ulang dari nol bila perlu.

### Firebase Realtime Database

Gratis (paket Spark), dan aturan keamanannya bisa membuat `private/{uid}` benar-benar hanya bisa
dibaca pemiliknya lewat Anonymous Auth — cocok dengan desain di atas.

1. Buka <https://console.firebase.google.com> → **Add project** (Google Analytics boleh dimatikan).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database** → pilih lokasi (mis. `asia-southeast1`) → mulai dalam *locked mode*.
4. Tab **Rules**, tempel aturan ini lalu **Publish**:

   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           "host": {
             ".read": "auth != null",
             ".write": "auth != null && (!data.exists() || data.val() === auth.uid) && newData.val() === auth.uid"
           },
           "public": {
             ".read": "auth != null",
             ".write": "auth != null && root.child('rooms').child($code).child('host').val() === auth.uid"
           },
           "private": {
             "$uid": {
               ".read": "auth != null && auth.uid === $uid",
               ".write": "auth != null && root.child('rooms').child($code).child('host').val() === auth.uid"
             }
           },
           "actions": {
             ".read": "auth != null && root.child('rooms').child($code).child('host').val() === auth.uid",
             "$id": {
               ".write": "auth != null && ((!data.exists() && newData.child('uid').val() === auth.uid) || (!newData.exists() && root.child('rooms').child($code).child('host').val() === auth.uid))"
             }
           }
         }
       }
     }
   }
   ```

5. **Project settings → General → Your apps → Web (`</>`)** → daftarkan app → salin nilai `firebaseConfig`.
6. Buat file `.env.local` (tidak ikut ter-commit):

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_DATABASE_URL=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

7. Setelah deploy, tambahkan domain situsmu di **Authentication → Settings → Authorized domains**.

### Alternatif — Supabase Realtime (tidak dipakai)

Juga gratis, tapi kanal *broadcast* bisa didengar siapa pun yang tahu nama kanalnya, jadi info rahasia
perlu kanal privat + Row Level Security pada `realtime.messages` (lebih banyak pengaturan).
Langkah dasarnya: daftar di <https://supabase.com> → **New project** → **Authentication → Providers →
Anonymous sign-ins: on** → **Project Settings → API**: salin *Project URL* dan *anon public key* ke
`.env.local` sebagai `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`. Proyek Supabase gratis
dijeda otomatis setelah 1 minggu tidak dipakai.

## Deploy gratis

**Situs aktif:** <https://eclectic-sprite-ad72c8.netlify.app> (Netlify Drop, proyek `eclectic-sprite-ad72c8`;
domain ini sudah ada di Firebase → Authentication → Authorised domains).
Untuk memperbarui: `npm run build`, lalu seret folder `dist` ke kotak "Drop a folder" di halaman
proyek Netlify. Untuk mencoba beberapa pemain di satu browser pada situs live, tambahkan `&tab` di link
(mis. `?room=KODE&tab`) agar tiap tab dianggap pemain berbeda.

Hasil build adalah situs statis di `dist` (`vite.config.ts` memakai `base: './'`, jadi bisa
di subfolder). Jalankan `npm run build` dulu. Isi `.env.local` ikut ter-*bake* ke build, jadi
untuk layanan yang membangun dari Git, masukkan variabel `VITE_...` yang sama di pengaturan *Environment variables* mereka.

- **Netlify** — <https://app.netlify.com/drop>: seret folder `dist`. Atau hubungkan repo Git
  dengan *Build command* `npm run build`, *Publish directory* `dist`.
- **Vercel** — *Add New → Project*, impor repo, framework *Vite*
  (build `npm run build`, output `dist`).
- **GitHub Pages** — dorong repo ke GitHub, lalu *Settings → Pages → Source: GitHub Actions* dan
  pakai workflow "Static HTML"/Vite yang membangun proyek dan mengunggah `dist`.
- **Firebase Hosting** (jika memilih Firebase) — `npm i -g firebase-tools`, `firebase login`,
  `firebase init hosting` (public dir: `dist`), `firebase deploy`.

Semua layanan di atas memberi HTTPS, yang dibutuhkan agar tombol salin link dan getar HP berfungsi.

## Voice-over narator

Layar narator membacakan narasinya sendiri. Urutan prioritasnya:

1. **Rekaman MP3** di `public/vo/gadis/` (suara neural `id-ID-GadisNeural`), sama di semua browser.
   Kalimat yang memuat nama pemain direkam dalam versi tanpa nama, sedangkan namanya tetap tampil di layar.
2. **Suara browser** (Web Speech API) sebagai cadangan, atau kalau narator memilih suara lain di kartu "Voice-over Narator".

Katalog kalimat rekaman ada di `src/game/voiceLines.ts`. Setelah teksnya diubah, generate ulang rekamannya:

```bash
npm run vo:lines                 # tulis vo-lines.json
python3 -m pip install edge-tts
python3 scripts/generate_vo.py vo-lines.json public/vo/gadis
```
