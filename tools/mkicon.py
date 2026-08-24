"""Write brand assets with no image library: a supersampled signed-distance render
straight into a zlib-compressed PNG.

Design is a mesh, not a logo: one coordinator node with three routed children, which
is what a Zigbee network actually is, and it stays legible at 24 px in a sidebar.
Deliberately not the Zigbee Alliance mark -- that is a trademark.
"""

import math
import struct
import zlib

HA_BLUE = (0x03, 0xA9, 0xF4)
WHITE = (0xFF, 0xFF, 0xFF)


def rounded_rect(px, py, w, h, r):
    """Signed distance to a rounded rectangle centred on the origin."""
    qx, qy = abs(px) - (w - r), abs(py) - (h - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def capsule(px, py, ax, ay, bx, by, r):
    """Signed distance to a thick line segment: the mesh links."""
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * t, pay - bay * t) - r


def render(size, ss=4):
    """Return RGBA rows. ss = supersampling factor, so edges are genuinely smooth."""
    # Mesh geometry in a -1..1 space: coordinator centre, three children.
    hub = (0.0, 0.0)
    node_r, hub_r, link_r = 0.155, 0.20, 0.055
    # Three children at equal radius (up, down-left, down-right) so no node merges
    # into the hub: 0.52 apart against summed radii of 0.355.
    nodes = [(0.0, -0.52), (-0.45, 0.26), (0.45, 0.26)]
    rows = []
    inv = 1.0 / (size * ss)
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    # Map to -1..1 with the sub-pixel offset.
                    u = ((x * ss + sx + 0.5) * inv) * 2.0 - 1.0
                    v = ((y * ss + sy + 0.5) * inv) * 2.0 - 1.0

                    # Background plate: rounded square covering most of the canvas.
                    if rounded_rect(u, v, 0.92, 0.92, 0.30) <= 0.0:
                        r, g, b = HA_BLUE
                        a = 255.0
                        # Mesh drawn on top in white.
                        d = circle(u, v, hub[0], hub[1], hub_r)
                        for nx, ny in nodes:
                            d = min(d, circle(u, v, nx, ny, node_r))
                            d = min(d, capsule(u, v, hub[0], hub[1], nx, ny, link_r))
                        if d <= 0.0:
                            r, g, b = WHITE
                    else:
                        r = g = b = a = 0.0

                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
                    acc[3] += a
            n = ss * ss
            row += bytes(int(round(c / n)) for c in acc)
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
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
    for name, size in (("icon", 256), ("icon@2x", 512), ("logo", 256), ("logo@2x", 512)):
        n = write_png(f"{out}/{name}.png", size)
        print(f"  {name}.png {size}x{size} {n} bytes")
