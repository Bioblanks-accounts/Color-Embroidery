# Color Embroidery — BioBlanks Thread Tools

> Ferramenta interna da BioBlanks para encontrar a linha de bordado mais próxima de qualquer cor, rodando 100% offline no navegador.

---

## O que faz

O usuário escolhe uma cor (via color picker ou HEX) e a aplicação compara com todos os fios dos catálogos disponíveis, devolvendo os **top 5 matches** ordenados por proximidade visual — sem necessidade de internet, sem servidor, sem instalação.

---

## Catálogos disponíveis

| Catálogo | Threads | Algoritmo padrão |
|---|---|---|
| **Marathon Poly** | 301 cores | Euclidean RGB |
| **Madeira Sensa Green** | 144 cores | CIEDE2000 |

Os catálogos são carregados localmente a partir de arquivos JSON (`/data/marathon_poly.json` e `/data/madeira_sensa.json`), garantindo funcionamento offline completo. O Madeira Sensa Green foi extraído do catálogo oficial PDF via PyMuPDF.

---

## Fluxo de uso

```
1. Escolher cor  →  2. Selecionar marca  →  3. Ajustar accuracy  →  4. Find Matches  →  5. Ver resultados
```

### 1. Escolher cor
- **Color picker Figma-style** — grade HSV com arrasto + barra de hue. Abre/fecha com animação GSAP (`height: auto`).
- **Campo HEX** — aceita `RRGGBB` ou `#RRGGBB`, valida e sincroniza em tempo real com o picker.

### 2. Selecionar marca (Thread brand)
Dois **pill buttons** separados, seguindo o padrão BioBlanks DS (`ui.html`):
- **Ativo** → borda carbono `#1A1A19` + ponto âmbar `#F4D668`
- **Inativo** → borda neutra suave
- Trocar de marca **limpa os resultados anteriores** automaticamente — um GSAP fade-out sinaliza ao usuário que é necessária uma nova busca.

### 3. Ajustar Accuracy
Slider de 90% a 100% que filtra resultados abaixo do limiar mínimo. Visual:
- **Track verde** `#74f081` preenchendo da esquerda conforme o valor
- **Bolinha branca** com sombra verde quase imperceptível (`rgba(116,240,129,0.12)`)
- Badge do valor atual ao lado direito do label

### 4. Match mode (apenas Marathon Poly)
**Progressive disclosure** — o campo só aparece quando Marathon está selecionado:

| Opção | Algoritmo | Uso |
|---|---|---|
| **Standard** | Euclidean RGB | Resultado idêntico ao site de referência |
| **Perceptual** | CIEDE2000 | Distância perceptual humana (mais preciso visualmente) |

Para a Madeira Sensa Green o algoritmo CIEDE2000 é aplicado internamente sem expor o controle técnico ao usuário.

### 5. Resultados
- **Top 3** cards visíveis imediatamente com animação stagger GSAP
- **"2 More Options"** expande os demais com animação `height: auto`
- Cada card exibe: swatch do fio, nome, código, comparação lado a lado (cor buscada vs fio), e badge de score

---

## Score badge

Segue o padrão visual das tags de produto do Shopify BioBlanks:

```
● 91.08%
```

- Fundo charcoal `#4d4d4a` · texto branco · sem borda
- **Ponto âmbar** `#F4D668` para score calculado por distância
- **Ponto verde** `#74f081` para score originado do banco de similaridade do site de referência

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Build | Vite (vanilla JS, sem framework) |
| Cor / distância | culori v4 (`differenceCiede2000`, `differenceCie76`, `converter('hsv')`) |
| Animações | GSAP v3 (`to`, `fromTo`, `set`, `stagger`, `autoAlpha`, `height:'auto'`, `clearProps`) |
| Extração PDF | PyMuPDF / fitz (script offline `extract_madeira_sensa.py`) |
| Dados | JSON estático em `/public/data/` — offline-first |

---

## Design system

Alinhado ao **BioBlanks DS** (tokens de `bioblanks-shopify.webflow.io`):

- **Verde primário** `#74f081` — exclusivo para CTA (Find Matches) e fill do slider
- **Carbono** `#1a1a19` — borders ativos, textos principais
- **Âmbar** `#F4D668` — dot indicator dos pills e score badges
- **Tipografia** — Aeonik (headings) + SF Pro Display (body)
- **Shape** — `--r-md: 14px` cards · `--r-pill: 999px` pills e badges
- **Glass** — painel principal `rgba(255,255,255,0.78)` + blur 40px

---

## Arquitetura de arquivos relevantes

```
web/
├── src/
│   ├── main.js          # lógica completa (picker, matching, UI, GSAP)
│   └── style.css        # tokens BioBlanks DS + todos os componentes
└── public/
    └── data/
        ├── marathon_poly.json     # 301 threads Marathon Poly
        └── madeira_sensa.json    # 144 threads Madeira Sensa Green

scripts/
└── extract_madeira_sensa.py      # extração PDF → JSON via PyMuPDF

docs/
└── APP_OVERVIEW.md               # este documento
```

---

## Próximos passos em avaliação

- **Histórico de pesquisas recentes** — últimas 2 buscas em `sessionStorage`, reutilizáveis com 1 clique. O valor real está em comparar **Marathon Poly Standard vs Marathon Poly Perceptual** para a mesma cor: mesmo catálogo, dois algoritmos, resultados lado a lado. Mesma base de dados, critério diferente — aí sim é uma comparação válida.
