#!/usr/bin/env python3
"""
Agrega exports CSV do scrape_nextembroidery_converter.py e gera o catálogo
`web/public/data/marathon_poly.json` para o app offline.

Schema de saída (array JSON):
  [
    {
      "code": "2229",
      "name": "Blue",
      "hex": "#52c0e2",
      "r": 82, "g": 192, "b": 226
    },
    ...
  ]

Linhas consideradas: target_brand == "Marathon Poly" (normaliza espaços).
Deduplicação por código de cor; em conflito, mantém nome não vazio e hex mais recente.

Uso:
  python scripts/build_marathon_catalog.py saida.csv outro.csv -o web/public/data/marathon_poly.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

import pandas as pd

BRAND = "Marathon Poly"
# Limite de pares (searched_rgb, similarity) por código — evita JSON enorme em lotes grandes.
MAX_SITE_SIMILARITY_SAMPLES = 500

RGB_RE = re.compile(
    r"rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)",
    re.IGNORECASE,
)


def parse_rgb(s: str) -> Optional[tuple[int, int, int]]:
    if not isinstance(s, str) or not s.strip():
        return None
    m = RGB_RE.search(s.strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def normalize_hex(h: str) -> Optional[str]:
    if not isinstance(h, str) or not h.strip():
        return None
    t = h.strip()
    if not t.startswith("#"):
        t = "#" + t
    if len(t) == 7:
        return t.lower()
    return None


def hex_to_rgb(hex_str: str) -> Optional[tuple[int, int, int]]:
    h = normalize_hex(hex_str)
    if not h:
        return None
    try:
        return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]
    except ValueError:
        return None


def _parse_similarity(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    try:
        if pd.isna(raw):
            return None
    except (TypeError, ValueError):
        pass
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def row_to_entry(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    code = str(row.get("target_color_code", "")).strip()
    if not code:
        return None
    name = str(row.get("target_color_name", "") or "").strip()
    hex_val = normalize_hex(str(row.get("target_hex", "") or ""))
    rgb = parse_rgb(str(row.get("target_rgb", "") or ""))
    if rgb is None and hex_val:
        rgb = hex_to_rgb(hex_val)
    if rgb is None:
        return None
    r, g, b = rgb
    if hex_val is None:
        hex_val = f"#{r:02x}{g:02x}{b:02x}"
    out: dict[str, Any] = {
        "code": code,
        "name": name,
        "hex": hex_val,
        "r": r,
        "g": g,
        "b": b,
    }
    sim = _parse_similarity(row.get("similarity_percent"))
    sr = str(row.get("searched_rgb") or "").strip()
    if sim is not None and sr:
        out["site_similarity_samples"] = [{"searched_rgb": sr, "similarity": sim}]
    return out


def _merge_similarity_samples(
    a: list[dict[str, Any]], b: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Por searched_rgb normalizado, mantém a maior similarity."""
    best: dict[str, tuple[str, float]] = {}
    order: list[str] = []
    for src in (a, b):
        for item in src:
            if not isinstance(item, dict):
                continue
            sr = str(item.get("searched_rgb") or "").strip()
            if not sr:
                continue
            key = re.sub(r"\s+", "", sr.lower())
            sim = _parse_similarity(item.get("similarity"))
            if sim is None:
                continue
            if key not in order:
                order.append(key)
            prev = best.get(key)
            if prev is None or sim > prev[1]:
                best[key] = (sr, sim)
    out: list[dict[str, Any]] = [
        {"searched_rgb": best[k][0], "similarity": best[k][1]}
        for k in order
        if k in best
    ]
    return out[:MAX_SITE_SIMILARITY_SAMPLES]


def merge_entries(
    existing: dict[str, dict[str, Any]], new: dict[str, Any]
) -> None:
    code = new["code"]
    if code not in existing:
        existing[code] = dict(new)
        return
    old = existing[code]
    if not old.get("name") and new.get("name"):
        old["name"] = new["name"]
    old["hex"] = new["hex"]
    old["r"], old["g"], old["b"] = new["r"], new["g"], new["b"]
    ns = new.get("site_similarity_samples")
    if isinstance(ns, list) and ns:
        os = old.get("site_similarity_samples")
        old["site_similarity_samples"] = _merge_similarity_samples(
            os if isinstance(os, list) else [], ns
        )


def json_color_to_entry(item: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Cores já no formato do app (ex.: saída de scrape_marathon_poly_direct)."""
    code = str(item.get("code", "")).strip()
    if not code:
        return None
    name = str(item.get("name", "") or "").strip()
    hex_val = normalize_hex(str(item.get("hex", "") or ""))
    r = item.get("r")
    g = item.get("g")
    b = item.get("b")
    if r is None or g is None or b is None:
        if hex_val:
            rgb = hex_to_rgb(hex_val)
            if rgb:
                r, g, b = rgb
        if r is None:
            return None
    try:
        r, g, b = int(r), int(g), int(b)
    except (TypeError, ValueError):
        return None
    if hex_val is None:
        hex_val = f"#{r:02x}{g:02x}{b:02x}"
    out: dict[str, Any] = {
        "code": code,
        "name": name,
        "hex": hex_val,
        "r": r,
        "g": g,
        "b": b,
    }
    ss = item.get("site_similarity_samples")
    if isinstance(ss, list) and ss:
        out["site_similarity_samples"] = ss
    return out


def load_json_catalog(path: Path) -> dict[str, dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"Aviso: não foi possível ler JSON {path}: {e}", file=sys.stderr)
        return by_code
    colors = data.get("colors") if isinstance(data, dict) else None
    if not isinstance(colors, list):
        print(f"Aviso: {path} sem .colors[]; ignorado.", file=sys.stderr)
        return by_code
    for item in colors:
        if isinstance(item, dict):
            ent = json_color_to_entry(item)
            if ent:
                by_code[ent["code"]] = ent
    return by_code


def load_csv(path: Path) -> dict[str, dict[str, Any]]:
    by_code: dict[str, dict[str, Any]] = {}
    df = pd.read_csv(path, dtype=str)
    if "target_brand" not in df.columns:
        print(f"Aviso: {path} não tem coluna target_brand; ignorado.", file=sys.stderr)
        return by_code
    mask = df["target_brand"].str.strip().str.lower() == BRAND.lower()
    sub = df.loc[mask]
    for _, row in sub.iterrows():
        ent = row_to_entry(row.to_dict())
        if ent:
            merge_entries(by_code, ent)
    return by_code


def load_merged(paths: list[Path]) -> dict[str, dict[str, Any]]:
    """CSV (conversão) e/ou JSON (catálogo direto ou anterior); ordem importa para merges."""
    by_code: dict[str, dict[str, Any]] = {}
    for p in paths:
        if not p.exists():
            print(f"Aviso: arquivo não encontrado: {p}", file=sys.stderr)
            continue
        suf = p.suffix.lower()
        if suf == ".json":
            chunk = load_json_catalog(p)
        else:
            chunk = load_csv(p)
        for ent in chunk.values():
            merge_entries(by_code, ent)
    return by_code


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Gera marathon_poly.json a partir de CSVs do scraper e/ou JSON de catálogo."
    )
    ap.add_argument(
        "inputs",
        nargs="*",
        metavar="ARQUIVO",
        help="CSV (conversão) ou JSON (.colors); pode misturar.",
    )
    ap.add_argument(
        "-o",
        "--output",
        default="web/public/data/marathon_poly.json",
        help="Caminho do JSON de saída.",
    )
    args = ap.parse_args()
    paths = [Path(x) for x in args.inputs]
    if not paths:
        print(
            "Nenhum ficheiro informado; use: "
            "python scripts/build_marathon_catalog.py ficheiro.csv [outro.json] -o ..."
        )
        return 1

    by_code = load_merged(paths)
    out_list = sorted(by_code.values(), key=lambda x: (x["code"]))
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "_meta": {
            "brand": BRAND,
            "count": len(out_list),
            "source": "merged CSV +/or JSON (Marathon Poly)",
        },
        "colors": out_list,
    }
    # Gravamos objeto com meta + colors para o script; o app carrega só .colors se existir
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"Escritos {len(out_list)} cores em {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
