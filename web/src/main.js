/**
 * App offline: encontra cores Marathon Poly mais próximas (HEX/picker) via ΔE CIEDE2000.
 * O slider define o mínimo de "Match score" (derivado de ΔE), no mesmo espírito do site:
 * "No colors with at least X% match" — sem linhas abaixo desse patamar.
 */
import { differenceCiede2000, formatRgb, parse } from "culori";
import "./style.css";

const BRAND_LABEL = "Marathon Poly";
/** Top N matches (ordenados por menor ΔE = melhor correspondência). */
const MAX_RESULTS = 3;

/**
 * Match score ≈ referência NextEmbroidery (calibrado, não idêntico).
 *
 * Referência usada (culori ΔE2000): entrada rgb(240,138,138) vs linhas #fb858e (~97,12%
 * no site) e #e38782 (~96,48%). Regressão linear mínimos quadrados: score ≈ 100 − k·ΔE
 * com k ≈ 1,085. O site pode ordenar linhas de forma ligeiramente diferente (critério
 * próprio); aqui o score segue sempre o ΔE.
 */
const MATCH_SCORE_DE_SCALE = 1.0848;

function displayAccuracyPercent(deltaE) {
  const p = 100 - Math.min(100, deltaE * MATCH_SCORE_DE_SCALE);
  return Math.round(p * 100) / 100;
}

function normalizeRgbString(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

/**
 * Se o catálogo tiver amostra do scrape com o mesmo searched_rgb que a cor atual,
 * usa similarity_percent da API; caso contrário ΔE calibrado.
 */
function matchScoreFromCatalog(c, userParsed, de) {
  const userKey = normalizeRgbString(formatRgb(userParsed));
  const samples = c.site_similarity_samples;
  if (Array.isArray(samples)) {
    for (const s of samples) {
      if (normalizeRgbString(s.searched_rgb) !== userKey) continue;
      if (s.similarity == null || s.similarity === "") continue;
      const v = Number(s.similarity);
      if (!Number.isNaN(v)) {
        return { pct: Math.round(v * 100) / 100, source: "site" };
      }
    }
  }
  return { pct: displayAccuracyPercent(de), source: "deltaE" };
}

function normalizeHex(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

async function loadCatalog() {
  const res = await fetch("/data/marathon_poly.json");
  if (!res.ok) throw new Error(`Falha ao carregar catálogo: ${res.status}`);
  const data = await res.json();
  const colors = Array.isArray(data) ? data : data.colors;
  if (!colors || !colors.length) {
    throw new Error("Catálogo vazio ou formato inválido.");
  }
  const meta = data._meta || {};
  return { colors, meta };
}

function matchColors(userColorParsed, catalogColors, accuracy) {
  const deltaE = differenceCiede2000();
  const minScore = Math.min(100, Math.max(90, Number(accuracy)));
  const rows = [];

  for (const c of catalogColors) {
    const thread = parse(c.hex || `rgb(${c.r}, ${c.g}, ${c.b})`);
    if (!thread) continue;
    const de = deltaE(userColorParsed, thread);
    const { pct: accuracyPct, source: scoreSource } = matchScoreFromCatalog(
      c,
      userColorParsed,
      de
    );
    if (accuracyPct < minScore) continue;
    rows.push({
      code: c.code,
      name: c.name || "—",
      hex: c.hex || `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`,
      deltaE: de,
      accuracyPct,
      scoreSource,
    });
  }

  rows.sort((a, b) => a.deltaE - b.deltaE);
  return rows.slice(0, MAX_RESULTS);
}

function renderApp(root, state) {
  const { error } = state;
  const INITIAL_COLOR = "#3a5dff";

  root.innerHTML = `
    <div class="shell">
      <header class="header">
        <span class="eyebrow">
          <span class="eyebrow-dot"></span>
          Thread Converter · offline
        </span>
        <h1>Color <em>Embroidery</em></h1>
        <p class="subtitle">Encontra os fios <strong>${BRAND_LABEL}</strong> mais próximos da sua cor — sem internet.</p>
      </header>

      ${
        error
          ? `<div class="banner error"><span class="banner-dot"></span>${escapeHtml(error)}</div>`
          : `<div class="banner ok"><span class="banner-dot"></span>Catálogo carregado · pronto para uso</div>`
      }

      <section class="panel">

        <!-- Big color picker -->
        <div class="color-section">
          <p class="color-section-label">Selecionar cor</p>
          <div class="color-preview-wrap" title="Clique para abrir o seletor de cor">
            <div class="color-preview-bg" id="color-preview-bg" style="background:${INITIAL_COLOR}"></div>
            <input type="color" id="picker" value="${INITIAL_COLOR}" aria-label="Color picker" />
            <span class="color-preview-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 13.5V20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6.5"/>
                <path d="m7 9 5-7 5 7"/>
                <path d="M12 2v13"/>
              </svg>
              Escolher cor
            </span>
          </div>
          <div class="hex-row">
            <span class="hex-prefix">#</span>
            <input type="text" id="hex" class="hex-input" placeholder="3A5DFF" maxlength="7" value="${INITIAL_COLOR.slice(1)}" />
          </div>
        </div>

        <div class="divider"></div>

        <!-- Accuracy slider -->
        <div class="field">
          <div class="field-row">
            <span class="field-label">Correspondência mínima</span>
            <span class="acc-badge"><span id="acc-val">90</span>%</span>
          </div>
          <input type="range" id="accuracy" min="90" max="100" step="1" value="90" />
          <span class="hint">Reduza se não encontrar resultados. Valores menores mostram correspondências mais distantes.</span>
        </div>

        <!-- CTA -->
        <button type="button" class="btn" id="run">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          Buscar correspondências
        </button>
      </section>

      <section class="panel" id="results-wrap" hidden>
        <div class="results-header">
          <h2>Resultados</h2>
        </div>
        <p class="source-line" id="source-line"></p>
        <div class="table-wrap">
          <table class="grid">
            <colgroup>
              <col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Color Name</th>
                <th>Code</th>
                <th title="API do site se houver amostra no catálogo para este RGB; senão ΔE calibrado">Match</th>
                <th>Swatches</th>
                <th>HEX</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </section>

      <footer class="foot">
        <p>
          Se o JSON tiver <code>site_similarity_samples</code> e a cor coincidir com <code>searched_rgb</code>,
          o Match score usa o % da API (marcado *); caso contrário usa ΔE calibrado.
          Catálogo: <code>public/data/marathon_poly.json</code>.
        </p>
      </footer>
    </div>
  `;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  const root = document.getElementById("app");
  let catalog = [];
  let meta = {};
  let loadError = null;

  try {
    const loaded = await loadCatalog();
    catalog = loaded.colors;
    meta = loaded.meta;
  } catch (e) {
    loadError = e.message || String(e);
  }

  renderApp(root, { error: loadError });

  const picker = root.querySelector("#picker");
  const hexInput = root.querySelector("#hex");
  const colorPreviewBg = root.querySelector("#color-preview-bg");
  const accuracy = root.querySelector("#accuracy");
  const accVal = root.querySelector("#acc-val");
  const runBtn = root.querySelector("#run");
  const tbody = root.querySelector("#tbody");
  const resultsWrap = root.querySelector("#results-wrap");
  const sourceLine = root.querySelector("#source-line");

  if (accuracy && accVal) {
    accuracy.addEventListener("input", () => {
      accVal.textContent = accuracy.value;
    });
  }

  function updatePreview(hex) {
    if (colorPreviewBg) colorPreviewBg.style.background = hex;
  }

  function syncPickerFromHex() {
    // hex input has no "#" prefix — normalize accepts both
    const raw = hexInput.value.startsWith("#") ? hexInput.value : `#${hexInput.value}`;
    const h = normalizeHex(raw);
    if (h) {
      hexInput.value = h.slice(1); // show without #
      picker.value = h;
      updatePreview(h);
    }
  }

  function syncHexFromPicker() {
    hexInput.value = picker.value.slice(1); // strip #
    updatePreview(picker.value);
  }

  picker?.addEventListener("input", syncHexFromPicker);
  hexInput?.addEventListener("input", () => {
    const raw = `#${hexInput.value}`;
    const h = normalizeHex(raw);
    if (h) { picker.value = h; updatePreview(h); }
  });
  hexInput?.addEventListener("change", syncPickerFromHex);
  hexInput?.addEventListener("blur", syncPickerFromHex);

  runBtn?.addEventListener("click", () => {
    if (!catalog.length) return;
    syncPickerFromHex();
    const raw = hexInput.value.startsWith("#") ? hexInput.value : `#${hexInput.value}`;
    const h = normalizeHex(raw);
    if (!h) {
      alert("HEX inválido. Use formato RRGGBB ou #RRGGBB.");
      return;
    }
    const userParsed = parse(h);
    if (!userParsed) {
      alert("Não foi possível interpretar a cor.");
      return;
    }

    const rows = matchColors(userParsed, catalog, accuracy.value);
    resultsWrap.hidden = false;
    const rgbStr = formatRgb(userParsed);
    sourceLine.innerHTML = `Converted from: <strong>Color Picker</strong> · Color Code: <strong>N/A</strong> · RGB: <strong>${rgbStr}</strong>`;

    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(BRAND_LABEL)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(String(r.code))}</td>
        <td>
          <span class="score-badge${r.scoreSource === "site" ? " site" : ""}"
                title="${escapeHtml(r.scoreSource === "site" ? "similarity_percent do export (API) — mesmo RGB pesquisado no scrape" : "derivado de Delta E (CIEDE2000) calibrado")}">
            ${r.accuracyPct}%${r.scoreSource === "site" ? " *" : ""}
          </span>
        </td>
        <td>
          <div class="swatch-pair">
            <span class="sw" style="background:${r.hex}" title="Matched: ${r.hex}"></span>
            <span class="sw" style="background:${h}" title="Original: ${h}"></span>
          </div>
        </td>
        <td><span class="hex-code">${escapeHtml(r.hex)}</span></td>
      </tr>
    `
      )
      .join("");

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhuma cor com pelo menos <strong>${escapeHtml(accuracy.value)}%</strong> de correspondência (Match score). Reduza a correspondência mínima no slider para ver sugestões mais distantes.</td></tr>`;
    }
  });

  if (meta && Object.keys(meta).length) {
    const { count: _omit, ...rest } = meta;
    if (Object.keys(rest).length) {
      console.info("[marathon-poly-matcher]", rest);
    }
  }
}

init();
