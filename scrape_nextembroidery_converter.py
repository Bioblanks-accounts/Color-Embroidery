#!/usr/bin/env python3
"""
Extrai conversões de cores do Thread Color Converter da NextEmbroidery.

Fluxo descoberto no site:
1) GET  wp-admin/admin-ajax.php?action=check_color_in_database  — valida código/marca e devolve RGB.
2) POST multipart na página do conversor com selected_colors (JSON), search_manufacturers[],
   similarity_threshold e botão check_color — a resposta HTML inclui <input id="results-input">
   com um JSON contendo equivalências por marca (nome, número, similaridade, RGB, hex).

Uso típico:
  python scrape_nextembroidery_converter.py -s DMC -c 666 -t "Madeira Classic 40" -t "Isacord 40" -o resultado.xlsx

Instalação das dependências:
  python3 -m venv .venv && source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
  pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import sys
import time
from typing import Any, Iterable, List, Optional
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup

DEFAULT_PAGE_URL = "https://nextembroidery.com/thread-color-converter/"
DEFAULT_TIMEOUT = (15, 45)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _session() -> requests.Session:
    """Sessão HTTP com headers de navegador e timeouts padrão."""
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return s


def fetch_source_rgb(
    session: requests.Session,
    color_number: str,
    manufacturer: str,
    ajax_base: str,
) -> tuple[int, int, int]:
    """
    Consulta o RGB do código na base do site (mesmo endpoint usado pelo botão Add Color to List).
    """
    params = {
        "action": "check_color_in_database",
        "color_number": color_number.strip(),
        "manufacturer": manufacturer.strip(),
    }
    try:
        r = session.get(ajax_base, params=params, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"Falha ao consultar RGB (rede ou HTTP): {e}") from e

    try:
        text = r.content.decode("utf-8-sig").lstrip("\ufeff")
        payload = json.loads(text)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise RuntimeError("Resposta AJAX não é JSON válido.") from e

    if not payload.get("success"):
        raise RuntimeError(f"Código não encontrado ou erro do servidor: {payload}")

    data = payload.get("data") or {}
    if not data.get("found"):
        raise RuntimeError(
            f"Código '{color_number}' não encontrado para a marca '{manufacturer}'."
        )

    r_, g_, b_ = data["r"], data["g"], data["b"]
    return int(r_), int(g_), int(b_)


def post_conversion(
    session: requests.Session,
    page_url: str,
    selected_colors: List[dict[str, Any]],
    search_manufacturers: List[str],
    similarity_threshold: int,
) -> list[dict[str, Any]]:
    """
    Envia o formulário de conversão e devolve a lista JSON do campo results-input.
    """
    # Primeiro item define manufacturer/color_number exibidos no formulário (como no site).
    primary = selected_colors[0]
    selected_json = json.dumps(selected_colors, ensure_ascii=False)
    form_items: list[tuple[str, Any]] = [
        ("color_source", "thread_color"),
        ("manufacturer", primary["manufacturer"]),
        ("color_number", primary["color_number"]),
        ("similarity_threshold", str(similarity_threshold)),
        ("selected_colors", selected_json),
        ("check_color", ""),
    ]
    for brand in search_manufacturers:
        form_items.append(("search_manufacturers[]", brand))

    try:
        resp = session.post(page_url, data=form_items, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"Falha no POST do conversor: {e}") from e

    soup = BeautifulSoup(resp.text, "lxml")
    inp = soup.find("input", id="results-input")
    if inp is None or not inp.get("value"):
        raise RuntimeError(
            "Campo 'results-input' não encontrado na resposta. "
            "O layout do site pode ter mudado ou a conversão falhou."
        )

    raw = html_lib.unescape(inp["value"])
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"JSON inválido em results-input: {e}") from e

    if not isinstance(parsed, list):
        raise RuntimeError("Formato inesperado: results-input deveria ser uma lista.")
    return parsed


def results_to_rows(api_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Achata a resposta da API em linhas para o DataFrame."""
    rows: list[dict[str, Any]] = []
    for block in api_results:
        src_brand = block.get("converted_from", "")
        src_code = block.get("color_code", "")
        src_rgb = block.get("rgb", "")
        for match in block.get("results") or []:
            rows.append(
                {
                    "source_brand": src_brand,
                    "source_color_code": src_code,
                    "source_rgb": src_rgb,
                    "target_brand": match.get("manufacturer", ""),
                    "target_color_code": match.get("color_number", ""),
                    "target_color_name": match.get("color_name", ""),
                    "similarity_percent": match.get("similarity"),
                    "target_rgb": match.get("found_rgb", ""),
                    "target_hex": match.get("hex", ""),
                    "searched_rgb": match.get("searched_rgb", ""),
                }
            )
    return rows


def parse_csv_codes(path: str) -> list[str]:
    """Lê uma coluna 'color_code' ou a primeira coluna de um CSV."""
    df = pd.read_csv(path, dtype=str)
    if "color_code" in df.columns:
        return [str(x).strip() for x in df["color_code"].tolist() if str(x).strip()]
    return [str(x).strip() for x in df.iloc[:, 0].tolist() if str(x).strip()]


def export_dataframe(df: pd.DataFrame, output_path: str) -> None:
    """Exporta CSV (UTF-8 com BOM) ou Excel conforme extensão."""
    path = output_path.lower()
    try:
        if path.endswith(".xlsx"):
            df.to_excel(output_path, index=False, engine="openpyxl")
        elif path.endswith(".csv"):
            df.to_csv(output_path, index=False, encoding="utf-8-sig")
        else:
            raise ValueError("Use extensão .csv ou .xlsx")
    except OSError as e:
        raise RuntimeError(f"Não foi possível gravar o arquivo: {e}") from e


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Conversor de cores NextEmbroidery → CSV/XLSX (via API HTTP do site).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Instalação:
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt

Exemplos:
  %(prog)s -s DMC -c 666 -t "Madeira Classic 40" -o saida.csv
  %(prog)s -s DMC --codes-csv codes.csv -t "Isacord 40" -t "DMC" --similarity 90 -o batch.xlsx
""",
    )
    p.add_argument(
        "--url",
        default=DEFAULT_PAGE_URL,
        help="URL da página do conversor (padrão: NextEmbroidery).",
    )
    p.add_argument(
        "-s",
        "--source-brand",
        required=True,
        help="Marca de origem (ex.: DMC, Madeira Classic 40).",
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument(
        "-c",
        "--color-code",
        action="append",
        dest="color_codes",
        help="Código de cor na marca de origem (pode repetir -c várias vezes).",
    )
    g.add_argument(
        "--codes-csv",
        metavar="FILE",
        help="CSV com códigos (coluna color_code ou primeira coluna).",
    )
    p.add_argument(
        "-t",
        "--target-brand",
        action="append",
        dest="target_brands",
        required=True,
        help="Marca(s) para converter (repita -t para várias).",
    )
    p.add_argument(
        "--similarity",
        type=int,
        default=96,
        help="Limite mínimo de similaridade (90–100). Padrão: 96.",
    )
    p.add_argument(
        "--delay",
        type=float,
        default=0.6,
        help="Pausa em segundos entre requisições em lote (padrão: 0.6).",
    )
    p.add_argument(
        "-o",
        "--output",
        required=True,
        help="Arquivo de saída .csv ou .xlsx.",
    )
    return p


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = build_arg_parser().parse_args(list(argv) if argv is not None else None)

    if args.similarity < 90 or args.similarity > 100:
        print("Erro: --similarity deve estar entre 90 e 100.", file=sys.stderr)
        return 2

    if args.color_codes:
        codes: List[str] = []
        for c in args.color_codes:
            codes.extend(x.strip() for x in c.split(",") if x.strip())
    else:
        try:
            codes = parse_csv_codes(args.codes_csv)
        except Exception as e:
            print(f"Erro ao ler CSV: {e}", file=sys.stderr)
            return 1
        if not codes:
            print("Nenhum código encontrado no CSV.", file=sys.stderr)
            return 1

    page_url = args.url.rstrip("/") + "/"
    ajax_base = urljoin(page_url, "/wp-admin/admin-ajax.php")

    session = _session()
    all_rows: list[dict[str, Any]] = []

    for i, code in enumerate(codes):
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
                session,
                page_url,
                selected,
                list(dict.fromkeys(args.target_brands)),
                args.similarity,
            )
            rows = results_to_rows(api_block)
            if not rows:
                print(
                    f"Aviso: nenhuma equivalência acima de {args.similarity}% para código {code} "
                    f"(RGB do site: {rgb_str}).",
                    file=sys.stderr,
                )
            all_rows.extend(rows)
        except RuntimeError as e:
            print(f"Erro no código '{code}': {e}", file=sys.stderr)
            continue
        except KeyboardInterrupt:
            print("Interrompido.", file=sys.stderr)
            return 130

        if i < len(codes) - 1 and args.delay > 0:
            time.sleep(args.delay)

    if not all_rows:
        print("Nenhuma linha exportada.", file=sys.stderr)
        return 1

    df = pd.DataFrame(all_rows)
    try:
        export_dataframe(df, args.output)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    print(f"Exportadas {len(df)} linhas para {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
