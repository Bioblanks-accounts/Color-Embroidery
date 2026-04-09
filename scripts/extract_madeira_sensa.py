#!/usr/bin/env python3
"""
Extract 144 Madeira Sensa Green thread colors from the PDF shade card.

Usage:
  python scripts/extract_madeira_sensa.py

Requires: pymupdf (pip install pymupdf)

Output: web/public/data/madeira_sensa.json
"""

from __future__ import annotations

import colorsys
import json
from pathlib import Path

import fitz  # PyMuPDF

# ── Config ────────────────────────────────────────────────────────────────────
PDF_PATH     = Path("/Users/jonathancavalcanti/Downloads/Madeira_Sensa_Green_Shade_Card.pdf")
OUT_PATH     = Path(__file__).resolve().parents[1] / "web/public/data/madeira_sensa.json"

# Confirmed via pixel analysis of the rendered shade card pages
X_LEFT_PT    = 115   # center of left-card swatch rectangle (~x=90–140pt)
X_RIGHT_PT   = 220   # center of right-card swatch rectangle (~x=195–250pt)
ZOOM         = 3     # render scale factor for accuracy

# y = 52 + i * 29  (pt from page top),  i = 0..17
Y_START_PT   = 52
Y_STEP_PT    = 29
ROWS_PER_COL = 18

# All 144 codes, ordered by PDF page (indices 1–4) and row
ALL_CODES = {
    1: {
        "left":  ["066","266","023","124","064","069","125","172","024","137","065","278","078","378","037","147","039","181"],
        "right": ["153","379","179","021","013","182","384","281","116","108","381","120","321","310","309","110","035","236"],
    },
    2: {
        "left":  ["188","122","112","033","032","263","166","467","076","075","274","133","134","167","243","043","044","367"],
        "right": ["027","028","175","042","242","434","029","132","497","177","373","094","095","295","045","299","246","293"],
    },
    3: {
        "left":  ["449","469","170","048","099","248","049","103","370","050","051","251","079","250","195","097","280","397"],
        "right": ["071","149","072","084","055","255","138","128","144","056","173","127","258","058","158","145","445","059"],
    },
    4: {
        "left":  ["270","070","225","359","192","348","344","428","060","273","106","495","357","308","337","010","415","361"],
        "right": ["040","239","440","288","085","087","086","012","118","011","212","041","164","241","100","101","105","102"],
    },
}


def hex_to_name(hex_str: str) -> str:
    """Derive a descriptive color name from hex using HSL hue bucketing."""
    r = int(hex_str[1:3], 16) / 255
    g = int(hex_str[3:5], 16) / 255
    b = int(hex_str[5:7], 16) / 255
    # colorsys returns (h, l, s) — note HLS order
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    h_deg = h * 360

    if l > 0.90:
        return "White"
    if l < 0.12:
        return "Black"
    if s < 0.10:
        return "Gray" if l < 0.6 else "Light Gray"
    if l < 0.25:
        # Very dark saturated colors
        if h_deg < 30 or h_deg >= 340:
            return "Dark Red"
        if h_deg < 70:
            return "Dark Brown"
        if h_deg < 160:
            return "Dark Green"
        if h_deg < 270:
            return "Dark Blue"
        return "Dark Purple"

    if 0 <= h_deg < 15 or h_deg >= 350:
        return "Red"
    if h_deg < 25:
        return "Red Orange"
    if h_deg < 40:
        return "Orange Red" if l < 0.45 else "Salmon"
    if h_deg < 55:
        return "Orange" if s > 0.6 else "Peach"
    if h_deg < 65:
        return "Yellow Orange"
    if h_deg < 75:
        return "Golden Yellow"
    if h_deg < 90:
        return "Yellow"
    if h_deg < 115:
        return "Yellow Green"
    if h_deg < 150:
        return "Green"
    if h_deg < 165:
        return "Teal Green"
    if h_deg < 195:
        return "Teal"
    if h_deg < 225:
        return "Cyan Blue"
    if h_deg < 250:
        return "Blue"
    if h_deg < 265:
        return "Indigo"
    if h_deg < 285:
        return "Purple"
    if h_deg < 310:
        return "Violet"
    if h_deg < 330:
        return "Magenta" if s > 0.5 else "Mauve"
    if h_deg < 350:
        return "Pink"
    return "Red"


def sample_color(pix: fitz.Pixmap, x_pt: int, y_pt: int, zoom: int) -> tuple[int, int, int]:
    """Sample the RGB pixel at (x_pt, y_pt) in document coordinates."""
    px = int(x_pt * zoom)
    py = int(y_pt * zoom)
    px = max(0, min(px, pix.width - 1))
    py = max(0, min(py, pix.height - 1))
    rgb = pix.pixel(px, py)
    return rgb[0], rgb[1], rgb[2]


def main() -> None:
    if not PDF_PATH.exists():
        raise FileNotFoundError(f"PDF not found: {PDF_PATH}")

    doc = fitz.open(str(PDF_PATH))
    mat = fitz.Matrix(ZOOM, ZOOM)
    y_positions = [Y_START_PT + i * Y_STEP_PT for i in range(ROWS_PER_COL)]

    colors: list[dict] = []

    for page_idx, cols in ALL_CODES.items():
        page = doc[page_idx]
        pix = page.get_pixmap(matrix=mat)

        for row_i, (left_code, right_code) in enumerate(zip(cols["left"], cols["right"])):
            y_pt = y_positions[row_i]

            # Left column
            r, g, b = sample_color(pix, X_LEFT_PT, y_pt, ZOOM)
            hex_str = f"#{r:02x}{g:02x}{b:02x}"
            colors.append({
                "code":  left_code,
                "name":  hex_to_name(hex_str),
                "hex":   hex_str,
                "r":     r,
                "g":     g,
                "b":     b,
            })

            # Right column
            r, g, b = sample_color(pix, X_RIGHT_PT, y_pt, ZOOM)
            hex_str = f"#{r:02x}{g:02x}{b:02x}"
            colors.append({
                "code":  right_code,
                "name":  hex_to_name(hex_str),
                "hex":   hex_str,
                "r":     r,
                "g":     g,
                "b":     b,
            })

    doc.close()

    output = {
        "_meta": {
            "brand":  "Madeira Sensa Green",
            "count":  len(colors),
            "source": "PDF shade card pixel extraction (Madeira_Sensa_Green_Shade_Card.pdf)",
        },
        "colors": colors,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ Extracted {len(colors)} colors → {OUT_PATH}")
    # Print a quick preview
    for c in colors[:5]:
        print(f"  [{c['code']}] {c['hex']}  {c['name']}")
    print("  ...")
    for c in colors[-3:]:
        print(f"  [{c['code']}] {c['hex']}  {c['name']}")


if __name__ == "__main__":
    main()
