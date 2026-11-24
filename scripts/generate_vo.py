#!/usr/bin/env python3
"""Generate klip voice-over narator dari vo-lines.json pakai edge-tts (suara neural Azure).

Pemakaian:
  npx vite-node scripts/vo-lines.ts > vo-lines.json
  python3 -m pip install edge-tts
  python3 scripts/generate_vo.py vo-lines.json public/vo/gadis

Catatan: edge-tts memakai endpoint "Read aloud" Microsoft Edge (tidak resmi, tanpa API key).
Untuk jalur resmi, ganti ke Azure Speech (free tier) dengan suara yang sama: id-ID-GadisNeural.
"""
import asyncio, json, os, sys

import edge_tts

VOICE = os.environ.get("VO_VOICE", "id-ID-GadisNeural")
RATE = os.environ.get("VO_RATE", "-5%")


async def main(src: str, out: str) -> None:
    lines = json.load(open(src, encoding="utf-8"))
    os.makedirs(out, exist_ok=True)
    # Teks lama dari manifest: klip yang teksnya berubah (mis. nama peran) direkam ulang
    old = {}
    try:
        old = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8")).get("texts", {})
    except (OSError, ValueError):
        pass
    done = []
    for i, (cid, text) in enumerate(lines.items(), 1):
        path = os.path.join(out, f"{cid}.mp3")
        stale = cid in old and old[cid] != text
        if stale or not os.path.exists(path) or os.path.getsize(path) == 0:
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)
                    break
                except Exception as e:  # jaringan putus → coba lagi
                    print(f"  ulang {cid}: {e}")
                    await asyncio.sleep(2)
        print(f"[{i}/{len(lines)}] {cid}")
        done.append(cid)
    json.dump({"voice": VOICE, "rate": RATE, "clips": done, "texts": lines},
              open(os.path.join(out, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Selesai: {len(done)} klip di {out}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
