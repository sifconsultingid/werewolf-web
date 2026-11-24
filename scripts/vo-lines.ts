// Cetak katalog klip voice-over sebagai JSON: npx vite-node scripts/vo-lines.ts > vo-lines.json
import { VOICE_CLIPS } from '../src/game/voiceLines';
console.log(JSON.stringify(VOICE_CLIPS, null, 2));
