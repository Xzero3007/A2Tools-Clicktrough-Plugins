# Test frames: "<op> <family> <hex body>" per line, built from the layouts
# (no capture): the closet at login, a closet entry added, and a stock of
# the merchant's Skins tab.
import json, struct
def V(n):
    out = bytearray()
    while True:
        b = n & 127; n >>= 7
        out.append(b | (128 if n else 0))
        if not n: return bytes(out)
lines, names = [], []
def frame(op, fam, body, name):
    names.append(name)
    lines.append(f"{op:02X} {fam:02X} {body.hex().upper()}")

# Closet at login: 200 entries (two-byte count), the last one 10015108.
looks = [10001101 + i for i in range(199)] + [10015108]
frame(0x5B, 0x8D, V(len(looks)) + b"".join(struct.pack("<II", i, 3 if i == 10015108 else 1) for i in looks) + bytes([2, 1]) + struct.pack("<I", 125), "closet")
# One added: Duskpath (Skin: Boots) -> 30150106; then the category points.
frame(0x5C, 0x8D, bytes([1]) + struct.pack("<II", 30150106, 2) + bytes([1, 6]) + struct.pack("<I", 137), "added")
# A Skins tab stock (203): ten offers, refresh in an hour.
WHEN = 1893481200000  # 2030-01-01 07:00 UTC
items = [535810734, 535710120, 535810258, 535910151, 535710121, 535810729, 535710113, 535810253, 535910096, 535810731]
body = bytearray([203, 10])
for n, item in enumerate(items):
    disc = n % 4
    orig = 400000 + n * 1000
    paid = {0: 90, 1: 80, 2: 70, 3: 50}[disc]
    body += struct.pack("<IIQBBQQ", 230000 + n, item, 1, disc, 0x5D, orig, orig * paid // 100)
    if n in (0, 4): body.append(0x55)
    if n == 8: body.append(0x05)
body += struct.pack("<QI", WHEN + 3600 * 1000, 0)
assert len(body) == 357, len(body)
frame(0x91, 0x56, bytes(body), "stock")
# Longer than a stock: not one.
frame(0x91, 0x56, bytes(body) + b"\x00", "longer")
# The Shop opening (it answers each time, two zero bytes).
frame(0x61, 0xE2, bytes(2), "shop-open")
open("frames.txt", "w").write("\n".join(lines) + "\n")
json.dump(names, open("cases.json", "w"))
