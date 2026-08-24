"""Write brand assets with no image library: a supersampled signed-distance render
straight into a zlib-compressed PNG.

Design is a mesh, not a logo: one coordinator node with three routed children, which
is what a Zigbee network actually is, and it stays legible at 24 px in a sidebar.
Deliberately not the Zigbee Alliance mark -- that is a trademark.
"""

import math
import struct
import zlib

# Home Assistant's integration tiles carry transparent-background marks, not filled
# app plates, so the glyph is drawn in one ink over transparency. Blue-grey rather
# than a brand blue: it sits beside HA's own Z-Wave and Matter marks without
# competing with them.
INK_LIGHT = (0x37, 0x47, 0x4F)
INK_DARK = (0xEC, 0xEF, 0xF1)



def circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def capsule(px, py, ax, ay, bx, by, r):
    """Signed distance to a thick line segment: the mesh links."""
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * t, pay - bay * t) - r


def render(size, ink, ss=4):
    """Return RGBA rows. ss = supersampling factor, so edges are genuinely smooth."""
    # Mesh geometry in a -1..1 space: coordinator centre, three children. Scaled to
    # fill the canvas because there is no background plate to sit inside.
    hub = (0.0, 0.0)
    node_r, hub_r, link_r = 0.185, 0.24, 0.07
    # Three children at equal radius (up, down-left, down-right) so no node merges
    # into the hub: 0.62 apart against summed radii of 0.425.
    nodes = [(0.0, -0.62), (-0.537, 0.31), (0.537, 0.31)]
    rows = []
    inv = 1.0 / (size * ss)
    ir, ig, ib = ink
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    # Map to -1..1 with the sub-pixel offset.
                    u = ((x * ss + sx + 0.5) * inv) * 2.0 - 1.0
                    v = ((y * ss + sy + 0.5) * inv) * 2.0 - 1.0
                    d = circle(u, v, hub[0], hub[1], hub_r)
                    for nx, ny in nodes:
                        d = min(d, circle(u, v, nx, ny, node_r))
                        d = min(d, capsule(u, v, hub[0], hub[1], nx, ny, link_r))
                    if d <= 0.0:
                        acc += 255.0
            n = ss * ss
            a = int(round(acc / n))
            # Premultiplication is not wanted here: PNG alpha is straight, so the
            # ink colour stays constant and only coverage varies. Anything else
            # leaves a dark fringe when the icon is drawn on a light card.
            row += bytes((ir, ig, ib, a))
        rows.append(bytes(row))
    return rows


def write_png(path, size, ink):
    rows = render(size, ink)
    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


if __name__ == "__main__":
    import sys

    out = sys.argv[1]
    # Home Assistant serves these itself from custom_components/<domain>/brand/ via
    # /api/brands/integration/<domain>/[dark_]<name>.png, trying the custom
    # integration BEFORE its CDN. It falls back dark_* -> plain, but a dark glyph on
    # a dark card is invisible, so the dark variants are real files, not a fallback.
    for prefix, ink in (("", INK_LIGHT), ("dark_", INK_DARK)):
        for name, size in (("icon", 256), ("icon@2x", 512), ("logo", 256), ("logo@2x", 512)):
            n = write_png(f"{out}/{prefix}{name}.png", size, ink)
            print(f"  {prefix}{name}.png {size}x{size} {n} bytes")
