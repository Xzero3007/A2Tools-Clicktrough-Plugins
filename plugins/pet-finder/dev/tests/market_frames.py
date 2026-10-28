# Builds market-frames.txt and market-cases.json from PetTracker's merchant fixture.
#   python3 -I market_frames.py <PetTracker checkout>
import json, struct, sys
fx = json.load(open(sys.argv[1] + "/tests/Fixtures/black-market.json"))
special = bytes.fromhex(fx[0]["Body"]); pets = bytes.fromhex(fx[1]["Body"])
cases = [("special", special), ("pets", pets)]
cases += [(f"trunc{n}", special[:n]) for n in range(len(special))]
cases.append(("appended", special + b"\x00"))
for i in (0, 1, 36, 173, 310, 353):
    b = bytearray(special); b[i] ^= 0xFF; cases.append((f"flip{i}", bytes(b)))
b = bytearray(special); b[19] = 0; cases.append(("currency", bytes(b)))
b = bytearray(special); b[28] = (b[28] + 1) & 0xFF; cases.append(("discount", bytes(b)))
b = bytearray(special); b[37:41] = special[2:6]; cases.append(("duplicate", bytes(b)))
b = bytearray(special); b[10:18] = struct.pack("<q", 2); cases.append(("quantity", bytes(b)))
b = bytearray(special); b[6:10] = struct.pack("<i", 534660193); cases.append(("soulitem", bytes(b)))
with open("market-frames.txt", "w") as f:
    for name, body in cases: f.write(f"91 56 {body.hex()}\n")
json.dump([c[0] for c in cases], open("market-cases.json", "w"))
