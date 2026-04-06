#!/usr/bin/env node
/**
 * Calibration test: runs test colors against the Marathon Poly catalog
 * using all three distance algorithms and reports rankings.
 *
 * Usage:
 *   node scripts/test_calibration.mjs
 *   node scripts/test_calibration.mjs --hex "#af4b4b"
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, "../web/package.json"));
const { differenceCiede2000, differenceCie76, parse } = require("culori");

const CATALOG_PATH = resolve(__dirname, "../web/public/data/marathon_poly.json");

// Same Euclidean RGB function as in main.js
function euclideanRgb255(std, smp) {
  const dr = (std.r - smp.r) * 255;
  const dg = (std.g - smp.g) * 255;
  const db = (std.b - smp.b) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const ALGORITHMS = {
  ciede2000: { label: "CIEDE2000", fn: differenceCiede2000(), scale: 1.0848 },
  cie76: { label: "Delta E 1976", fn: differenceCie76(), scale: 1.0 },
  euclidean: { label: "Euclidean RGB", fn: euclideanRgb255, scale: 0.23 },
};

// Test cases from user screenshots + the reported problem
const TEST_CASES = [
  { hex: "#642b58", label: "Aubergine test (reference: 2024 Aubergine @ 0.0)" },
  { hex: "#af4b4b", label: "Red/rose test (reference: 2180 Dusty Rose top)" },
  { hex: "#8788dd", label: "Blue/purple test (reference: 2197 Light Blue top)" },
  { hex: "#739c67", label: "Green test (reference: 2112 Leaf Green top)" },
  { hex: "#fbb7f4", label: "Pink test (reference: 2033 Light Pink top)" },
];

function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, "utf-8");
  const data = JSON.parse(raw);
  return data.colors || data;
}

function runTest(userHex, colors, topN = 10) {
  const userParsed = parse(userHex);
  if (!userParsed) {
    console.error(`  Could not parse: ${userHex}`);
    return;
  }

  for (const [algoKey, algo] of Object.entries(ALGORITHMS)) {
    const distFn = algo.fn;
    const results = [];

    for (const c of colors) {
      const thread = parse(c.hex || `rgb(${c.r}, ${c.g}, ${c.b})`);
      if (!thread) continue;
      const dist = distFn(userParsed, thread);
      const pct = Math.round((100 - Math.min(100, dist * algo.scale)) * 100) / 100;
      results.push({
        code: c.code,
        name: c.name || "—",
        hex: c.hex,
        distance: Math.round(dist * 10000) / 10000,
        matchPct: pct,
      });
    }

    results.sort((a, b) => a.distance - b.distance);

    console.log(`\n  ${algo.label} (scale: ${algo.scale}):`);
    console.log("  " + "-".repeat(80));
    console.log(
      "  " +
        "Rank".padEnd(6) +
        "Code".padEnd(8) +
        "Name".padEnd(20) +
        "HEX".padEnd(12) +
        "Distance".padEnd(12) +
        "Match%"
    );

    for (let i = 0; i < Math.min(topN, results.length); i++) {
      const r = results[i];
      const marker = r.code === "2024" ? " <-- 2024" : "";
      console.log(
        "  " +
          `#${i + 1}`.padEnd(6) +
          r.code.padEnd(8) +
          r.name.slice(0, 18).padEnd(20) +
          r.hex.padEnd(12) +
          String(r.distance).padEnd(12) +
          `${r.matchPct}%${marker}`
      );
    }

    // Find 2024 if not in top N
    const idx2024 = results.findIndex((r) => r.code === "2024");
    if (idx2024 >= topN) {
      const r = results[idx2024];
      console.log("  ...");
      console.log(
        "  " +
          `#${idx2024 + 1}`.padEnd(6) +
          r.code.padEnd(8) +
          r.name.slice(0, 18).padEnd(20) +
          r.hex.padEnd(12) +
          String(r.distance).padEnd(12) +
          `${r.matchPct}% <-- 2024`
      );
    }
  }
}

function calibrateScaleFactors(colors) {
  console.log("\n" + "=".repeat(80));
  console.log("SCALE FACTOR CALIBRATION (from site_similarity_samples)");
  console.log("=".repeat(80));

  for (const [algoKey, algo] of Object.entries(ALGORITHMS)) {
    const distFn = algo.fn;
    let sumXY = 0,
      sumXX = 0,
      count = 0;

    for (const c of colors) {
      const samples = c.site_similarity_samples;
      if (!Array.isArray(samples)) continue;

      const thread = parse(c.hex || `rgb(${c.r}, ${c.g}, ${c.b})`);
      if (!thread) continue;

      for (const s of samples) {
        if (s.similarity == null) continue;
        const similarity = Number(s.similarity);
        if (Number.isNaN(similarity)) continue;

        const searchedParsed = parse(s.searched_rgb);
        if (!searchedParsed) continue;

        const dist = distFn(searchedParsed, thread);
        // Model: similarity = 100 - k * dist → k = (100 - similarity) / dist
        if (dist > 0.01) {
          const residual = 100 - similarity;
          sumXY += dist * residual;
          sumXX += dist * dist;
          count++;
        }
      }
    }

    if (count > 0 && sumXX > 0) {
      const kFit = sumXY / sumXX;
      console.log(
        `\n  ${algo.label}: k = ${kFit.toFixed(4)} (from ${count} samples, current: ${algo.scale})`
      );
    } else {
      console.log(`\n  ${algo.label}: insufficient data for calibration`);
    }
  }
}

// Main
const args = process.argv.slice(2);
let customHex = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--hex" && args[i + 1]) {
    customHex = args[i + 1];
  }
}

const colors = loadCatalog();
console.log(`Loaded ${colors.length} Marathon Poly thread colors.\n`);

const cases = customHex
  ? [{ hex: customHex, label: `Custom: ${customHex}` }]
  : TEST_CASES;

for (const tc of cases) {
  console.log("\n" + "=".repeat(80));
  console.log(`TEST: ${tc.hex} — ${tc.label}`);
  console.log("=".repeat(80));
  runTest(tc.hex, colors);
}

// Run scale factor calibration
calibrateScaleFactors(colors);
