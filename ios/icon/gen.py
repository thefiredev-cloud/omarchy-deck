#!/usr/bin/env python3
"""Generate the Omarchy Deck app icon sources and PNGs.

Concept: a deck of tiles. One amber tile is the active deck, three graphite tiles
hold a colour pill each. Four large shapes, no hairlines, no text, so it reads at 60 pt.

Usage: python3 icon/gen.py   (needs rsvg-convert and ImageMagick `magick`)
Outputs: icon/icon-{light,dark,tinted,watch}.svg and the 1024 PNGs in the asset catalogs.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icon"
IOS_SET = ROOT / "OmarchyDeck/Assets.xcassets/AppIcon.appiconset"
WATCH_SET = ROOT / "OmarchyDeckWatch/Assets.xcassets/AppIcon.appiconset"

# Tokens from wave2/tokens.json: bg #16161a, raised #1f1f25, tint #e8b36a, ok #6fcf97.
VARIANTS = {
    "light": dict(  # default (any appearance): graphite deck, as before
        bg=("#2b2a31", "#121216"),
        tile=("#4a4953", "#383740"),
        hero=("#f7cb8e", "#e4a45a"),
        pills=("#7fdca6", "#86bff2", "#bba4f3"),
    ),
    "dark": dict(  # dark appearance: deeper ground, slightly calmer foreground
        bg=("#0e0e11", "#030304"),
        tile=("#34333c", "#27262d"),
        hero=("#e9b672", "#d3924a"),
        pills=("#62bf8b", "#6fa5d6", "#a28cdc"),
    ),
    "tinted": dict(  # tinted appearance: pure grayscale, the system multiplies the tint in
        bg=("#1c1c1c", "#000000"),
        tile=("#575757", "#464646"),
        hero=("#fafafa", "#e2e2e2"),
        pills=("#cfcfcf", "#cfcfcf", "#cfcfcf"),
    ),
}

SIZE = 1024


def svg(v, scale=1.0):
    tile, gap, radius = 330, 32, 88
    grid = 2 * tile + gap
    ox = (SIZE - grid * scale) / 2
    s = scale
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">',
        "<defs>",
        f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{v["bg"][0]}"/><stop offset="1" stop-color="{v["bg"][1]}"/></linearGradient>',
        f'<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{v["tile"][0]}"/><stop offset="1" stop-color="{v["tile"][1]}"/></linearGradient>',
        f'<linearGradient id="hero" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{v["hero"][0]}"/><stop offset="1" stop-color="{v["hero"][1]}"/></linearGradient>',
        "</defs>",
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#bg)"/>',
    ]
    pill_w, pill_h, pill_inset = 156, 48, 56
    pill_i = 0
    for row in range(2):
        for col in range(2):
            x = ox + col * (tile + gap) * s
            y = ox + row * (tile + gap) * s
            hero = row == 0 and col == 0
            fill = "hero" if hero else "tile"
            out.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{tile * s:.1f}" height="{tile * s:.1f}" rx="{radius * s:.1f}" fill="url(#{fill})"/>'
            )
            if not hero:
                px = x + (tile * s - pill_w * s) / 2
                py = y + (tile - pill_inset - pill_h) * s
                out.append(
                    f'<rect x="{px:.1f}" y="{py:.1f}" width="{pill_w * s:.1f}" height="{pill_h * s:.1f}" rx="{pill_h * s / 2:.1f}" fill="{v["pills"][pill_i]}"/>'
                )
                pill_i += 1
    out.append("</svg>")
    return "\n".join(out) + "\n"


def render(svg_path, png_path, px=SIZE):
    subprocess.run(
        ["rsvg-convert", "-w", str(px), "-h", str(px), "-o", str(png_path), str(svg_path)], check=True
    )
    # App icons must be opaque and sRGB. Tinted must be pure gray.
    subprocess.run(["magick", str(png_path), "-alpha", "off", "-strip", str(png_path)], check=True)


def main():
    for name, v in VARIANTS.items():
        (ICON_DIR / f"icon-{name}.svg").write_text(svg(v))
    # watchOS masks the icon to a circle: pull the grid in so no tile corner touches the edge.
    (ICON_DIR / "icon-watch.svg").write_text(svg(VARIANTS["light"], scale=0.86))
    render(ICON_DIR / "icon-light.svg", IOS_SET / "icon-1024.png")
    render(ICON_DIR / "icon-dark.svg", IOS_SET / "icon-1024-dark.png")
    render(ICON_DIR / "icon-tinted.svg", IOS_SET / "icon-1024-tinted.png")
    render(ICON_DIR / "icon-watch.svg", WATCH_SET / "icon-1024.png")


if __name__ == "__main__":
    main()
