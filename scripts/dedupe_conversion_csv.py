#!/usr/bin/env python3
"""
Pós-processamento: remove linhas duplicadas de exports do conversor (mesmas
equivalências repetidas em várias execuções ou lotes).

Uso:
  python scripts/dedupe_conversion_csv.py entrada.csv -o saida_dedup.csv
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd


def main() -> int:
    p = argparse.ArgumentParser(description="Remove duplicatas de CSV de conversão de cores.")
    p.add_argument("input", help="CSV gerado pelo scraper / batch")
    p.add_argument("-o", "--output", required=True, help="CSV de saída")
    args = p.parse_args()

    try:
        df = pd.read_csv(args.input, dtype=str)
    except Exception as e:
        print(f"Erro ao ler CSV: {e}", file=sys.stderr)
        return 1

    key_cols = [
        c
        for c in (
            "source_brand",
            "source_color_code",
            "target_brand",
            "target_color_code",
        )
        if c in df.columns
    ]
    if not key_cols:
        print("Colunas esperadas não encontradas; nada deduplicado.", file=sys.stderr)
        return 1

    before = len(df)
    df = df.drop_duplicates(subset=key_cols, keep="first")
    after = len(df)

    try:
        df.to_csv(args.output, index=False, encoding="utf-8-sig")
    except OSError as e:
        print(f"Erro ao gravar: {e}", file=sys.stderr)
        return 1

    print(f"Linhas: {before} -> {after} (removidas {before - after}) -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
