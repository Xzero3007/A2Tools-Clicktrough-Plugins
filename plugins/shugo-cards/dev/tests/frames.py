# Test frames for the card round (0A 57), built by hand in the layout calc.js
# reads (see parseRound): five cards, the second with a bonus layer and picked
# twice, the fourth picked once, by "Tester". One "<op> <family> <hex>" line
# per frame.
import struct

def u32(x): return struct.pack("<I", x)
def lst(pairs): return bytes([len(pairs)]) + b"".join(u32(i) + u32(n) for i, n in pairs)
def picker(name, times):
    n = name.encode()
    return bytes([1, 9, 0, 10]) + u32(712) + bytes([0, 1, 9]) + bytes([len(n)]) + n + u32(16) + u32(times) + u32(0) + b"\x00"

ODYLE, REFINING, AP, STONES, TOKENS = 610610013, 610530001, 930100003, 930100023, 930100011
PAULDRONS, GLOVES, BOOTS, HELM = 210430080, 210540103, 210650085, 210360038
common = [(ODYLE, 1), (REFINING, 1), (AP, 320), (STONES, 700), (TOKENS, 30)]
cards = [
    bytes([0, 0]) + lst([(BOOTS, 1)] + common) + b"\x00",
    bytes([0xDB, 1]) + lst([(PAULDRONS, 1), (GLOVES, 1), (STONES, 1200)]) + lst([(HELM, 1)] + common) + b"\x01" + picker("Tester", 2),
    bytes([2, 0]) + lst(common) + b"\x00",
    bytes([3, 0]) + lst([(HELM, 1)] + common) + b"\x01" + picker("Tester", 1),
    bytes([4, 0]) + lst([(PAULDRONS, 1)] + common) + b"\x00",
]
body = b"\x00\x00" + u32(116211) + u32(4333) + u32(21070110) + bytes([5]) + b"".join(cards) + b"\x00" + u32(1) + bytes(12)
lines = ["# a round: card 2 with a bonus (Tester x2), card 4 (Tester x1), gold on card 5's own items",
         "0A 57 " + body.hex().upper(),
         "# a frame that is not a round",
         "0A 57 0000FFFF"]
open("round-frames.txt", "w").write("\n".join(lines) + "\n")
