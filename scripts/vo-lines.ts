// Cetak katalog klip voice-over sebagai JSON: npx vite-node scripts/vo-lines.ts > vo-lines.json
// Teks yang dicetak adalah teks yang DIUCAPKAN (nama peran Inggris pakai ejaan bunyi, lihat pronounce.ts).
import { VOICE_CLIPS } from '../src/game/voiceLines';
import { spoken } from '../src/game/pronounce';
const out: Record<string, string> = {};
for (const [id, text] of Object.entries(VOICE_CLIPS)) out[id] = spoken(text);
console.log(JSON.stringify(out, null, 2));
