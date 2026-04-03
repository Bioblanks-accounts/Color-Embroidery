# Color Embroidery — scraping + conversor Marathon Poly (offline)

## 1. Scraper NextEmbroidery (Python)

Extrai conversões via HTTP (ver `scrape_nextembroidery_converter.py`).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Exemplo:

```bash
python scrape_nextembroidery_converter.py -s DMC -c 666 -t "Marathon Poly" --similarity 92 -o saida.csv
```

### Modo em lote (muitos códigos, checkpoint, retomada)

Use [`scrape_nextembroidery_batch.py`](scrape_nextembroidery_batch.py) com um arquivo de códigos ([`data/README.md`](data/README.md), exemplo [`data/sample_codes_dmc.txt`](data/sample_codes_dmc.txt)):

```bash
mkdir -p out
python scrape_nextembroidery_batch.py \
  -s DMC \
  --codes-file data/sample_codes_dmc.txt \
  -t "Marathon Poly" \
  --similarity 90 \
  --delay 1.0 \
  -o out/batch_master.csv \
  --also-xlsx
```

Se interromper (Ctrl+C), continue com:

```bash
python scrape_nextembroidery_batch.py \
  -s DMC \
  --codes-file data/sample_codes_dmc.txt \
  -t "Marathon Poly" \
  --similarity 90 \
  --delay 1.0 \
  -o out/batch_master.csv \
  --resume \
  --also-xlsx
```

Antes de volumes grandes, leia [`docs/SCRAPING_NOTES.md`](docs/SCRAPING_NOTES.md).

Deduplicar vários CSVs fundidos:

```bash
python scripts/dedupe_conversion_csv.py out/batch_master.csv -o out/batch_master_dedup.csv
```

## 2. Catálogo `marathon_poly.json` (para o app offline)

O app web usa apenas `web/public/data/marathon_poly.json`. Há **dois** contributos possíveis:

1. **Conversão** (ex.: DMC → Marathon Poly): CSV do `scrape_nextembroidery_converter.py` / `scrape_nextembroidery_batch.py` — traz **nomes** e matches por similaridade.
2. **Varredura direta** na base do site: `scripts/scrape_marathon_poly_direct.py` chama o mesmo AJAX que o botão “Add to list” para cada código numérico e **Marathon Poly**. Isto cobre cores que quase nunca aparecem como match a partir de DMC (ex.: 2229), e limita-se ao que a NextEmbroidery tem na base (na prática, faixa típica **2xxx**; centenas de cores, não milhares).

Fundir CSV + JSON e gerar o ficheiro do app:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python scripts/build_marathon_catalog.py out/marathon_from_dmc.csv out/marathon_direct.json -o web/public/data/marathon_poly.json
```

Exemplo de varredura (ajuste `--start`/`--end`; use `--stop-after-miss-streak 500` para não percorrer milhares de buracos seguidos):

```bash
python scripts/scrape_marathon_poly_direct.py --start 2000 --end 5000 --delay 0.35 \
  --stop-after-miss-streak 400 -o out/marathon_direct.json
```

O arquivo inclui `_meta`, `colors` (`code`, `name`, `hex`, `r`, `g`, `b`) e, quando o CSV do scrape traz dados, `site_similarity_samples`: lista de `{ searched_rgb, similarity }` com o % devolvido pela API NextEmbroidery para esse RGB pesquisado — o app usa este valor quando a cor escolhida coincide com `searched_rgb`.

## 3. App no browser (Vite, offline)

Interface semelhante ao conversor: HEX + color picker, slider **Accuracy** 90–100%, marca **Marathon Poly** fixa, tabela de resultados.

A correspondência usa **ΔE CIEDE2000** ([culori](https://culorijs.org/)). O **Match score** (0–100%) é `100 − k·ΔE` com **k calibrado** contra pares de referência do conversor; pode haver pequenas diferenças face ao site e a **ordem** das linhas pode não coincidir (o NextEmbroidery não usa só ΔE2000 no % exibido).

### Instalação

```bash
cd web
npm install
```

### Desenvolvimento

```bash
npm run dev
```

Abra o URL indicado no terminal (geralmente `http://localhost:5173`).

### Build estático (produção)

```bash
npm run build
npm run preview
```

Os arquivos gerados ficam em `web/dist/`; podem ser servidos por qualquer servidor estático.

## Limitações

- **Cobertura**: o JSON precisa listar todas as cores Marathon Poly que você quer consultar; o scraping pontual só alimenta o catálogo quando a marca alvo é Marathon Poly e você agrega os CSVs.
- **Precisão**: Match score derivado de ΔE com factor calibrado; não é o mesmo “Accuracy %” interno do NextEmbroidery.
