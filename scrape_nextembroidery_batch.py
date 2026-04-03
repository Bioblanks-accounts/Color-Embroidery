#!/usr/bin/env python3
"""
Modo em lote para o conversor NextEmbroidery: muitos códigos de origem, marcas alvo fixas,
pausa entre requisições, checkpoint e retomada (resume).

Reutiliza as mesmas chamadas HTTP que scrape_nextembroidery_converter.py.

Exemplo:
  python scrape_nextembroidery_batch.py \\
    -s DMC \\
    --codes-file data/sample_codes_dmc.txt \\
    -t "Marathon Poly" \\
    --similarity 90 \\
    --delay 1.0 \\
    -o out/batch_master.csv \\
    --checkpoint out/batch_state.json

Retomar após interrupção:
  python scrape_nextembroidery_batch.py ... --resume
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from typing import Any, Iterable, List, Optional, Set

import pandas as pd

from scrape_nextembroidery_converter import (
    DEFAULT_PAGE_URL,
    fetch_source_rgb,
    post_conversion,
    results_to_rows,
    _session,
)
from urllib.parse import urljoin


def read_codes_file(path: Path) -> List[str]:
    """Lê .txt (um código por linha, # comentário) ou .csv (color_code ou coluna 1)."""
    suf = path.suffix.lower()
    if suf == ".csv":
        from scrape_nextembroidery_converter import parse_csv_codes

        return parse_csv_codes(str(path))
    text = path.read_text(encoding="utf-8", errors="replace")
    out: List[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    return out


def load_checkpoint(path: Path) -> tuple[Set[str], Optional[str]]:
    if not path.exists():
        return set(), None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set(), None
    codes = data.get("completed_codes")
    if not isinstance(codes, list):
        return set(), None
    brand = data.get("source_brand")
    return {str(x) for x in codes}, brand if isinstance(brand, str) else None


def save_checkpoint(
    path: Path, source_brand: str, completed: Set[str], url: str
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_brand": source_brand,
        "page_url": url,
        "completed_codes": sorted(completed),
        "count": len(completed),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


CSV_FIELDNAMES = [
    "source_brand",
    "source_color_code",
    "source_rgb",
    "target_brand",
    "target_color_code",
    "target_color_name",
    "similarity_percent",
    "target_rgb",
    "target_hex",
    "searched_rgb",
]


def append_rows_csv(output_path: Path, rows: List[dict[str, Any]], write_header: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if write_header else "a"
    with open(output_path, mode, newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES, extrasaction="ignore")
        if write_header:
            w.writeheader()
        for row in rows:
            w.writerow(row)


def merge_to_xlsx(csv_path: Path, xlsx_path: Path) -> None:
    df = pd.read_csv(csv_path, dtype=str)
    df.to_excel(xlsx_path, index=False, engine="openpyxl")


def main(argv: Optional[Iterable[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="Lote: conversão de cores NextEmbroidery com checkpoint e resume.",
    )
    p.add_argument("--url", default=DEFAULT_PAGE_URL, help="URL da página do conversor.")
    p.add_argument("-s", "--source-brand", required=True, help="Marca de origem.")
    p.add_argument(
        "--codes-file",
        required=True,
        type=Path,
        help="Arquivo .txt (um código por linha) ou .csv (color_code ou 1ª coluna).",
    )
    p.add_argument(
        "-t",
        "--target-brand",
        action="append",
        dest="target_brands",
        required=True,
        help="Marca(s) destino (repita -t).",
    )
    p.add_argument("--similarity", type=int, default=90, help="90–100 (padrão 90 para mais matches).")
    p.add_argument("--delay", type=float, default=1.0, help="Segundos entre códigos (padrão 1.0).")
    p.add_argument("-o", "--output", required=True, type=Path, help="CSV de saída (master).")
    p.add_argument(
        "--checkpoint",
        type=Path,
        help="JSON de progresso (padrão: <output>.state.json ao lado do CSV).",
    )
    p.add_argument(
        "--resume",
        action="store_true",
        help="Pula códigos já listados no checkpoint.",
    )
    p.add_argument(
        "--also-xlsx",
        action="store_true",
        help="Ao final, gera também .xlsx com o mesmo nome base do CSV.",
    )
    args = p.parse_args(list(argv) if argv is not None else None)

    if args.similarity < 90 or args.similarity > 100:
        print("Erro: --similarity deve estar entre 90 e 100.", file=sys.stderr)
        return 2

    try:
        codes = read_codes_file(args.codes_file)
    except Exception as e:
        print(f"Erro ao ler códigos: {e}", file=sys.stderr)
        return 1

    if not codes:
        print("Nenhum código encontrado no arquivo.", file=sys.stderr)
        return 1

    checkpoint_path = args.checkpoint
    if checkpoint_path is None:
        checkpoint_path = args.output.with_suffix(args.output.suffix + ".state.json")

    if not args.resume:
        if args.output.exists():
            print(
                "Erro: o arquivo de saída já existe. Apague-o, use outro -o, ou rode com --resume.",
                file=sys.stderr,
            )
            return 1
        if checkpoint_path.exists():
            try:
                checkpoint_path.unlink()
            except OSError as e:
                print(f"Aviso: não foi possível remover checkpoint antigo: {e}", file=sys.stderr)

    completed: Set[str] = set()
    if args.resume:
        if not args.output.exists():
            print(
                "Erro: com --resume o arquivo CSV de saída deve existir (dados anteriores).",
                file=sys.stderr,
            )
            return 1
        ck_done, ck_brand = load_checkpoint(checkpoint_path)
        if ck_brand and ck_brand != args.source_brand:
            print(
                f"Erro: checkpoint é para marca '{ck_brand}', mas -s é '{args.source_brand}'.",
                file=sys.stderr,
            )
            return 1
        completed = ck_done
        if completed:
            print(f"Retomando: {len(completed)} códigos já concluídos (checkpoint).", file=sys.stderr)

    page_url = args.url.rstrip("/") + "/"
    ajax_base = urljoin(page_url, "/wp-admin/admin-ajax.php")
    targets = list(dict.fromkeys(args.target_brands))
    session = _session()

    pending = [c for c in codes if c not in completed]
    if not pending:
        print("Nada a fazer: todos os códigos já estão no checkpoint.", file=sys.stderr)
        return 0

    # Com --resume o CSV já pode existir; acrescentamos linhas sem repetir cabeçalho.
    write_header = not args.output.exists()
    total_rows = 0

    for i, code in enumerate(pending):
        try:
            r, g, b = fetch_source_rgb(session, code, args.source_brand, ajax_base)
            rgb_str = f"rgb({r}, {g}, {b})"
            selected = [
                {
                    "color_number": code,
                    "manufacturer": args.source_brand,
                    "rgb": rgb_str,
                }
            ]
            api_block = post_conversion(
                session, page_url, selected, targets, args.similarity
            )
            rows = results_to_rows(api_block)
            append_rows_csv(args.output, rows, write_header=write_header)
            write_header = False
            total_rows += len(rows)
            completed.add(code)
            save_checkpoint(checkpoint_path, args.source_brand, completed, page_url)
            print(f"[{i+1}/{len(pending)}] {code} -> {len(rows)} linhas", file=sys.stderr)
        except KeyboardInterrupt:
            print("\nInterrompido. Estado salvo no checkpoint; use --resume para continuar.", file=sys.stderr)
            return 130
        except Exception as e:
            print(f"Erro código '{code}': {e}", file=sys.stderr)
            continue

        if i < len(pending) - 1 and args.delay > 0:
            time.sleep(args.delay)

    print(
        f"Concluído. {len(pending)} códigos processados nesta execução; "
        f"{total_rows} linhas novas no CSV; total checkpoint: {len(completed)} códigos.",
        file=sys.stderr,
    )

    if args.also_xlsx and args.output.suffix.lower() == ".csv":
        xlsx_path = args.output.with_suffix(".xlsx")
        try:
            merge_to_xlsx(args.output, xlsx_path)
            print(f"Excel: {xlsx_path}", file=sys.stderr)
        except Exception as e:
            print(f"Aviso: não foi possível gerar XLSX: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
