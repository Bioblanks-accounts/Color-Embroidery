#!/usr/bin/env python3
"""
Verifies Marathon Poly catalog hex values against the NextEmbroidery reference site.

Compares each thread code's stored RGB with the site's check_color_in_database endpoint.
Reports mismatches and optionally auto-corrects the catalog JSON.

Usage:
  python scripts/verify_marathon_catalog.py                          # verify all 301 codes
  python scripts/verify_marathon_catalog.py --codes 2024,2250        # spot-check specific codes
  python scripts/verify_marathon_catalog.py --fix                    # auto-correct mismatches
  python scripts/verify_marathon_catalog.py --fix --codes 2024       # fix specific codes only
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scrape_nextembroidery_converter import (
    DEFAULT_PAGE_URL,
    fetch_source_rgb,
    _session,
)

BRAND = "Marathon Poly"
DEFAULT_CATALOG = _ROOT / "web" / "public" / "data" / "marathon_poly.json"
DEFAULT_REPORT = _ROOT / "out" / "verify_report.csv"


def load_catalog(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Verify Marathon Poly catalog against NextEmbroidery reference site."
    )
    ap.add_argument(
        "--catalog",
        type=Path,
        default=DEFAULT_CATALOG,
        help=f"Path to marathon_poly.json (default: {DEFAULT_CATALOG})",
    )
    ap.add_argument(
        "--codes",
        help="Comma-separated list of codes to check (default: all).",
    )
    ap.add_argument(
        "--fix",
        action="store_true",
        help="Auto-correct mismatched hex/RGB values in the catalog JSON.",
    )
    ap.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"CSV report output path (default: {DEFAULT_REPORT}).",
    )
    ap.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds between requests (default: 1.0).",
    )
    ap.add_argument(
        "--url",
        default=DEFAULT_PAGE_URL,
        help="Base URL of the converter page.",
    )
    args = ap.parse_args()

    if not args.catalog.exists():
        print(f"Error: catalog not found: {args.catalog}", file=sys.stderr)
        return 1

    data = load_catalog(args.catalog)
    colors = data.get("colors", []) if isinstance(data, dict) else data
    if not colors:
        print("Error: no colors in catalog.", file=sys.stderr)
        return 1

    # Build lookup by code
    by_code = {c["code"]: c for c in colors if isinstance(c, dict) and c.get("code")}

    # Filter codes if specified
    if args.codes:
        target_codes = [c.strip() for c in args.codes.split(",") if c.strip()]
        missing = [c for c in target_codes if c not in by_code]
        if missing:
            print(f"Warning: codes not in catalog: {missing}", file=sys.stderr)
        check_list = [(code, by_code[code]) for code in target_codes if code in by_code]
    else:
        check_list = [(c["code"], c) for c in colors if isinstance(c, dict) and c.get("code")]

    page_url = args.url.rstrip("/") + "/"
    ajax_base = urljoin(page_url, "/wp-admin/admin-ajax.php")
    session = _session()

    mismatches = []
    matches = []
    errors = []
    report_rows = []

    print(f"Verifying {len(check_list)} codes against {page_url} ...\n")

    for i, (code, entry) in enumerate(check_list):
        current_hex = entry.get("hex", "")
        current_r = entry.get("r", 0)
        current_g = entry.get("g", 0)
        current_b = entry.get("b", 0)

        try:
            site_r, site_g, site_b = fetch_source_rgb(session, code, BRAND, ajax_base)
        except Exception as e:
            errors.append((code, str(e)))
            report_rows.append({
                "code": code,
                "current_hex": current_hex,
                "site_hex": "ERROR",
                "name": entry.get("name", ""),
                "delta_r": "",
                "delta_g": "",
                "delta_b": "",
                "status": f"ERROR: {e}",
            })
            if i < len(check_list) - 1 and args.delay > 0:
                time.sleep(args.delay)
            continue

        site_hex = f"#{site_r:02x}{site_g:02x}{site_b:02x}"
        dr = abs(current_r - site_r)
        dg = abs(current_g - site_g)
        db = abs(current_b - site_b)
        is_match = dr == 0 and dg == 0 and db == 0

        status = "OK" if is_match else "MISMATCH"
        report_rows.append({
            "code": code,
            "current_hex": current_hex,
            "site_hex": site_hex,
            "name": entry.get("name", ""),
            "delta_r": dr,
            "delta_g": dg,
            "delta_b": db,
            "status": status,
        })

        if is_match:
            matches.append(code)
        else:
            mismatches.append(code)
            print(f"  MISMATCH {code}: catalog={current_hex} site={site_hex} (dr={dr} dg={dg} db={db})")

            if args.fix:
                entry["hex"] = site_hex
                entry["r"] = site_r
                entry["g"] = site_g
                entry["b"] = site_b

        if (i + 1) % 20 == 0:
            print(f"  [{i+1}/{len(check_list)}] checked — {len(mismatches)} mismatches so far")

        if i < len(check_list) - 1 and args.delay > 0:
            time.sleep(args.delay)

    # Summary
    print(f"\n{'='*60}")
    print(f"Total checked:  {len(check_list)}")
    print(f"Matches (OK):   {len(matches)}")
    print(f"Mismatches:     {len(mismatches)}")
    print(f"Errors:         {len(errors)}")
    if mismatches:
        print(f"Mismatched codes: {mismatches}")

    # Write report CSV
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with open(args.report, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["code", "current_hex", "site_hex", "name", "delta_r", "delta_g", "delta_b", "status"])
        writer.writeheader()
        writer.writerows(report_rows)
    print(f"Report written to: {args.report}")

    # Fix catalog if requested
    if args.fix and mismatches:
        data["colors"] = colors
        with open(args.catalog, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Catalog updated with {len(mismatches)} corrections: {args.catalog}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
