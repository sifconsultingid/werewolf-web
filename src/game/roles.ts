// Port dari Werewolf/Models/Role.swift — jaga agar tetap sama dengan versi iOS.

export type Team = 'village' | 'wolves' | 'neutral';

export const TEAM_NAME: Record<Team, string> = {
  village: 'Tim Desa',
  wolves: 'Tim Serigala',
  neutral: 'Netral',
};

export const TEAM_COLOR: Record<Team, string> = {
  village: '#40a6f2',
  wolves: '#e63340',
  neutral: '#bf8cf2',
};

/** Urutan sama dengan `Role.allCases` di Swift (dipakai untuk menyusun dek). */
export const ROLES = [
  'werewolf', 'villager', 'seer', 'bodyguard', 'witch', 'hunter', 'prince',
  'diseased', 'necromancer', 'spellcaster', 'insomniac', 'lycan',
  'cupid', 'tanner', 'thief',
] as const;

export type Role = (typeof ROLES)[number];

export interface RoleInfo {
  name: string;
  team: Team;
  icon: string;
  colors: [string, string];
  /** Nilai keseimbangan (gaya Ultimate Werewolf). Positif = menguntungkan desa. */
  balance: number;
  allowsMultiple: boolean;
  /** Urutan dibangunkan di malam hari (Si Sakit hanya dibangunkan jika dimangsa). */
  nightOrder: number | null;
  looksLikeWerewolf: boolean;
  short: string;
  tips: string;
}

const rgb = (r: number, g: number, b: number) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

export const ROLE_INFO: Record<Role, RoleInfo> = {
  werewolf: {
    name: 'Werewolf', team: 'wolves', icon: '🐺', colors: [rgb(0.45, 0.02, 0.08), rgb(0.95, 0.2, 0.2)],
    balance: -6, allowsMultiple: true, nightOrder: 2, looksLikeWerewolf: true,
    short: 'Setiap malam, bersama serigala lain memilih satu warga untuk dimangsa.',
    tips: 'Berbaurlah. Tuduh orang lain dengan wajar, jangan terlalu membela teman serigala.',
  },
  villager: {
    name: 'Warga Desa', team: 'village', icon: '🏠', colors: [rgb(0.35, 0.25, 0.1), rgb(0.85, 0.65, 0.3)],
    balance: 1, allowsMultiple: true, nightOrder: null, looksLikeWerewolf: false,
    short: 'Tidak punya kemampuan khusus. Gunakan logika & insting untuk menemukan serigala.',
    tips: 'Perhatikan siapa yang terlalu diam atau terlalu agresif. Suaramu penting saat voting.',
  },
  seer: {
    name: 'Peramal', team: 'village', icon: '👁️', colors: [rgb(0.15, 0.05, 0.45), rgb(0.55, 0.4, 1.0)],
    balance: 7, allowsMultiple: false, nightOrder: 6, looksLikeWerewolf: false,
    short: 'Setiap malam boleh melihat satu pemain: apakah dia Werewolf atau bukan.',
    tips: 'Jangan buka identitas terlalu cepat—kamu target utama serigala. Ingat, Lycan juga terlihat sebagai werewolf.',
  },
  bodyguard: {
    name: 'Pengawal', team: 'village', icon: '🛡️', colors: [rgb(0.05, 0.2, 0.4), rgb(0.3, 0.7, 1.0)],
    balance: 3, allowsMultiple: false, nightOrder: 1, looksLikeWerewolf: false,
    short: 'Setiap malam melindungi satu pemain dari serangan serigala. Tidak boleh orang yang sama dua malam berturut-turut.',
    tips: 'Lindungi pemain yang kamu duga Peramal. Melindungi diri sendiri diperbolehkan.',
  },
  witch: {
    name: 'Penyihir', team: 'village', icon: '🧪', colors: [rgb(0.05, 0.3, 0.15), rgb(0.4, 0.95, 0.5)],
    balance: 4, allowsMultiple: false, nightOrder: 3, looksLikeWerewolf: false,
    short: 'Punya 1 ramuan penyembuh dan 1 ramuan racun, masing-masing hanya sekali pakai sepanjang permainan.',
    tips: 'Simpan ramuan penyembuh untuk peran penting. Racun bisa membalik keadaan.',
  },
  hunter: {
    name: 'Pemburu', team: 'village', icon: '🎯', colors: [rgb(0.3, 0.2, 0.05), rgb(0.95, 0.55, 0.15)],
    balance: 3, allowsMultiple: false, nightOrder: null, looksLikeWerewolf: false,
    short: 'Jika mati (dibunuh atau divoting), langsung menembak satu pemain lain untuk ikut mati.',
    tips: 'Kematianmu bisa jadi senjata. Amati baik-baik siapa yang paling mencurigakan.',
  },
  prince: {
    name: 'Pangeran', team: 'village', icon: '👑', colors: [rgb(0.4, 0.3, 0.0), rgb(1.0, 0.85, 0.3)],
    balance: 3, allowsMultiple: false, nightOrder: null, looksLikeWerewolf: false,
    short: 'Jika divoting untuk dieksekusi, identitasnya terbuka dan ia selamat (sekali saja).',
    tips: 'Kamu aman dari voting pertama, tapi tetap bisa dimangsa di malam hari.',
  },
  diseased: {
    name: 'Si Sakit', team: 'village', icon: '🦠', colors: [rgb(0.2, 0.25, 0.05), rgb(0.65, 0.8, 0.2)],
    balance: 3, allowsMultiple: false, nightOrder: null, looksLikeWerewolf: false,
    short: 'Jika dimangsa serigala, ia dibangunkan dan memilih satu serigala penyerangnya untuk ikut mati tertular penyakit.',
    tips: 'Kamu umpan beracun. Biarkan serigala menyerangmu—satu dari mereka akan ikut tumbang.',
  },
  necromancer: {
    name: 'Nekromancer', team: 'village', icon: '🖐️', colors: [rgb(0.1, 0.1, 0.2), rgb(0.45, 0.85, 0.85)],
    balance: 3, allowsMultiple: false, nightOrder: 4, looksLikeWerewolf: false,
    short: 'Sekali sepanjang permainan, di malam hari boleh menghidupkan kembali satu pemain yang sudah mati.',
    tips: 'Simpan kekuatanmu untuk peran penting yang mati, misalnya Peramal.',
  },
  spellcaster: {
    name: 'Perapal Mantra', team: 'village', icon: '🤫', colors: [rgb(0.3, 0.05, 0.35), rgb(0.85, 0.4, 0.95)],
    balance: 1, allowsMultiple: false, nightOrder: 5, looksLikeWerewolf: false,
    short: 'Setiap malam memilih satu pemain (boleh diri sendiri) untuk dibungkam besok siang ATAU dilarang ikut voting.',
    tips: 'Bungkam pemain yang terlalu pandai memimpin, atau larang tersangka serigala ikut voting.',
  },
  insomniac: {
    name: 'Insomnia', team: 'village', icon: '🚶', colors: [rgb(0.08, 0.12, 0.3), rgb(0.95, 0.8, 0.45)],
    balance: 3, allowsMultiple: false, nightOrder: 7, looksLikeWerewolf: false,
    short: 'Setiap malam boleh memilih jalan-jalan. Jika ya, narator menunjukkan Werewolf yang duduk paling dekat dengannya.',
    tips: 'Informasimu kuat, tapi bergantung tempat duduk. Ingat siapa yang duduk di dekatmu.',
  },
  lycan: {
    name: 'Lycan', team: 'village', icon: '🌘', colors: [rgb(0.25, 0.15, 0.25), rgb(0.75, 0.5, 0.6)],
    balance: -1, allowsMultiple: false, nightOrder: null, looksLikeWerewolf: true,
    short: 'Warga desa biasa yang berdarah serigala: Peramal akan melihatnya sebagai WEREWOLF.',
    tips: 'Jika Peramal menuduhmu, tetap tenang dan buktikan kamu bermain untuk desa.',
  },
  cupid: {
    name: 'Cupid', team: 'neutral', icon: '💘', colors: [rgb(0.5, 0.05, 0.3), rgb(1.0, 0.45, 0.7)],
    balance: -3, allowsMultiple: false, nightOrder: 0, looksLikeWerewolf: false,
    short: 'Malam pertama memilih dua pemain sebagai pasangan kekasih. Jika satu mati, yang lain ikut mati karena patah hati.',
    tips: 'Pasangan beda tim akan menang bersama jika tinggal mereka berdua.',
  },
  tanner: {
    name: 'Si Penyamak', team: 'neutral', icon: '🪦', colors: [rgb(0.25, 0.2, 0.2), rgb(0.65, 0.55, 0.5)],
    balance: -2, allowsMultiple: false, nightOrder: null, looksLikeWerewolf: false,
    short: 'Benci pekerjaannya. Ia MENANG sendiri jika berhasil dieksekusi lewat voting.',
    tips: 'Bersikaplah mencurigakan—tapi jangan terlalu jelas!',
  },
  thief: {
    name: 'Pencuri', team: 'village', icon: '🦹', colors: [rgb(0.15, 0.15, 0.18), rgb(0.6, 0.6, 0.7)],
    balance: -1, allowsMultiple: false, nightOrder: -1, looksLikeWerewolf: false,
    short: 'Malam pertama boleh mencuri kartu satu pemain: kamu jadi peran itu, dan dia jadi Warga Desa. Kalau tidak mencuri, kamu warga biasa.',
    tips: 'Curi kartu yang kuat—tapi hati-hati, kalau mencuri Werewolf kamu pindah ke Tim Serigala!',
  },
};

export type RoleCounts = Partial<Record<Role, number>>;

export const WAKE_SCRIPT: Partial<Record<Role, string>> = {
  thief: 'Pencuri, bangunlah. Tunjuk satu orang yang kartunya ingin kamu curi, atau tetap jadi warga biasa.',
  cupid: 'Cupid, bangunlah. Tunjuk dua orang yang akan saling jatuh cinta.',
  bodyguard: 'Pengawal, bangunlah. Siapa yang ingin kamu lindungi malam ini?',
  werewolf: 'Para serigala, bangunlah. Sepakati satu korban yang akan kalian mangsa malam ini.',
  witch: 'Penyihir, bangunlah. Lihat korban malam ini. Ingin menyelamatkannya? Atau meracuni seseorang?',
  seer: 'Peramal, bangunlah. Tunjuk satu orang yang ingin kamu ketahui identitasnya.',
  necromancer: 'Nekromancer, bangunlah. Ingin membangkitkan seseorang dari kematian malam ini?',
  spellcaster: 'Perapal Mantra, bangunlah. Siapa yang ingin kamu bungkam, atau larang ikut voting besok?',
  insomniac: 'Insomnia, bangunlah. Apakah kamu ingin jalan-jalan malam ini?',
  diseased: 'Si Sakit, bangunlah. Serigala telah menyerangmu. Tunjuk satu penyerangmu untuk tertular penyakitmu.',
};

export function sleepScript(role: Role): string {
  if (role === 'cupid') return 'Cupid, tidurlah. Para kekasih, buka mata dan lihat pasangan kalian… lalu tidur kembali.';
  if (role === 'werewolf') return 'Para serigala, tidurlah kembali.';
  return `${ROLE_INFO[role].name}, tidurlah kembali.`;
}
