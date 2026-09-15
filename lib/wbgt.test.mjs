// Plain node test (no test framework needed yet) -- run with:
//   node --experimental-strip-types lib/wbgt.test.mjs
// Verifies the WBGT approximation against the reference check recorded
// in wbgt.ts's docstring, and sanity-checks the flag/percentile mappings.

import { approximateWBGT, vaporPressureFromDewPoint, wbgtToSportsFlag, percentileToHeatRiskLevel } from "./wbgt.ts";

function assertClose(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    console.error(`FAIL: ${label} -- got ${actual}, expected ~${expected} (tolerance ${tolerance})`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${label} -- ${actual.toFixed(2)} (expected ~${expected}, within ${tolerance})`);
  }
}

// Reference check: Ta=30C, Td=21C -> e~24.8 hPa -> WBGT~30.7C
const e = vaporPressureFromDewPoint(21);
assertClose(e, 24.8, 0.5, "vapor pressure at Td=21C");

const wbgt1 = approximateWBGT(30, 21);
assertClose(wbgt1, 30.7, 0.5, "WBGT at Ta=30C/Td=21C (BOM reference-range check)");

// A hot, humid Houston-in-July-like scenario: Ta=35C, Td=25C
const wbgt2 = approximateWBGT(35, 25);
console.log(`Houston-like hot/humid scenario (Ta=35C, Td=25C): WBGT=${wbgt2.toFixed(2)}C`);
if (wbgt2 <= wbgt1) {
  console.error("FAIL: hotter/more humid scenario should give a HIGHER WBGT than the reference case");
  process.exitCode = 1;
} else {
  console.log("OK: hot/humid scenario correctly ranks higher than the reference case");
}

// Sports flag monotonicity: flag severity should only increase with WBGT
const flags = [10, 27.5, 29, 30.5, 33].map((c) => wbgtToSportsFlag(c));
console.log("Sports flags across a range:", flags);
const order = ["white", "green", "yellow", "red", "black"];
const indices = flags.map((f) => order.indexOf(f));
const isMonotonic = indices.every((v, i) => i === 0 || v >= indices[i - 1]);
if (!isMonotonic) {
  console.error("FAIL: sports flags are not monotonically increasing with WBGT:", flags);
  process.exitCode = 1;
} else {
  console.log("OK: sports flags increase monotonically with WBGT");
}

// Percentile scale sanity + bounds check
try {
  percentileToHeatRiskLevel(1.5);
  console.error("FAIL: percentileToHeatRiskLevel should reject out-of-range input");
  process.exitCode = 1;
} catch {
  console.log("OK: percentileToHeatRiskLevel rejects out-of-range input");
}
console.log("percentile 0.3 ->", percentileToHeatRiskLevel(0.3));
console.log("percentile 0.99 ->", percentileToHeatRiskLevel(0.99));

if (process.exitCode === 1) {
  console.error("\nSOME CHECKS FAILED");
} else {
  console.log("\nALL CHECKS PASSED");
}
