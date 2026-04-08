/**
 * Offline app: closest Marathon Poly thread colors (HEX/picker) via CIEDE2000 ΔE.
 * Slider sets minimum match score (derived from ΔE), same idea as "no matches below X%".
 */
import { differenceCiede2000, differenceCie76, formatRgb, formatHex, parse, converter } from "culori";
import gsap from "gsap";
import "./style.css";

const BRAND_LABEL = "Marathon Poly";
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

async function loadCatalog() {
  const res = await fetch("/data/marathon_poly.json");
  if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
  const data = await res.json();
  const colors = Array.isArray(data) ? data : data.colors;
  if (!colors || !colors.length) throw new Error("Catalog is empty or invalid.");
  const meta = data._meta || {};
  return { colors, meta };
}

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

function renderCard(r, i) {
  const RANKS = ["#1", "#2", "#3", "#4", "#5"];
  return `
    <div class="thread-card">
      <div class="card-swatch" style="background:${r.hex}">
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
          <span>${escapeHtml(BRAND_LABEL)}</span>
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

// Track current user color for card rendering
let _currentUserHex = "#3a5dff";

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
        <h1>Color <em>Embroidery</em></h1>
        <p class="subtitle">Find the closest <strong>${BRAND_LABEL}</strong> threads to your color — works offline.</p>
      </header>

      ${
        error
          ? `<div class="banner error"><span class="banner-dot"></span>${escapeHtml(error)}</div>`
          : `<div class="banner ok"><span class="banner-dot"></span>Catalog loaded · ready</div>`
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
            <!-- HSV gradient square -->
            <div class="picker-sq" id="picker-sq" role="slider" aria-label="Color saturation and brightness">
              <div class="picker-cursor" id="picker-cursor"></div>
            </div>
            <!-- Hue strip -->
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

        <!-- Accuracy slider -->
        <div class="field">
          <div class="field-row">
            <span class="field-label">Minimum match</span>
            <span class="acc-badge"><span id="acc-val">90</span>%</span>
          </div>
          <input type="range" id="accuracy" min="90" max="100" step="1" value="90" />
          <span class="hint">Lower this if you get no results. Lower values include more distant matches.</span>
        </div>

        <!-- Match mode toggle -->
        <div class="field">
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </section>

      <section class="panel" id="results-wrap" hidden>
        <div class="results-header">
          <h2>Results</h2>
        </div>
        <p class="source-line" id="source-line"></p>
        <div class="thread-cards" id="tbody"></div>
      </section>

    </div>
  `;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** Clamp value between 0 and 1 */
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** Get pointer position relative to element, clamped 0-1 */
function getRelative(event, el) {
  const rect = el.getBoundingClientRect();
  const cx = event.touches?.[0]?.clientX ?? event.clientX;
  const cy = event.touches?.[0]?.clientY ?? event.clientY;
  return {
    x: clamp01((cx - rect.left) / rect.width),
    y: clamp01((cy - rect.top) / rect.height),
  };
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

  const hexInput = root.querySelector("#hex");
  const colorPreviewBg = root.querySelector("#color-preview-bg");
  const colorPreviewWrap = root.querySelector("#color-preview-wrap");
  const accuracy = root.querySelector("#accuracy");
  const accVal = root.querySelector("#acc-val");
  const runBtn = root.querySelector("#run");
  const tbody = root.querySelector("#tbody");
  const resultsWrap = root.querySelector("#results-wrap");
  const sourceLine = root.querySelector("#source-line");
  const figmaPicker = root.querySelector("#figma-picker");
  const pickerSq = root.querySelector("#picker-sq");
  const pickerCursor = root.querySelector("#picker-cursor");
  const pickerHue = root.querySelector("#picker-hue");
  const pickerHueThumb = root.querySelector("#picker-hue-thumb");

  /* ── Picker state ───────────────────────────────────── */
  let pickerHsv = hexToHsv("#3a5dff");
  let pickerOpen = false;

  function updatePickerUI() {
    if (!pickerSq) return;
    const hue = pickerHsv.h ?? 0;
    const hsl = `hsl(${hue}, 100%, 50%)`;

    // Square: white-to-hue horizontally, then overlay black-to-transparent vertically
    pickerSq.style.background = `
      linear-gradient(to bottom, transparent 0%, #000 100%),
      linear-gradient(to right, #fff 0%, ${hsl} 100%)
    `;

    // Cursor position
    pickerCursor.style.left = `${(pickerHsv.s ?? 0) * 100}%`;
    pickerCursor.style.top = `${(1 - (pickerHsv.v ?? 1)) * 100}%`;
    pickerCursor.style.background = hsvToHex(hue, pickerHsv.s ?? 0, pickerHsv.v ?? 1);

    // Hue thumb position + color
    pickerHueThumb.style.left = `${(hue / 360) * 100}%`;
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

  // Initialize
  applyHex("#3a5dff");

  /* ── Picker open/close ──────────────────────────────── */
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
      height: 0,
      opacity: 0,
      duration: 0.22,
      ease: "power2.in",
      onComplete: () => {
        figmaPicker.setAttribute("hidden", "");
        figmaPicker.setAttribute("aria-hidden", "true");
      }
    });
  }

  colorPreviewWrap?.addEventListener("click", () => {
    pickerOpen ? closePicker() : openPicker();
  });

  colorPreviewWrap?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickerOpen ? closePicker() : openPicker();
    }
  });

  // Close picker on outside click
  document.addEventListener("click", (e) => {
    if (!pickerOpen) return;
    const panel = root.querySelector(".panel");
    if (panel && !panel.contains(e.target)) closePicker();
  });

  /* ── HSV Square drag ────────────────────────────────── */
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

  pickerSq?.addEventListener("pointerdown", (e) => {
    sqDragging = true;
    pickerSq.setPointerCapture(e.pointerId);
    onSqMove(e);
  });
  pickerSq?.addEventListener("pointermove", onSqMove);
  pickerSq?.addEventListener("pointerup", () => { sqDragging = false; });
  pickerSq?.addEventListener("pointercancel", () => { sqDragging = false; });

  /* ── Hue strip drag ─────────────────────────────────── */
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

  pickerHue?.addEventListener("pointerdown", (e) => {
    hueDragging = true;
    pickerHue.setPointerCapture(e.pointerId);
    onHueMove(e);
  });
  pickerHue?.addEventListener("pointermove", onHueMove);
  pickerHue?.addEventListener("pointerup", () => { hueDragging = false; });
  pickerHue?.addEventListener("pointercancel", () => { hueDragging = false; });

  /* ── Hex input sync ─────────────────────────────────── */
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
  hexInput?.addEventListener("blur", syncFromHex);

  /* ── Accuracy slider ────────────────────────────────── */
  if (accuracy && accVal) {
    accuracy.addEventListener("input", () => {
      accVal.textContent = accuracy.value;
    });
  }

  /* ── Segmented toggle (GSAP) ────────────────────────── */
  const segBtns = root.querySelectorAll(".seg-btn");
  const segSlider = root.querySelector("#seg-slider");
  const algoHint = root.querySelector("#algo-hint");
  const HINTS = {
    euclidean: "Matches the reference site results.",
    ciede2000: "Uses human color perception (advanced).",
  };

  let activeIdx = 0;

  function moveSlider(idx, animate = true) {
    if (!segSlider) return;
    if (animate) {
      gsap.to(segSlider, { xPercent: idx * 100, duration: 0.4, ease: "power2.inOut" });
    } else {
      gsap.set(segSlider, { xPercent: idx * 100 });
    }
  }

  moveSlider(activeIdx, false);

  segBtns.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      if (i === activeIdx) return;
      const prevBtn = segBtns[activeIdx];
      activeIdx = i;
      prevBtn.classList.remove("active");
      btn.classList.add("active");
      moveSlider(i);
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

  /* ── Run / results ──────────────────────────────────── */
  runBtn?.addEventListener("click", () => {
    if (!catalog.length) return;
    syncFromHex();
    const h = normalizeHex(`#${hexInput.value}`);
    if (!h) { alert("Invalid HEX. Use RRGGBB or #RRGGBB."); return; }
    const userParsed = parse(h);
    if (!userParsed) { alert("Could not parse that color."); return; }

    _currentUserHex = h;
    const activeBtn = root.querySelector(".seg-btn.active");
    const algo = activeBtn ? activeBtn.dataset.algo : "euclidean";
    const rows = matchColors(userParsed, catalog, accuracy.value, algo);

    resultsWrap.hidden = false;
    const rgbStr = formatRgb(userParsed);
    sourceLine.innerHTML = `Converted from: <strong>Color Picker</strong> · Color Code: <strong>N/A</strong> · RGB: <strong>${rgbStr}</strong>`;

    if (!rows.length) {
      tbody.innerHTML = `<div class="empty-state">No thread at least <strong>${escapeHtml(accuracy.value)}%</strong> match. Lower the minimum match slider to include more distant suggestions.</div>`;
      return;
    }

    const visible = rows.slice(0, INITIAL_SHOW);
    const extra = rows.slice(INITIAL_SHOW);

    tbody.innerHTML =
      visible.map((r, i) => renderCard(r, i)).join("") +
      (extra.length
        ? `<div class="extra-cards" id="extra-cards" aria-hidden="true">${extra.map((r, i) => renderCard(r, INITIAL_SHOW + i)).join("")}</div>
           <button type="button" class="btn-more" id="btn-more">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
             ${extra.length} More Option${extra.length > 1 ? "s" : ""}
           </button>`
        : "");

    // Wire up "More Options" reveal
    const btnMore = tbody.querySelector("#btn-more");
    const extraCards = tbody.querySelector("#extra-cards");
    if (btnMore && extraCards) {
      gsap.set(extraCards, { height: 0, opacity: 0, overflow: "hidden" });
      btnMore.addEventListener("click", () => {
        extraCards.removeAttribute("aria-hidden");
        gsap.to(extraCards, { height: "auto", opacity: 1, duration: 0.35, ease: "power2.out", clearProps: "overflow" });
        gsap.to(btnMore, {
          autoAlpha: 0, y: 6, duration: 0.2, ease: "power2.in",
          onComplete: () => btnMore.remove()
        });
      });
    }

    // Close picker on run
    closePicker();
  });

  if (meta && Object.keys(meta).length) {
    const { count: _omit, ...rest } = meta;
    if (Object.keys(rest).length) console.info("[marathon-poly-matcher]", rest);
  }
}

init();
