#!/usr/bin/env python3
"""
Varre códigos numéricos na base NextEmbroidery para a marca **Marathon Poly**
(via GET check_color_in_database), igual ao botão "Add to list" do conversor.

Isto cobre cores que **nunca** aparecem como match a partir de DMC (ou outra origem)
no POST de conversão — necessário para um catálogo “completo” no app offline.

Não devolve nome oficial (o AJAX só dá RGB); o app aceita name vazio ou "—".

Exemplo (faixa típica 2xxx no site; ajuste conforme o seu PDF Marathon):
  python scripts/scrape_marathon_poly_direct.py --start 2000 --end 5000 \\
    --delay 0.35 -o web/public/data/marathon_poly.json \\
    --checkpoint out/marathon_poly_direct.state.json

Retomar:
  python scripts/scrape_marathon_poly_direct.py ... --resume
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scrape_nextembroidery_converter import (
    DEFAULT_PAGE_URL,
    fetch_source_rgb,
    _session,
)


def load_checkpoint(path: Path) -> set[int]:
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    done = data.get("completed_numbers")
    if not isinstance(done, list):
        return set()
    out: set[int] = set()
    for x in done:
        try:
            out.add(int(x))
        except (TypeError, ValueError):
            pass
    return out


def save_checkpoint(path: Path, completed: set[int], meta: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **meta,
        "completed_numbers": sorted(completed),
        "count": len(completed),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_json(colors: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "_meta": {
            "brand": "Marathon Poly",
            "count": len(colors),
            "source": "direct check_color_in_database scan (Marathon Poly)",
        },
        "colors": colors,
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Varre códigos Marathon Poly na base NextEmbroidery (AJAX RGB)."
    )
    ap.add_argument("--url", default=DEFAULT_PAGE_URL, help="URL base do conversor.")
    ap.add_argument("--start", type=int, default=2000, help="Primeiro número (inclusivo).")
    ap.add_argument("--end", type=int, default=5000, help="Último número (inclusivo).")
    ap.add_argument("--delay", type=float, default=0.35, help="Segundos entre pedidos.")
    ap.add_argument(
        "--stop-after-miss-streak",
        type=int,
        metavar="N",
        default=0,
        help="Parar após N códigos seguidos sem entrada na base (0 = desligado). "
        "Útil para não varrer 3000–5000 em vão quando o catálogo só existe em 2xxx.",
    )
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("web/public/data/marathon_poly.json"),
        help="JSON de saída (mesmo formato do build_marathon_catalog).",
    )
    ap.add_argument(
        "--checkpoint",
        type=Path,
        help="JSON de progresso (padrão: <output>.direct.state.json).",
    )
    ap.add_argument("--resume", action="store_true", help="Ignora números já no checkpoint.")
    args = ap.parse_args()

    if args.start > args.end:
        print("Erro: --start não pode ser maior que --end.", file=sys.stderr)
        return 2

    page_url = args.url.rstrip("/") + "/"
    ajax_base = urljoin(page_url, "/wp-admin/admin-ajax.php")
    brand = "Marathon Poly"

    ck_path = args.checkpoint
    if ck_path is None:
        ck_path = args.output.with_suffix(args.output.suffix + ".direct.state.json")

    completed: set[int] = set()
    colors_by_code: dict[str, dict[str, Any]] = {}

    if args.resume and args.output.exists():
        try:
            prev = json.loads(args.output.read_text(encoding="utf-8"))
            arr = prev.get("colors") if isinstance(prev, dict) else None
            if isinstance(arr, list):
                for item in arr:
                    if isinstance(item, dict) and item.get("code"):
                        colors_by_code[str(item["code"]).strip()] = item
        except (json.JSONDecodeError, OSError):
            pass

    if args.resume:
        completed = load_checkpoint(ck_path)
        if completed:
            print(f"Retomando: {len(completed)} números já no checkpoint.", file=sys.stderr)

    if not args.resume and ck_path.exists():
        try:
            ck_path.unlink()
        except OSError as e:
            print(f"Aviso: não removi checkpoint: {e}", file=sys.stderr)

    if args.resume and not args.output.exists():
        print(
            "Erro: --resume requer o JSON de saída (parcial) do mesmo -o.",
            file=sys.stderr,
        )
        return 1

    if not args.resume and args.output.exists():
        print(
            "Erro: o ficheiro de saída já existe. Use --resume ou apague/mude -o.",
            file=sys.stderr,
        )
        return 1

    session = _session()
    pending = [n for n in range(args.start, args.end + 1) if n not in completed]
    total_new = 0
    miss_streak = 0
    meta_ck = {"brand": brand, "range": [args.start, args.end], "page_url": page_url}

    def flush() -> None:
        save_checkpoint(ck_path, completed, meta_ck)
        out_list = sorted(colors_by_code.values(), key=lambda x: str(x["code"]))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(build_json(out_list), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    for i, n in enumerate(pending):
        code = str(n)
        try:
            r, g, b = fetch_source_rgb(session, code, brand, ajax_base)
        except Exception:
            completed.add(n)
            miss_streak += 1
            flush()
            if (i + 1) % 100 == 0 or i == len(pending) - 1:
                print(
                    f"[{i+1}/{len(pending)}] (até {code}) -> "
                    f"{len(colors_by_code)} cores na base",
                    file=sys.stderr,
                )
            if (
                args.stop_after_miss_streak > 0
                and miss_streak >= args.stop_after_miss_streak
            ):
                print(
                    f"Parado: {miss_streak} falhas seguidas (--stop-after-miss-streak).",
                    file=sys.stderr,
                )
                break
            if i < len(pending) - 1 and args.delay > 0:
                time.sleep(args.delay)
            continue

        hex_val = f"#{r:02x}{g:02x}{b:02x}"
        colors_by_code[code] = {
            "code": code,
            "name": "",
            "hex": hex_val,
            "r": int(r),
            "g": int(g),
            "b": int(b),
        }
        total_new += 1
        miss_streak = 0
        completed.add(n)
        flush()
        if (i + 1) % 100 == 0 or i == len(pending) - 1:
            print(
                f"[{i+1}/{len(pending)}] {code} -> {len(colors_by_code)} cores",
                file=sys.stderr,
            )

        if i < len(pending) - 1 and args.delay > 0:
            time.sleep(args.delay)

    print(
        f"Concluído. Novos RGB nesta execução: {total_new}; "
        f"total entradas únicas: {len(colors_by_code)} -> {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
