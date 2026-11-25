// Nama peran berbahasa Inggris dibaca suara Indonesia (Gadis) dengan logat Indonesia,
// mis. "Hunter" jadi "hun-ter". Supaya terdengar seperti bahasa Inggris, teks yang dikirim ke
// TTS memakai ejaan bunyi Indonesia. Hanya untuk audio: teks di layar tetap ejaan aslinya.

export const PRONOUNCE: Record<string, string> = {
  Werewolf: 'Wérwulf',
  Werewolves: 'Wérwulfs',
  Villager: 'Vilejer',
  Seer: 'Siyer',
  Guardian: 'Gardien',
  Witch: 'Wic',
  Hunter: 'Hanter',
  Prince: 'Prins',
  Diseased: 'Disiist',
  Necromancer: 'Nékromenser',
  Spellcaster: 'Spélkaster',
  Insomniac: 'Insomniek',
  Lycan: 'Laiken',
  Cupid: 'Kyupid',
  Tanner: 'Tener',
  Thief: 'Tiif',
  Troublemaker: 'Trabelméker',
};

const RE = new RegExp(`\\b(${Object.keys(PRONOUNCE).join('|')})\\b`, 'gi');

/** Teks yang diucapkan TTS (nama peran diganti ejaan bunyinya). */
export function spoken(text: string): string {
  return text.replace(RE, (m) => {
    const key = Object.keys(PRONOUNCE).find((k) => k.toLowerCase() === m.toLowerCase())!;
    return PRONOUNCE[key];
  });
}
