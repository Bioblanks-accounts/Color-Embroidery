#!/usr/bin/env python3
"""
Preenche o campo 'name' vazio nos threads do marathon_poly.json.

Estratégia:
  1) Tenta o endpoint AJAX check_color_in_database — se a resposta vier com 'name', usa.
  2) Fallback: POST no conversor buscando o próprio código Marathon Poly como alvo.
     A resposta JSON inclui o nome oficial do thread.

Uso:
  pip install requests beautifulsoup4 lxml
  python scripts/fill_missing_names.py

O arquivo marathon_poly.json é atualizado in-place (backup gerado automaticamente).
"""

from __future__ import annotations

import html as html_lib
import json
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ───────────────────────────────────────────────────────────────────
CATALOG_PATH = Path(__file__).resolve().parents[1] / "web/public/data/marathon_poly.json"
AJAX_URL     = "https://nextembroidery.com/wp-admin/admin-ajax.php"
PAGE_URL     = "https://nextembroidery.com/thread-color-converter/"
MANUFACTURER = "Marathon Poly"
DELAY        = 0.6   # seconds between requests — be polite
TIMEOUT      = (12, 40)
USER_AGENT   = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    return s


def try_ajax_name(s: requests.Session, code: str) -> str | None:
    """Try the AJAX endpoint — some responses include a 'name' or 'color_name' field."""
    try:
        r = s.get(AJAX_URL, params={
            "action": "check_color_in_database",
            "color_number": code,
            "manufacturer": MANUFACTURER,
        }, timeout=TIMEOUT)
        r.raise_for_status()
        payload = json.loads(r.content.decode("utf-8-sig").lstrip("\ufeff"))
        data = payload.get("data") or {}
        # Try known name keys
        for key in ("name", "color_name", "thread_name", "title"):
            if data.get(key):
                return str(data[key]).strip()
    except Exception:
        pass
    return None


def try_converter_name(s: requests.Session, code: str) -> str | None:
    """
    POST the converter with the Marathon Poly code as source,
    searching for Marathon Poly as the target brand.
    The response JSON includes 'name' for each matched color.
    """
    selected = json.dumps([{"manufacturer": MANUFACTURER, "color_number": code}])
    form = [
        ("color_source",        "thread_color"),
        ("manufacturer",        MANUFACTURER),
        ("color_number",        code),
        ("similarity_threshold","80"),
        ("selected_colors",     selected),
        ("check_color",         ""),
        ("search_manufacturers[]", MANUFACTURER),
    ]
    try:
        resp = s.post(PAGE_URL, data=form, timeout=TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        inp  = soup.find("input", id="results-input")
        if not inp or not inp.get("value"):
            return None
        results = json.loads(html_lib.unescape(inp["value"]))
        # results is a list; each item may be {name, number, similarity, ...}
        for item in results:
            num = str(item.get("number", "")).strip()
            name = str(item.get("name", "")).strip()
            if num == code and name:
                return name
            # Some responses wrap by brand key
            if isinstance(item, dict):
                for brand_key, brand_data in item.items():
                    if isinstance(brand_data, list):
                        for match in brand_data:
                            if str(match.get("number","")).strip() == code and match.get("name"):
                                return str(match["name"]).strip()
    except Exception as e:
        print(f"    converter error: {e}", flush=True)
    return None


def main() -> None:
    if not CATALOG_PATH.exists():
        sys.exit(f"Catalog not found: {CATALOG_PATH}")

    raw  = CATALOG_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    colors = data["colors"] if isinstance(data, dict) else data

    missing = [c for c in colors if not (c.get("name") or "").strip()]
    if not missing:
        print("No missing names — nothing to do.")
        return

    print(f"Found {len(missing)} threads with missing names. Fetching...\n")

    # Backup
    backup = CATALOG_PATH.with_suffix(".json.bak")
    backup.write_text(raw, encoding="utf-8")
    print(f"Backup saved to {backup}\n")

    s = session()
    filled = 0
    failed = []

    for c in missing:
        code = str(c["code"])
        print(f"  [{code}] ", end="", flush=True)

        # Step 1: AJAX
        name = try_ajax_name(s, code)
        if name:
            print(f"ajax → '{name}'", flush=True)
        else:
            # Step 2: Converter POST
            time.sleep(DELAY)
            name = try_converter_name(s, code)
            if name:
                print(f"converter → '{name}'", flush=True)
            else:
                print("NOT FOUND", flush=True)
                failed.append(code)

        if name:
            c["name"] = name
            filled += 1

        time.sleep(DELAY)

    # Save updated catalog
    if isinstance(data, dict):
        data["colors"] = colors
        if data.get("_meta"):
            data["_meta"]["missing_names_filled"] = filled
    else:
        data = colors

    CATALOG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"\n✓ Filled {filled}/{len(missing)} names.")
    if failed:
        print(f"  Still missing ({len(failed)}): {', '.join(failed)}")
        print("  → Check these manually against the Marathon Poly PDF catalog.")
    print(f"  Catalog saved: {CATALOG_PATH}")


if __name__ == "__main__":
    main()
