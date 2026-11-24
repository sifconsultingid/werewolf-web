// Katalog klip voice-over rekaman (MP3 di public/vo/<suara>/<id>.mp3).
// Teks di sini adalah apa yang diucapkan di rekaman. Kalimat yang memuat nama pemain tidak bisa
// direkam, jadi versi rekamannya memakai kalimat tanpa nama (nama tetap tampil di layar).
// Setelah mengubah teks di file ini, jalankan ulang `scripts/generate-vo.sh`.

import { ROLES, ROLE_INFO, WAKE_SCRIPT, sleepScript, type Role } from './roles';
import { THIEF_NOTICE, TROUBLEMAKER_NOTICE, type DeathCause, type Winner } from './engine';

export const NIGHT_FALLS = 'Malam telah tiba. Semua warga desa, tutup mata kalian.';
export const MORNING_COMES = 'Pagi telah tiba. Semua warga desa, buka mata kalian.';
export const VOTE_SCRIPT = 'Saatnya voting. Pilih orang yang kalian curigai sebagai serigala di HP masing-masing.';
export const HUNTER_SCRIPT = 'Hunter, sebelum mati, tembak satu orang!';
export const DISCUSSION_SCRIPT = 'Silakan berdiskusi. Cari tahu siapa serigala di antara kalian.';
export const TIME_UP_SCRIPT = 'Waktu diskusi habis.';
export const PEACEFUL_SCRIPT = 'Malam yang damai. Tidak ada yang mati semalam.';
export const NO_EXECUTION_SCRIPT = 'Tidak ada yang dieksekusi hari ini.';
export const GREETING_SCRIPT = 'Halo, aku narator kalian malam ini.';

const DEATH_CLIP_TEXT: Record<DeathCause, string> = {
  wolves: 'Satu warga dimangsa serigala.',
  poison: 'Satu warga diracun Witch.',
  vote: 'Satu warga dieksekusi oleh warga desa.',
  hunter: 'Satu orang ditembak Hunter.',
  heartbreak: 'Satu orang mati patah hati.',
  disease: 'Satu orang tertular penyakit Diseased.',
};

const WIN_CLIP_TEXT: Record<Winner['kind'], string> = {
  village: 'Desa menang! Semua werewolf telah dibasmi. Desa kembali damai.',
  wolves: 'Serigala menang! Serigala menguasai desa. Lolongan menggema di bawah bulan purnama.',
  lovers: 'Cinta menang! Sepasang kekasih bertahan sampai akhir, melawan dunia.',
  tanner: 'Tanner menang! Dia berhasil membuat dirinya dieksekusi. Semua orang lain kalah!',
  draw: 'Seri! Tidak ada yang tersisa di desa. Serigala dan warga sama-sama binasa.',
};

/** Semua klip: id → teks yang direkam. */
export const VOICE_CLIPS: Record<string, string> = (() => {
  const c: Record<string, string> = {
    night_falls: NIGHT_FALLS,
    morning_comes: MORNING_COMES,
    vote: VOTE_SCRIPT,
    hunter: HUNTER_SCRIPT,
    discussion: DISCUSSION_SCRIPT,
    time_up: TIME_UP_SCRIPT,
    peaceful: PEACEFUL_SCRIPT,
    no_execution: NO_EXECUTION_SCRIPT,
    greeting: GREETING_SCRIPT,
    revived: 'Seseorang bangkit kembali dari kematian!',
    spell_mute: 'Ada warga yang dibungkam. Dia tidak boleh bicara hari ini. Lihat layar.',
    spell_noVote: 'Ada warga yang dilarang ikut voting hari ini. Lihat layar.',
    thief_swap: THIEF_NOTICE,
    troublemaker_swap: TROUBLEMAKER_NOTICE,
    prince_saved: 'Ternyata dia adalah Prince, dan dia selamat dari eksekusi!',
  };
  for (const [role, text] of Object.entries(WAKE_SCRIPT)) c[`wake_${role}`] = text!;
  for (const role of Object.keys(WAKE_SCRIPT) as Role[]) c[`sleep_${role}`] = sleepScript(role);
  for (const [cause, text] of Object.entries(DEATH_CLIP_TEXT)) c[`death_${cause}`] = text;
  for (const role of ROLES) c[`role_${role}`] = `Ternyata dia adalah ${ROLE_INFO[role].name}.`;
  for (const [kind, text] of Object.entries(WIN_CLIP_TEXT)) c[`win_${kind}`] = text;
  return c;
})();

export const clip = {
  wake: (r: Role) => `wake_${r}`,
  sleep: (r: Role) => `sleep_${r}`,
  death: (c: DeathCause) => `death_${c}`,
  role: (r: Role) => `role_${r}`,
  win: (k: Winner['kind']) => `win_${k}`,
};
