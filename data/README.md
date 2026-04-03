# Listas de códigos por marca (origem)

O conversor NextEmbroidery só devolve dados para **pares válidos (marca + código)**. Este projeto não inclui o catálogo completo de cada fabricante.

- [`dmc_reference.csv`](dmc_reference.csv): lista de referência DMC (códigos + nomes; origem comunitária). Use [`dmc_codes_numeric.txt`](dmc_codes_numeric.txt) para o lote: só códigos **numéricos de 3–4 dígitos**, que são os que o site costuma reconhecer para a marca DMC (nomes como Blanc/B5200 falham no AJAX).

## Como montar sua lista

1. Use **tabelas oficiais** (PDF/CSV do fabricante) e extraia os códigos que sua empresa usa.
2. Coloque **um código por linha** em um arquivo `.txt` (ver [`sample_codes_dmc.txt`](sample_codes_dmc.txt)).
3. Comentários: linhas que começam com `#` são ignoradas.
4. Alternativa: CSV com coluna `color_code` ou só a primeira coluna (mesmo formato do `scrape_nextembroidery_converter.py`).

## Uso com o modo em lote

Veja [`scrape_nextembroidery_batch.py`](../scrape_nextembroidery_batch.py) e o [README principal](../README.md).

Acúmulo incremental: cada export CSV pode ser fundido depois; para Marathon Poly no app web, use `scripts/build_marathon_catalog.py`.
