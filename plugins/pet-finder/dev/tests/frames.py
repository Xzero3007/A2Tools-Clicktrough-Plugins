# Test frames: "<op> <family> <hex body>" per line, built like PetTracker's
# tests (tests/Program.cs, tests/Fixtures/nearby-appearances.json).
import struct
def V(n):
    out = bytearray()
    while True:
        b = n & 127; n >>= 7
        out.append(b | (128 if n else 0))
        if not n: return bytes(out)
def u32(x): return struct.pack("<I", x)
lines = []
def frame(op, fam, body, note):
    lines.append(f"# {note}")
    lines.append(f"{op:02X} {fam:02X} {body.hex().upper()}")

# PetTracker fixtures: appearance of NPC 2100481 (Krall Sentinel -> a pet), NPC at +0.
frame(0x41, 0x36, bytes.fromhex("650C2000010D20000002"), "fixture 1: npc 2100481 at +0, entity 0x65")
frame(0x41, 0x36, bytes.fromhex("660D2000010D20000002"), "fixture 2: entity 0x66")
# The same as a summon (kind 0x3F): never a spawn.
frame(0x41, 0x36, bytes.fromhex("673F2000010D20000002"), "summon kind 0x3F")
# NPC at +2 (the a-variant), entity 300 (two-byte varint).
frame(0x40, 0x36, V(300) + bytes([0x0C, 0x20, 0x00, 0xAA, 0xBB]) + u32(2100481) + bytes([0x00, 0x02]), "npc at +2, entity 300")
# An unknown NPC id: a spawn, but no pet.
frame(0x41, 0x36, bytes.fromhex("68") + bytes([0x0C, 0x20, 0x00]) + u32(2100482) + bytes([0x00, 0x02]), "unknown npc 2100482, entity 0x68")
# Removal of entity 0x65 (death, reason 3): exactly varint + 00 + reason.
frame(0x42, 0x36, bytes.fromhex("650003"), "removal of 0x65, reason 3")
# A longer 42 36 frame whose second byte is 0: no removal.
frame(0x42, 0x36, bytes.fromhex("66000300FF"), "longer 42 36 frame for 0x66: not a removal")
# Collection at login (PetTracker Snapshot()): ranks and counters.
ranks = {1007: 1, 1086: 2, 1163: 1}
souls = {1007: 24, 1086: 45}
body = u32(0) + V(len(ranks)) + b"".join(u32(k) + u32(k) + u32(v) for k, v in ranks.items()) + V(len(souls)) + b"".join(u32(k) + u32(v) for k, v in souls.items())
frame(0x00, 0x90, body, "collection: 1007 r1 24, 1086 r2 45, 1163 r1 0")
# A 00 90 frame that is something else.
frame(0x00, 0x90, bytes.fromhex("0102030405060708090A0B0C"), "garbage 00 90")
# Souls gained (Points 0x0D): 1007 +1 -> 25, then 1029 and 1098 +1.
frame(0x0D, 0x90, V(1) + u32(1007) + u32(1), "gain 1007 +1")
frame(0x0D, 0x90, V(2) + u32(1029) + u32(1) + u32(1098) + u32(1), "gain 1029 +1, 1098 +1")
# Spent on the rank-up (0x0E) and the rank (14 90, 23 bytes).
frame(0x0E, 0x90, V(1) + u32(1007) + u32(25), "spent 1007 25")
rb = bytearray(23); rb[2:6] = u32(1007); rb[6:10] = u32(2)
frame(0x14, 0x90, bytes(rb), "rank 1007 -> 2")
rb2 = bytearray(23); rb2[0] = 1; rb2[2:6] = u32(1007); rb2[6:10] = u32(3)
frame(0x14, 0x90, bytes(rb2), "rank frame with status 1: ignored")
open("frames.txt", "w").write("\n".join(lines) + "\n")
print(len([l for l in lines if not l.startswith('#')]), "frames")
