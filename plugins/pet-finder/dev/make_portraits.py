# Writes the Pet Finder plugin's large pet portraits, portraits/<id>.webp
# (256 px), from a PetTracker checkout (https://github.com/0Fox2Give/PetTracker,
# GPLv3; only assets/portraits is needed), for every pet images.js has a
# small portrait of. An open card in the Cards layout shows its pet's large
# one, loaded only then (a2.file); images.js keeps the small ones.
#
#   python3 -I dev/make_portraits.py <PetTracker checkout> <plugin folder>
import json, pathlib, sys
from PIL import Image

src, out = map(pathlib.Path, sys.argv[1:3])
text = (out / "images.js").read_text()
start = text.index("globalThis.PET_IMAGES = ") + len("globalThis.PET_IMAGES = ")
ids = sorted(json.JSONDecoder().raw_decode(text[start:])[0]["portraits"], key=int)
folder = out / "portraits"
folder.mkdir(exist_ok=True)
for old in folder.glob("*.webp"):
    old.unlink()
total = 0
for pet in ids:
    im = Image.open(src / "assets" / "portraits" / f"{pet}.png").convert("RGBA")
    im.thumbnail((256, 256), Image.LANCZOS)
    path = folder / f"{pet}.webp"
    im.save(path, "WEBP", quality=82, method=6)
    total += path.stat().st_size
print(f"{len(ids)} portraits, {total // 1024} KiB")
