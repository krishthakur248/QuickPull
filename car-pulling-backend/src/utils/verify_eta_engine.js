/**
 * verify_eta_engine.js
 * Runs the 10 golden test cases through the Node.js ETA engine and
 * compares them against the Python booster reference predictions.
 *
 * Usage:
 *   node car-pulling-backend/src/utils/verify_eta_engine.js
 *
 * Exit code 0 = all cases pass.  Exit code 1 = at least one case failed.
 */

'use strict';

const path = require('path');

// ── Temporarily set MIN_MODEL_ROUTE_SECONDS very low so golden cases
//    (which have duration >= 137 s) are not blocked by the short-route guard
process.env.MIN_MODEL_ROUTE_SECONDS = '0';

const { predictEta } = require('./etaEngine');

const GOLDEN_PATH = path.join(__dirname, '..', '..', '..', 'Model', 'LightGBM', 'golden_test_cases.json');
const PY_REF_PATH = path.join(__dirname, '..', '..', '..', 'Model', 'py_golden_preds.json');

const golden = require(GOLDEN_PATH);
const pyRef  = require(PY_REF_PATH);

const MAX_ALLOWED_DIFF = 1e-4; // 0.0001 seconds — purely floating-point rounding

console.log('\n── ETA Engine verification (JS vs Python booster) ──────────────────────');
console.log(
  `${'#'.padEnd(3)}  ${'Expected (s)'.padStart(14)}  ${'Python (s)'.padStart(14)}  ${'JS (s)'.padStart(14)}  ${'JS-Py diff'.padStart(12)}  ${'Source'.padEnd(14)}  Result`
);
console.log('─'.repeat(100));

let passed = 0;
let failed = 0;

for (let i = 0; i < golden.length; i++) {
  const tc    = golden[i];
  const ref   = pyRef[i];
  const input = tc.input;

  const jsResult = predictEta({
    pickup_lat     : input.pickup_lat,
    pickup_lon     : input.pickup_lon,
    dropoff_lat    : input.dropoff_lat,
    dropoff_lon    : input.dropoff_lon,
    osrm_duration_s: input.osrm_duration_s,
    osrm_distance_m: input.osrm_distance_m
  });

  const expected = tc.expected_eta_seconds;
  const pyEta    = ref.py_eta_seconds;
  const jsEta    = jsResult.eta_seconds;
  const diff     = Math.abs(jsEta - pyEta);
  const ok       = diff <= MAX_ALLOWED_DIFF && jsResult.source === tc.expected_source;

  if (ok) passed++; else failed++;

  console.log(
    `${String(i + 1).padEnd(3)}  ${expected.toFixed(6).padStart(14)}  `
    + `${pyEta.toFixed(6).padStart(14)}  ${jsEta.toFixed(6).padStart(14)}  `
    + `${diff.toExponential(2).padStart(12)}  ${jsResult.source.padEnd(14)}  `
    + (ok ? '✅ PASS' : `❌ FAIL (diff=${diff})`)
  );
}

console.log('─'.repeat(100));
console.log(`\nResult: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\n❌ ETA engine does NOT match Python booster — do not deploy!');
  process.exit(1);
} else {
  console.log('\n✅ All golden cases pass. JS engine matches Python booster exactly.');
  process.exit(0);
}
