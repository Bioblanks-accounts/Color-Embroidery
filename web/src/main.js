/**
 * Offline app: closest embroidery thread colors (HEX/picker) via CIEDE2000 / Euclidean.
 * Supports two catalogs: Marathon Poly & Madeira Sensa Green.
 */
import { differenceCiede2000, differenceCie76, formatRgb, formatHex, parse, converter } from "culori";
import gsap from "gsap";
import "./style.css";

/** Top N matches shown immediately; extras revealed on demand. */
const MAX_RESULTS = 5;
const INITIAL_SHOW = 3;

/** HSV converter via culori */
const toHsv = converter("hsv");

function hexToHsv(hex) {
  const c = toHsv(parse(hex));
  return { h: c?.h ?? 0, s: c?.s ?? 0, v: c?.v ?? 1 };
}

function hsvToHex(h, s, v) {
  return formatHex({ mode: "hsv", h, s, v }) || "#000000";
}

/**
 * Euclidean RGB distance in 0-255 scale.
 */
function euclideanRgb255(std, smp) {
  const dr = (std.r - smp.r) * 255;
  const dg = (std.g - smp.g) * 255;
  const db = (std.b - smp.b) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const ALGORITHMS = {
  ciede2000:  { label: "CIEDE2000",       fn: () => differenceCiede2000(), scale: 1.0848 },
  cie76:      { label: "Delta E 1976",    fn: () => differenceCie76(),     scale: 0.8843 },
  euclidean:  { label: "Euclidean RGB",   fn: euclideanRgb255,             scale: 0.2264 },
};

/** Catalog definitions */
const CATALOGS = {
  marathon: {
    key:         "marathon",
    label:       "Marathon Poly",
    file:        "/data/marathon_poly.json",
    defaultAlgo: "euclidean",
    lockAlgo:    false,
  },
  madeira: {
    key:         "madeira",
    label:       "Madeira Sensa Green",
    file:        "/data/madeira_sensa.json",
    defaultAlgo: "ciede2000",
    lockAlgo:    true,
  },
};

const HINTS = {
  euclidean: "Matches the reference site results.",
  ciede2000: "Uses human color perception (advanced).",
};


// ── Module-level state ───────────────────────────────────────────────────────
let _currentUserHex = "#3a5dff";
let activeCatalog   = "marathon";

// ── Utility ──────────────────────────────────────────────────────────────────
function displayAccuracyPercent(distance, scale) {
  const p = 100 - Math.min(100, distance * scale);
  return Math.round(p * 100) / 100;
}

function normalizeRgbString(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

function matchScoreFromCatalog(c, userParsed, distance, scale) {
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
  return { pct: displayAccuracyPercent(distance, scale), source: "deltaE" };
}

function normalizeHex(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function getRelative(event, el) {
  const rect = el.getBoundingClientRect();
  const cx = event.touches?.[0]?.clientX ?? event.clientX;
  const cy = event.touches?.[0]?.clientY ?? event.clientY;
  return {
    x: clamp01((cx - rect.left) / rect.width),
    y: clamp01((cy - rect.top) / rect.height),
  };
}

// ── Catalog loading ──────────────────────────────────────────────────────────
async function loadCatalogs() {
  const entries = await Promise.all(
    Object.values(CATALOGS).map(async (cat) => {
      try {
        const res = await fetch(cat.file);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        const colors = Array.isArray(data) ? data : data.colors;
        if (!colors?.length) throw new Error("Empty catalog");
        return [cat.key, { colors, meta: data._meta || {}, error: null }];
      } catch (e) {
        return [cat.key, { colors: [], meta: {}, error: e.message }];
      }
    })
  );
  return Object.fromEntries(entries);
}

// ── Color matching ────────────────────────────────────────────────────────────
function matchColors(userColorParsed, catalogColors, accuracy, algorithm = "euclidean") {
  const algo = ALGORITHMS[algorithm] || ALGORITHMS.ciede2000;
  const distFn = typeof algo.fn === "function" && algo.fn.length >= 2 ? algo.fn : algo.fn();
  const minScore = Math.min(100, Math.max(0, Number(accuracy)));
  const rows = [];

  for (const c of catalogColors) {
    const thread = parse(c.hex || `rgb(${c.r}, ${c.g}, ${c.b})`);
    if (!thread) continue;
    const dist = distFn(userColorParsed, thread);
    const { pct: accuracyPct, source: scoreSource } = matchScoreFromCatalog(c, userColorParsed, dist, algo.scale);
    if (accuracyPct < minScore) continue;
    rows.push({
      code: c.code,
      name: c.name || "—",
      hex: c.hex || `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`,
      deltaE: dist,
      accuracyPct,
      scoreSource,
    });
  }

  rows.sort((a, b) => a.deltaE - b.deltaE);
  return rows.slice(0, MAX_RESULTS);
}

// ── Card renderer ─────────────────────────────────────────────────────────────
function renderCard(r, i, brandLabel) {
  const RANKS = ["#1", "#2", "#3", "#4", "#5"];
  return `
    <div class="thread-card">
      <div class="card-swatch" style="background:${r.hex}">
        <span class="swatch-score${r.scoreSource === "site" ? " site" : ""}">${r.accuracyPct}%</span>
        <span class="card-rank">${RANKS[i] || `#${i + 1}`}</span>
      </div>
      <div class="card-content">
        <div class="card-top">
          <p class="card-name">${escapeHtml(r.name)}</p>
          <span class="score-badge${r.scoreSource === "site" ? " site" : ""}"
                title="${escapeHtml(r.scoreSource === "site" ? "Similarity from site API (same searched RGB)" : "Calibrated distance score")}">
            ${r.accuracyPct}%
          </span>
        </div>
        <div class="card-meta">
          <span>${escapeHtml(brandLabel)}</span>
          <span class="card-dot"></span>
          <span class="card-code">${escapeHtml(String(r.code))}</span>
        </div>
        <div class="card-compare">
          <span class="sw-sm" style="background:${r.hex}" title="Thread: ${r.hex}"></span>
          <span class="sw-vs">vs</span>
          <span class="sw-sm" style="background:${_currentUserHex || r.hex}" title="Your color"></span>
          <span class="hex-code">${escapeHtml(r.hex)}</span>
        </div>
      </div>
    </div>
  `;
}

// ── App HTML ──────────────────────────────────────────────────────────────────
function renderApp(root, state) {
  const { error } = state;
  const INITIAL_COLOR = "#3a5dff";

  root.innerHTML = `
    <div class="shell">
      <header class="header">
        <span class="eyebrow">
          <span class="eyebrow-dot"></span>
          BioBlanks · Thread Tools
        </span>
        <h1>Embroidery <em>thread matcher</em></h1>
        <p class="subtitle">Find the closest embroidery thread match for your color — works offline.</p>
      </header>

      <div class="main-row">
      <div class="input-col">
      ${
        error
          ? `<div class="banner error"><span class="banner-dot"></span>${escapeHtml(error)}</div>`
          : ``
      }

      <section class="panel">

        <!-- Color picker trigger -->
        <div class="color-section">
          <p class="color-section-label">Pick a color</p>
          <div class="color-preview-wrap" id="color-preview-wrap"
               role="button" tabindex="0"
               aria-label="Open color picker" aria-expanded="false"
               title="Click to open color picker">
            <div class="color-preview-bg" id="color-preview-bg" style="background:${INITIAL_COLOR}"></div>
            <span class="color-preview-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 13.5V20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6.5"/>
                <path d="m7 9 5-7 5 7"/>
                <path d="M12 2v13"/>
              </svg>
              Choose color
            </span>
          </div>

          <!-- Figma-style HSV picker (hidden by default) -->
          <div class="figma-picker" id="figma-picker" aria-hidden="true">
            <div class="picker-sq" id="picker-sq" role="slider" aria-label="Color saturation and brightness">
              <div class="picker-cursor" id="picker-cursor"></div>
            </div>
            <div class="picker-hue-track" id="picker-hue" role="slider" aria-label="Hue">
              <div class="picker-hue-thumb" id="picker-hue-thumb"></div>
            </div>
          </div>

          <div class="hex-row">
            <span class="hex-prefix">#</span>
            <input type="text" id="hex" class="hex-input" placeholder="3A5DFF" maxlength="7" value="${INITIAL_COLOR.slice(1)}" />
          </div>
        </div>

        <div class="divider"></div>

        <!-- Thread brand selector — pill cards (distinct from segmented algo toggle) -->
        <div class="field catalog-field">
          <div class="field-row">
            <span class="field-label">Thread brand</span>
          </div>
          <div class="brand-pills" id="cat-cards" role="group" aria-label="Select thread brand">
            <button type="button" class="brand-pill active" data-cat="marathon" id="cat-marathon" aria-pressed="true">
              <span class="brand-pill-inner">
                <span class="brand-pill-dot"></span>
                <span class="brand-pill-label">Marathon Poly</span>
              </span>
            </button>
            <button type="button" class="brand-pill" data-cat="madeira" id="cat-madeira" aria-pressed="false">
              <span class="brand-pill-inner">
                <span class="brand-pill-dot"></span>
                <span class="brand-pill-label">Madeira Sensa</span>
              </span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Accuracy slider -->
        <div class="field">
          <div class="field-row">
            <span class="field-label">Accuracy</span>
            <span class="acc-badge"><span id="acc-val">90</span>%</span>
          </div>
          <input type="range" id="accuracy" min="90" max="100" step="1" value="90" />
          <span class="hint">Lower this if you get no results. Lower values include more distant matches.</span>
        </div>

        <!-- Match mode toggle -->
        <div class="field" id="algo-field">
          <div class="field-row">
            <span class="field-label">Match mode</span>
          </div>
          <div class="seg-toggle" id="seg-toggle">
            <span class="seg-slider" id="seg-slider"></span>
            <button type="button" class="seg-btn active" data-algo="euclidean" id="seg-euclidean">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
              Standard
            </button>
            <button type="button" class="seg-btn" data-algo="ciede2000" id="seg-ciede">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              Perceptual
            </button>
          </div>
          <span class="hint" id="algo-hint">Matches the reference site results.</span>
        </div>

        <!-- CTA -->
        <button type="button" class="btn" id="run">
          Find Matches
          <svg width="13" height="14" viewBox="0 0 13 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12.0754 6.35112C9.41934 6.13537 7.3134 3.89397 7.109 1.06961C7.05464 0.31013 5.94242 0.31013 5.88915 1.06961C5.68475 3.89397 3.57881 6.13537 0.923825 6.35112C0.12907 6.4154 0.12907 7.58459 0.923825 7.64888C3.57881 7.86463 5.68584 10.106 5.88915 12.9304C5.94351 13.6899 7.05573 13.6899 7.109 12.9304C7.3134 10.106 9.41934 7.86463 12.0754 7.64888C12.8713 7.58459 12.8713 6.4154 12.0754 6.35112Z" fill="currentColor"/>
          </svg>
        </button>
      </section>
      </div>

      <section class="panel" id="results-wrap" hidden>
        <div class="results-header">
          <h2>Results</h2>
          <!-- Algo comparison tabs — visible only after Compare is triggered -->
          <div class="algo-tabs" id="algo-tabs" hidden aria-hidden="true">
            <button type="button" class="algo-tab active" id="tab-primary" data-tab="primary"></button>
            <button type="button" class="algo-tab" id="tab-secondary" data-tab="secondary"></button>
          </div>
        </div>
        <div class="thread-cards" id="tbody"></div>
        <!-- Compare button — visible only for Marathon with results -->
        <button type="button" class="btn-compare" id="btn-compare" hidden aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
          <span id="compare-label">Compare with Perceptual</span>
        </button>
      </section>
      </div>

    </div>
  `;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const root = document.getElementById("app");

  // Load both catalogs in parallel
  const catalogData = await loadCatalogs();
  const anyError = Object.values(catalogData).find(c => c.error && c.colors.length === 0);
  const primaryError = catalogData.marathon?.error || null;

  renderApp(root, { error: primaryError });

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const hexInput          = root.querySelector("#hex");
  const colorPreviewBg    = root.querySelector("#color-preview-bg");
  const colorPreviewWrap  = root.querySelector("#color-preview-wrap");
  const accuracy          = root.querySelector("#accuracy");
  const accVal            = root.querySelector("#acc-val");
  const runBtn            = root.querySelector("#run");
  const tbody             = root.querySelector("#tbody");
  const resultsWrap       = root.querySelector("#results-wrap");
  const sourceLine        = root.querySelector("#source-line");
  const subtitleEl        = root.querySelector("#subtitle");
  const figmaPicker       = root.querySelector("#figma-picker");
  const pickerSq          = root.querySelector("#picker-sq");
  const pickerCursor      = root.querySelector("#picker-cursor");
  const pickerHue         = root.querySelector("#picker-hue");
  const pickerHueThumb    = root.querySelector("#picker-hue-thumb");
  const algoHint          = root.querySelector("#algo-hint");
  const segBtns           = root.querySelectorAll("#seg-toggle .seg-btn");
  const segSlider         = root.querySelector("#seg-slider");
  const catPills          = root.querySelectorAll("#cat-cards .brand-pill");
  const algoTabs          = root.querySelector("#algo-tabs");
  const btnCompare        = root.querySelector("#btn-compare");
  const compareLabel      = root.querySelector("#compare-label");

  // ── Compare state ─────────────────────────────────────────────────────────
  let compareStore = null; // { primary: {algo,rows}, secondary: {algo,rows}, activeTab: 'primary' }

  // ── Picker state ──────────────────────────────────────────────────────────
  let pickerHsv = hexToHsv("#3a5dff");
  let pickerOpen = false;

  function updatePickerUI() {
    if (!pickerSq) return;
    const hue = pickerHsv.h ?? 0;
    const hsl = `hsl(${hue}, 100%, 50%)`;
    pickerSq.style.background = `
      linear-gradient(to bottom, transparent 0%, #000 100%),
      linear-gradient(to right, #fff 0%, ${hsl} 100%)
    `;
    pickerCursor.style.left = `${(pickerHsv.s ?? 0) * 100}%`;
    pickerCursor.style.top  = `${(1 - (pickerHsv.v ?? 1)) * 100}%`;
    pickerCursor.style.background = hsvToHex(hue, pickerHsv.s ?? 0, pickerHsv.v ?? 1);
    pickerHueThumb.style.left       = `${(hue / 360) * 100}%`;
    pickerHueThumb.style.background = `hsl(${hue}, 100%, 50%)`;
  }

  function applyHex(hex) {
    if (!hex) return;
    _currentUserHex = hex;
    if (colorPreviewBg) colorPreviewBg.style.background = hex;
    if (hexInput) hexInput.value = hex.slice(1).toUpperCase();
    pickerHsv = hexToHsv(hex);
    updatePickerUI();
  }

  applyHex("#3a5dff");

  // ── Picker open/close ─────────────────────────────────────────────────────
  function openPicker() {
    if (pickerOpen) return;
    pickerOpen = true;
    figmaPicker.removeAttribute("hidden");
    figmaPicker.removeAttribute("aria-hidden");
    colorPreviewWrap.setAttribute("aria-expanded", "true");
    updatePickerUI();
    gsap.fromTo(figmaPicker,
      { height: 0, opacity: 0, overflow: "hidden" },
      { height: "auto", opacity: 1, duration: 0.32, ease: "power2.out", clearProps: "overflow" }
    );
  }

  function closePicker() {
    if (!pickerOpen) return;
    pickerOpen = false;
    colorPreviewWrap.setAttribute("aria-expanded", "false");
    gsap.to(figmaPicker, {
      height: 0, opacity: 0, duration: 0.22, ease: "power2.in",
      onComplete: () => {
        figmaPicker.setAttribute("hidden", "");
        figmaPicker.setAttribute("aria-hidden", "true");
      }
    });
  }

  colorPreviewWrap?.addEventListener("click", () => pickerOpen ? closePicker() : openPicker());
  colorPreviewWrap?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickerOpen ? closePicker() : openPicker(); }
  });
  document.addEventListener("click", (e) => {
    if (!pickerOpen) return;
    const panel = root.querySelector(".panel");
    if (panel && !panel.contains(e.target)) closePicker();
  });

  // ── HSV Square drag ───────────────────────────────────────────────────────
  let sqDragging = false;
  function onSqMove(e) {
    if (!sqDragging) return;
    const { x, y } = getRelative(e, pickerSq);
    pickerHsv.s = x;
    pickerHsv.v = 1 - y;
    const hex = hsvToHex(pickerHsv.h ?? 0, pickerHsv.s, pickerHsv.v);
    _currentUserHex = hex;
    if (colorPreviewBg) colorPreviewBg.style.background = hex;
    if (hexInput) hexInput.value = hex.slice(1).toUpperCase();
    updatePickerUI();
  }
  pickerSq?.addEventListener("pointerdown", (e) => { sqDragging = true; pickerSq.setPointerCapture(e.pointerId); onSqMove(e); });
  pickerSq?.addEventListener("pointermove", onSqMove);
  pickerSq?.addEventListener("pointerup", () => { sqDragging = false; });
  pickerSq?.addEventListener("pointercancel", () => { sqDragging = false; });

  // ── Hue strip drag ────────────────────────────────────────────────────────
  let hueDragging = false;
  function onHueMove(e) {
    if (!hueDragging) return;
    const { x } = getRelative(e, pickerHue);
    pickerHsv.h = x * 360;
    const hex = hsvToHex(pickerHsv.h, pickerHsv.s ?? 0, pickerHsv.v ?? 1);
    _currentUserHex = hex;
    if (colorPreviewBg) colorPreviewBg.style.background = hex;
    if (hexInput) hexInput.value = hex.slice(1).toUpperCase();
    updatePickerUI();
  }
  pickerHue?.addEventListener("pointerdown", (e) => { hueDragging = true; pickerHue.setPointerCapture(e.pointerId); onHueMove(e); });
  pickerHue?.addEventListener("pointermove", onHueMove);
  pickerHue?.addEventListener("pointerup", () => { hueDragging = false; });
  pickerHue?.addEventListener("pointercancel", () => { hueDragging = false; });

  // ── Hex input sync ────────────────────────────────────────────────────────
  function syncFromHex() {
    const raw = hexInput.value.startsWith("#") ? hexInput.value : `#${hexInput.value}`;
    const h = normalizeHex(raw);
    if (h) {
      hexInput.value = h.slice(1).toUpperCase();
      _currentUserHex = h;
      if (colorPreviewBg) colorPreviewBg.style.background = h;
      pickerHsv = hexToHsv(h);
      updatePickerUI();
    }
  }
  hexInput?.addEventListener("input", () => {
    const raw = `#${hexInput.value}`;
    const h = normalizeHex(raw);
    if (h) {
      _currentUserHex = h;
      if (colorPreviewBg) colorPreviewBg.style.background = h;
      pickerHsv = hexToHsv(h);
      updatePickerUI();
    }
  });
  hexInput?.addEventListener("change", syncFromHex);
  hexInput?.addEventListener("blur",   syncFromHex);

  // ── Accuracy slider ───────────────────────────────────────────────────────
  function updateSliderFill() {
    const min = Number(accuracy.min) || 90;
    const max = Number(accuracy.max) || 100;
    const pct = ((Number(accuracy.value) - min) / (max - min)) * 100;
    accuracy.style.setProperty("--fill", `${pct}%`);
  }
  updateSliderFill(); // set on init
  accuracy?.addEventListener("input", () => {
    accVal.textContent = accuracy.value;
    updateSliderFill();
  });

  // ── Match mode segmented toggle ───────────────────────────────────────────
  let algoActiveIdx = 0;

  function moveAlgoSlider(idx, animate = true) {
    if (!segSlider) return;
    if (animate) gsap.to(segSlider, { xPercent: idx * 100, duration: 0.4, ease: "power2.inOut" });
    else         gsap.set(segSlider, { xPercent: idx * 100 });
  }

  moveAlgoSlider(0, false);

  segBtns.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      if (i === algoActiveIdx) return;
      segBtns[algoActiveIdx].classList.remove("active");
      btn.classList.add("active");
      algoActiveIdx = i;
      moveAlgoSlider(i);
      gsap.fromTo(btn, { scale: 0.97 }, { scale: 1, duration: 0.3, ease: "power2.out" });
      if (algoHint) {
        gsap.to(algoHint, {
          autoAlpha: 0, y: -4, duration: 0.15, ease: "power2.in",
          onComplete: () => {
            algoHint.textContent = HINTS[btn.dataset.algo] || "";
            gsap.to(algoHint, { autoAlpha: 1, y: 0, duration: 0.25, ease: "power2.out" });
          },
        });
      }
    });
  });

  // ── Algo field show/hide (progressive disclosure) ────────────────────────
  function showAlgoField() {
    const field = root.querySelector("#algo-field");
    if (!field) return;
    field.removeAttribute("aria-hidden");
    field.style.pointerEvents = "";
    gsap.fromTo(field,
      { height: 0, opacity: 0, overflow: "hidden" },
      { height: "auto", opacity: 1, duration: 0.3, ease: "power2.out", clearProps: "overflow" }
    );
  }

  function hideAlgoField() {
    const field = root.querySelector("#algo-field");
    if (!field) return;
    field.style.pointerEvents = "none";
    gsap.to(field, {
      height: 0, opacity: 0, overflow: "hidden", duration: 0.22, ease: "power2.in",
      onComplete: () => { field.setAttribute("aria-hidden", "true"); }
    });
  }

  // ── Catalog selector ──────────────────────────────────────────────────────
  function switchCatalog(key) {
    activeCatalog = key;
    const cfg = CATALOGS[key];

    // Subtitle is now generic — no dynamic update needed
    if (false && subtitleEl) {
      subtitleEl.innerHTML = `Find the closest <strong>${escapeHtml(cfg.label)}</strong> threads to your color — works offline.`;
    }

    // Show algo field for Marathon (user has choice), hide for Madeira (no choice needed)
    if (cfg.lockAlgo) {
      hideAlgoField();
    } else {
      // Always reset to catalog default algo (euclidean for Marathon) on catalog switch
      const defaultIdx = Array.from(segBtns).findIndex(b => b.dataset.algo === cfg.defaultAlgo);
      const targetIdx = defaultIdx >= 0 ? defaultIdx : 0;
      if (algoActiveIdx !== targetIdx) {
        segBtns[algoActiveIdx]?.classList.remove("active");
        segBtns[targetIdx]?.classList.add("active");
        algoActiveIdx = targetIdx;
        moveAlgoSlider(targetIdx, false);
      }
      if (algoHint) algoHint.textContent = HINTS[cfg.defaultAlgo] || "";
      showAlgoField();
    }

    // Clear previous results — switching brand means a new search is needed
    if (resultsWrap && !resultsWrap.hidden) {
      gsap.to(resultsWrap, {
        opacity: 0, y: -8, duration: 0.18, ease: "power2.in",
        onComplete: () => {
          resultsWrap.hidden = true;
          tbody.innerHTML = "";
          gsap.set(resultsWrap, { opacity: 1, y: 0 });
        }
      });
    }
  }

  catPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      if (pill.classList.contains("active")) return;
      catPills.forEach(p => {
        p.classList.remove("active");
        p.setAttribute("aria-pressed", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-pressed", "true");
      gsap.fromTo(pill, { scale: 0.94 }, { scale: 1, duration: 0.4, ease: "back.out(1.7)" });
      switchCatalog(pill.dataset.cat);
    });
  });

  // ── Render result cards into tbody ───────────────────────────────────────
  function renderRows(rows, brandLabel, animate = true) {
    const visible = rows.slice(0, INITIAL_SHOW);
    const extra   = rows.slice(INITIAL_SHOW);

    tbody.innerHTML =
      visible.map((r, i) => renderCard(r, i, brandLabel)).join("") +
      (extra.length
        ? `<div class="extra-cards" id="extra-cards" aria-hidden="true">${extra.map((r, i) => renderCard(r, INITIAL_SHOW + i, brandLabel)).join("")}</div>
           <button type="button" class="btn-more" id="btn-more">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
             ${extra.length} More Option${extra.length > 1 ? "s" : ""}
           </button>`
        : "");

    if (animate) {
      gsap.fromTo(root.querySelectorAll(".thread-card"),
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.3, stagger: 0.07, ease: "power2.out" }
      );
    }

    const btnMore    = tbody.querySelector("#btn-more");
    const extraCards = tbody.querySelector("#extra-cards");
    if (btnMore && extraCards) {
      gsap.set(extraCards, { height: 0, opacity: 0, overflow: "hidden" });
      btnMore.addEventListener("click", () => {
        extraCards.removeAttribute("aria-hidden");
        gsap.to(extraCards, { height: "auto", opacity: 1, duration: 0.35, ease: "power2.out", clearProps: "overflow" });
        gsap.to(btnMore, { autoAlpha: 0, y: 6, duration: 0.2, ease: "power2.in", onComplete: () => btnMore.remove() });
      });
    }
  }

  // ── Show/hide compare UI ──────────────────────────────────────────────────
  function resetCompareUI() {
    compareStore = null;
    if (algoTabs) { algoTabs.hidden = true; algoTabs.setAttribute("aria-hidden", "true"); }
    if (btnCompare) { btnCompare.hidden = true; btnCompare.setAttribute("aria-hidden", "true"); }
    root.querySelectorAll(".algo-tab").forEach(t => t.classList.remove("active"));
  }

  function showCompareButton(algo, cfg) {
    if (!btnCompare || cfg.lockAlgo) return;
    const otherLabel = algo === "euclidean" ? "Perceptual" : "Standard";
    if (compareLabel) compareLabel.textContent = `Compare with ${otherLabel}`;
    btnCompare.hidden = false;
    btnCompare.setAttribute("aria-hidden", "false");
    gsap.fromTo(btnCompare,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }
    );
  }

  function activateAlgoTab(tab) {
    if (!compareStore) return;
    const data = compareStore[tab];
    compareStore.activeTab = tab;

    root.querySelectorAll(".algo-tab").forEach(t => t.classList.remove("active"));
    root.querySelector(`#tab-${tab}`)?.classList.add("active");

    gsap.to(tbody, {
      opacity: 0, y: -6, duration: 0.15, ease: "power2.in",
      onComplete: () => {
        renderRows(data.rows, CATALOGS[activeCatalog].label, false);
        gsap.fromTo(tbody,
          { opacity: 0, y: 6 },
          { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }
        );
      }
    });
  }

  // Wire algo-tab clicks
  root.querySelectorAll(".algo-tab").forEach(tab => {
    tab.addEventListener("click", () => activateAlgoTab(tab.dataset.tab));
  });

  // Wire compare button
  btnCompare?.addEventListener("click", () => {
    if (!compareStore) return;
    const cfg     = CATALOGS[activeCatalog];
    const catalog = catalogData[activeCatalog]?.colors || [];
    const otherAlgo = compareStore.primary.algo === "euclidean" ? "ciede2000" : "euclidean";
    const rows = matchColors(parse(_currentUserHex), catalog, accuracy.value, otherAlgo);

    compareStore.secondary = { algo: otherAlgo, rows };
    compareStore.activeTab = "primary";

    // Label the tabs
    const algoNames = { euclidean: "Standard", ciede2000: "Perceptual" };
    const tabPrimary   = root.querySelector("#tab-primary");
    const tabSecondary = root.querySelector("#tab-secondary");
    if (tabPrimary)   tabPrimary.textContent   = algoNames[compareStore.primary.algo];
    if (tabSecondary) tabSecondary.textContent  = algoNames[otherAlgo];

    // Show tabs, hide compare button
    gsap.to(btnCompare, {
      opacity: 0, y: 4, duration: 0.18, ease: "power2.in",
      onComplete: () => { btnCompare.hidden = true; }
    });

    if (algoTabs) {
      algoTabs.hidden = false;
      algoTabs.setAttribute("aria-hidden", "false");
      gsap.fromTo(algoTabs,
        { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }
      );
    }

    // Activate primary tab (already rendered)
    root.querySelector("#tab-primary")?.classList.add("active");
    root.querySelector("#tab-secondary")?.classList.remove("active");
  });

  // ── Run / results ─────────────────────────────────────────────────────────
  runBtn?.addEventListener("click", () => {
    const cfg     = CATALOGS[activeCatalog];
    const catalog = catalogData[activeCatalog]?.colors || [];

    if (!catalog.length) {
      alert(`The ${cfg.label} catalog failed to load. Please refresh.`);
      return;
    }

    syncFromHex();
    const h = normalizeHex(`#${hexInput.value}`);
    if (!h) { alert("Invalid HEX. Use RRGGBB or #RRGGBB."); return; }
    const userParsed = parse(h);
    if (!userParsed) { alert("Could not parse that color."); return; }

    _currentUserHex = h;

    const activeAlgoBtn = root.querySelector("#seg-toggle .seg-btn.active");
    const algo = cfg.lockAlgo
      ? cfg.defaultAlgo
      : (activeAlgoBtn?.dataset.algo ?? "euclidean");

    const rows = matchColors(userParsed, catalog, accuracy.value, algo);

    // Reset compare state on every new search
    resetCompareUI();

    // Reveal animation: input stays anchored at center — only the results
    // panel slides/fades in from the right on desktop. On mobile or when
    // results is already visible, skip the slide-in.
    const isDesktopRow = window.matchMedia("(min-width: 960px)").matches;
    const wasHidden = resultsWrap.hidden;
    resultsWrap.hidden = false;

    if (wasHidden && isDesktopRow) {
      // Slide out from behind the input panel (negative x = starts to the left,
      // behind the input) and glides into its natural position to the right.
      // Input's z-index is higher so the first frames look like it's emerging
      // from behind the panel.
      gsap.fromTo(resultsWrap,
        { opacity: 0, x: -120 },
        { opacity: 1, x: 0, duration: 0.65, ease: "power3.out", clearProps: "transform,opacity" }
      );
    }
    const rgbStr = formatRgb(userParsed);

    if (!rows.length) {
      // No results met the threshold — get the closest alternatives (no floor)
      const fallback = matchColors(userParsed, catalog, 0, algo);

      if (!fallback.length) {
        tbody.innerHTML = `<div class="empty-state">No threads found in this catalog.</div>`;
        return;
      }

      // Render closest cards first (preserves GSAP stagger inside renderRows)
      renderRows(fallback, cfg.label);

      // Then prepend notice above the cards
      tbody.insertAdjacentHTML("afterbegin", `
        <div class="no-match-notice">
          No thread reached <strong>${escapeHtml(accuracy.value)}%</strong> accuracy —
          showing the closest available options.
        </div>
      `);
      return;
    }

    renderRows(rows, cfg.label);

    // Store primary and offer compare (Marathon only)
    if (!cfg.lockAlgo) {
      compareStore = { primary: { algo, rows }, secondary: null, activeTab: "primary" };
      showCompareButton(algo, cfg);
    }

    closePicker();
  });

  // Log meta info for debugging
  Object.entries(catalogData).forEach(([key, { meta, error }]) => {
    if (error) console.warn(`[${key}] catalog load error:`, error);
    else if (Object.keys(meta).length) console.info(`[${key}]`, meta);
  });
}

init();
