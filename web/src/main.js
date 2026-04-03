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

  root.innerHTML = `
    <div class="shell">
      <header class="header">
        <h1>Thread color matcher</h1>
        <p class="subtitle">Marca alvo fixa: <strong>${BRAND_LABEL}</strong> · dados locais (JSON)</p>
      </header>

      ${
        error
          ? `<div class="banner error">${escapeHtml(error)}</div>`
          : `<div class="banner ok">Catálogo carregado.</div>`
      }

      <section class="panel">
        <label class="field">
          <span>Cor (HEX)</span>
          <div class="row">
            <input type="color" id="picker" value="#3a5dff" />
            <input type="text" id="hex" class="hex-input" placeholder="#3A5DFF" maxlength="7" value="#3a5dff" />
          </div>
        </label>

        <label class="field">
          <span>Correspondência mínima <span class="acc-val" id="acc-val">90</span>%</span>
          <input type="range" id="accuracy" min="90" max="100" step="1" value="90" />
          <span class="hint">Só aparecem linhas com Match score ≥ este valor (como “pelo menos X%” no NextEmbroidery). Reduza se não houver resultados.</span>
        </label>

        <button type="button" class="btn" id="run">Buscar correspondências</button>
      </section>

      <section class="panel results" id="results-wrap" hidden>
        <h2>Resultados</h2>
        <p class="source-line" id="source-line"></p>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Thread Brand</th>
                <th>Color Name</th>
                <th>Color Code</th>
                <th title="API do site se houver amostra no catálogo para este RGB; senão ΔE calibrado">Match score</th>
                <th>Matched | Original</th>
                <th>HEX</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </section>

      <footer class="foot">
        <p>
          Se o JSON tiver <code>site_similarity_samples</code> (vindo dos CSV do scrape) e a tua cor
          coincidir com <code>searched_rgb</code>, o <strong>Match score</strong> usa o % da API; caso contrário usa ΔE calibrado.
          Catálogo: <code>public/data/marathon_poly.json</code>. * = percentagem da API nos dados do scrape.
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

  function syncPickerFromHex() {
    const h = normalizeHex(hexInput.value);
    if (h) {
      hexInput.value = h;
      picker.value = h;
    }
  }

  function syncHexFromPicker() {
    hexInput.value = picker.value;
  }

  picker?.addEventListener("input", syncHexFromPicker);
  hexInput?.addEventListener("change", syncPickerFromHex);
  hexInput?.addEventListener("blur", syncPickerFromHex);

  runBtn?.addEventListener("click", () => {
    if (!catalog.length) return;
    syncPickerFromHex();
    const h = normalizeHex(hexInput.value);
    if (!h) {
      alert("HEX inválido. Use formato #RRGGBB.");
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
        <td title="${escapeHtml(r.scoreSource === "site" ? "similarity_percent do export (API) — mesmo RGB pesquisado no scrape" : "derivado de Delta E (CIEDE2000) calibrado")}">${r.accuracyPct}%${r.scoreSource === "site" ? " *" : ""}</td>
        <td class="swatch-cell">
          <span class="sw matched" style="background:${r.hex}" title="Matched"></span>
          <span class="sw orig" style="background:${h}" title="Original"></span>
        </td>
        <td><code>${escapeHtml(r.hex)}</code></td>
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
