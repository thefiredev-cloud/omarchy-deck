#!/usr/bin/env python3
"""Contact sheet: each appearance at 1024 (shown 256), 180, 120, 87, 60 and 40 px, masked like iOS.

Usage: python3 icon/contact_sheet.py OUT.png
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SET = ROOT / "OmarchyDeck/Assets.xcassets/AppIcon.appiconset"
ROWS = [("light", "icon-1024.png", (242, 242, 247)), ("dark", "icon-1024-dark.png", (0, 0, 0)), ("tinted", "icon-1024-tinted.png", (24, 24, 28))]
SIZES = [180, 120, 87, 60, 40]


def masked(img, px):
    big = img.convert("RGB").resize((px * 4, px * 4), Image.LANCZOS)
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big.width - 1, big.height - 1], radius=int(big.width * 0.2237), fill=255)
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    out.paste(big, (0, 0), mask)
    return out.resize((px, px), Image.LANCZOS)


def tint(img, rgb):
    """Approximate the system tint: multiply luminance by a tint colour."""
    g = img.convert("L")
    base = Image.new("RGB", g.size, (0, 0, 0))
    col = Image.new("RGB", g.size, rgb)
    return Image.composite(col, base, g)


def main(out):
    pad = 24
    row_h = 256 + pad * 2
    width = pad + 256 + pad + sum(s + pad for s in SIZES)
    sheet = Image.new("RGB", (width, row_h * len(ROWS)), (128, 128, 128))
    for r, (name, file, bg) in enumerate(ROWS):
        y0 = r * row_h
        ImageDraw.Draw(sheet).rectangle([0, y0, width, y0 + row_h], fill=bg)
        src = Image.open(SET / file)
        if name == "tinted":
            src = tint(src, (232, 179, 106))  # tokens tint #e8b36a
        x = pad
        icon = masked(src, 256)
        sheet.paste(icon, (x, y0 + pad), icon)
        x += 256 + pad
        for s in SIZES:
            icon = masked(src, s)
            sheet.paste(icon, (x, y0 + pad + (256 - s) // 2), icon)
            x += s + pad
    sheet.save(out)


if __name__ == "__main__":
    main(sys.argv[1])
