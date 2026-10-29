# Draws the app icons into public/icons/. Run once after changing the design: python3 scripts/make-icons.py
# The glyph is the open book from the sidebar brand mark (24-unit grid), white on the light-theme accent.
import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
BG_TOP, BG_BOTTOM = (16, 150, 182), (6, 104, 132)
INK = (255, 255, 255, 255)
SCALE = 4  # draw large, then downsample for smooth edges


def arc(cx, cy, r, a0, a1, steps=12):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps))) for i in range(steps + 1)]


def page(mirror):
    # M4 5.5 h6 a2 2 0 0 1 2 2 V20 a1.8 1.8 0 0 0 -1.8 -1.8 H4 z
    pts = [(4, 5.5), (10, 5.5)] + arc(10, 7.5, 2, -90, 0) + [(12, 20)] + arc(10.2, 20, 1.8, 0, -90) + [(4, 18.2), (4, 5.5)]
    return [(24 - x, y) if mirror else (x, y) for x, y in pts]


def draw(size, glyph_scale, rounded):
    s = size * SCALE
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    bg = Image.new('RGBA', (s, s))
    grad = ImageDraw.Draw(bg)
    for y in range(s):
        t = y / (s - 1)
        grad.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)) + (255,))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.225 if rounded else 0, fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    unit = s * glyph_scale / 24
    off = (s - 24 * unit) / 2
    width = round(2.2 * unit)
    for mirror in (False, True):
        pts = [(off + x * unit, off + y * unit) for x, y in page(mirror)]
        d.line(pts, fill=INK, width=width, joint='curve')
        for x, y in (pts[0], pts[-1]):
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw(192, 0.62, True).save(os.path.join(OUT, 'icon-192.png'))
draw(512, 0.62, True).save(os.path.join(OUT, 'icon-512.png'))
# Maskable icons are cropped to a circle or squircle by the OS, so fill the square and keep the glyph in the safe zone.
draw(512, 0.5, False).save(os.path.join(OUT, 'maskable-512.png'))
draw(180, 0.58, False).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', os.path.normpath(OUT))
