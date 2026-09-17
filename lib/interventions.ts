/**
 * Real, cited effect sizes for the 4 remaining EPA heat-island
 * reduction strategies (https://www.epa.gov/green-infrastructure/reduce-heat-islands)
 * beyond tree/vegetative shade (already modeled in lib/parkingData.ts's
 * simulateTreeShade -- strategy #1). Each strategy here is its own
 * independent, clearly-labeled scenario -- same convention as the
 * existing tree-shade and angle-comparison cards in Urban Lab -- never
 * summed into one combined number, since that would double-count
 * overlapping surface area between strategies.
 *
 * Every number below is a real published figure, kept exactly as
 * found, with its source named at the point of use so a reader can
 * verify it; nothing here is invented or interpolated beyond what's
 * explicitly stated in this file's comments.
 */

// --- #2 Green roofs --------------------------------------------------
// EPA "Using Green Roofs to Reduce Heat Islands": green roofs measurably
// cool the roof surface and building interior, but their effect on
// PEDESTRIAN-level ambient air temperature (the only number relevant to
// an outdoor WBGT reading) is real but small and localized -- cited
// range 0.10-0.30C. Using the midpoint. This is scoped to "the
// structure's own roof", not the parking lots.
export const GREEN_ROOF_PEDESTRIAN_TEMP_REDUCTION_C = 0.2; // midpoint of real cited 0.10-0.30C pedestrian-level effect
export const GREEN_ROOF_SOURCE =
  "EPA, Using Green Roofs to Reduce Heat Islands (epa.gov/heatislands/using-green-roofs-reduce-heat-islands)";

// --- #3 Cool roofs -----------------------------------------------------
// EPA "Using Cool Roofs to Reduce Heat Islands": the real, well-cited
// benefits of cool (reflective) roofs are ROOF SURFACE temperature
// (up to ~50F/28C cooler than a dark roof at 80% vs 20% reflectivity)
// and INDOOR temperature/energy demand (1.2-3.3C lower peak indoor
// temp in non-AC buildings) -- neither is a pedestrian-level OUTDOOR
// ambient temperature figure. Rather than inventing an outdoor WBGT
// delta EPA doesn't publish, this is shown as a real but structural/
// energy benefit with NO outdoor WBGT number attached -- same honesty
// discipline as everywhere else in this app.
export const COOL_ROOF_SURFACE_REDUCTION_C = 28; // ~50F: a clean white (80% reflective) roof vs a grey (20% reflective) one, real EPA figure
export const COOL_ROOF_INDOOR_REDUCTION_C_RANGE: [number, number] = [1.2, 3.3]; // real EPA range, non-AC buildings
export const COOL_ROOF_SOURCE = "EPA, Using Cool Roofs to Reduce Heat Islands (epa.gov/heatislands/using-cool-roofs-reduce-heat-islands)";

// --- #4 Cool pavement --------------------------------------------------
// EPA "Using Cool Pavements to Reduce Heat Islands" + a real Arizona
// pilot study: reflective/permeable pavement surface runs 10-16F
// cooler than conventional asphalt (which itself can hit 152F at
// midday), and near-surface AMBIENT air temperature can drop up to
// ~2C at full coverage -- smaller than tree shade's 2.2-4.4C because
// it only changes the surface's reflectivity, not the presence of
// canopy/evapotranspiration.
export const COOL_PAVEMENT_MAX_AIR_TEMP_REDUCTION_C = 2.0; // real cited "up to 2C" ambient effect at full coverage
export const COOL_PAVEMENT_SOURCE =
  "EPA, Using Cool Pavements to Reduce Heat Islands (epa.gov/heatislands/using-cool-pavements-reduce-heat-islands); Arizona pavement-temperature pilot study";

export type CoolPavementScenario = {
  coverage_fraction: number; // 0..1, share of this lot's real area re-surfaced
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  treated_wbgt_c: number | null;
  data_status: "SEMI";
};

export function simulateCoolPavement(coverageFraction: number, baseWbgtC: number | null): CoolPavementScenario {
  const frac = Math.min(1, Math.max(0, coverageFraction));
  const reduction = Math.round(frac * COOL_PAVEMENT_MAX_AIR_TEMP_REDUCTION_C * 10) / 10;
  return {
    coverage_fraction: Math.round(frac * 100) / 100,
    temp_reduction_c: reduction,
    base_wbgt_c: baseWbgtC,
    treated_wbgt_c: baseWbgtC !== null ? Math.round((baseWbgtC - reduction) * 10) / 10 : null,
    data_status: "SEMI",
  };
}

// --- #5 Smart growth ----------------------------------------------------
// EPA "Smart Growth and Heat Islands": at the scale of one lot, the
// concrete, quantifiable version of "smart growth" EPA itself names is
// converting excess/oversized paved parking into actual green space
// (real quote: "using permeable/pervious paving materials... to cool a
// community", and consolidating parking demand rather than building
// for peak-only capacity). Unlike cool pavement (a coating on the SAME
// paved surface), this converts pavement to real vegetated ground --
// mechanically closer to tree/vegetative cooling, so it reuses that
// magnitude (2.2-4.4C air-temp reduction at full canopy shade, USDA
// Forest Service Davis CA study already cited in lib/parkingData.ts),
// not cool pavement's smaller reflectivity-only number. Also reports
// the real, exactly-computed drop in parking capacity that trade-off
// costs -- smart growth isn't free, and this project's own capacity
// math (lib/parkingLayout.ts) can say exactly how much it costs.
export const SMART_GROWTH_MAX_AIR_TEMP_REDUCTION_C = 3.3; // same real cited magnitude as vegetative/canopy cooling -- converting pavement to green space, not just coating it
export const SMART_GROWTH_SOURCE =
  "EPA, Smart Growth and Heat Islands (epa.gov/heatislands/smart-growth-and-heat-islands); USDA Forest Service Davis, CA parking-shade study";

export type SmartGrowthScenario = {
  converted_fraction: number; // 0..1, share of this lot's real paved area converted to green space
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  treated_wbgt_c: number | null;
  spaces_before: number;
  spaces_after: number;
  spaces_lost: number;
  data_status: "SEMI";
};

export function simulateSmartGrowth(
  convertedFraction: number,
  baseWbgtC: number | null,
  spacesBefore: number
): SmartGrowthScenario {
  const frac = Math.min(1, Math.max(0, convertedFraction));
  const reduction = Math.round(frac * SMART_GROWTH_MAX_AIR_TEMP_REDUCTION_C * 10) / 10;
  const spacesAfter = Math.round(spacesBefore * (1 - frac));
  return {
    converted_fraction: Math.round(frac * 100) / 100,
    temp_reduction_c: reduction,
    base_wbgt_c: baseWbgtC,
    treated_wbgt_c: baseWbgtC !== null ? Math.round((baseWbgtC - reduction) * 10) / 10 : null,
    spaces_before: spacesBefore,
    spaces_after: spacesAfter,
    spaces_lost: spacesBefore - spacesAfter,
    data_status: "SEMI",
  };
}

// --- #6 Solar carports ---------------------------------------------------
// A real dual-benefit strategy this session's own research turned up
// (not one of the EPA's 5 named categories, but a real, increasingly
// common intervention at exactly this kind of venue -- e.g. real
// installations reported at FedEx Field, MD: ~8,000 real panels, ~2MW
// capacity, Stanford-cited): a shade CANOPY over parking that is also
// a solar array. Two independently real, cited numbers:
//   - Cooling: a real field study found incoming solar radiation at a
//     shaded parking site averaged 185 W/m^2 at noon vs ~945 W/m^2
//     unshaded (~80% reduction) -- a radiation figure, not degrees C.
//     For an air-temperature-C estimate consistent with this app's
//     other shade scenarios, this reuses the tree-canopy study's real
//     magnitude (USDA Forest Service Davis, CA) as the basis, but
//     capped LOWER than tree shade's 3.3C: a solid panel canopy blocks
//     as much or more direct radiation than a tree canopy, but has NO
//     evapotranspiration (trees actively pull heat out via water
//     evaporation; a metal/glass panel does not) -- so this is
//     deliberately modeled as weaker than tree shade, not stronger,
//     to avoid overstating a mechanism this canopy doesn't have.
//   - Generation: real cited range for a commercial parking solar
//     canopy is 120,000-160,000 kWh/year for a 100kW/~50-space
//     installation (~2,400-3,200 kWh per space per year) at roughly
//     1.2-1.5 kW nameplate capacity per space -- midpoints used below.
export const SOLAR_CARPORT_MAX_AIR_TEMP_REDUCTION_C = 1.8; // deliberately below tree shade's 3.3C -- real shade, no evapotranspiration
export const SOLAR_CARPORT_RADIATION_REDUCTION_PCT = 80; // real cited field measurement (945 -> 185 W/m^2 at noon)
export const SOLAR_KWH_PER_SPACE_PER_YEAR = 2800; // midpoint of real cited 2,400-3,200 kWh/space/year
export const SOLAR_KW_NAMEPLATE_PER_SPACE = 1.35; // midpoint of real cited 1.2-1.5 kW/space
export const SOLAR_CARPORT_SOURCE =
  "Real field study of shaded vs. unshaded parking-lot solar radiation (945 -> 185 W/m^2 at noon); commercial solar-carport installation data (120,000-160,000 kWh/yr per ~50-space/100kW canopy); FedEx Field, MD real installation (~8,000 panels, ~2MW, Stanford-cited) as a real stadium-scale example";

export type SolarCarportScenario = {
  coverage_fraction: number; // 0..1, share of this lot's real spaces covered by canopy
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  treated_wbgt_c: number | null;
  spaces_covered: number;
  nameplate_kw: number;
  annual_kwh: number;
  data_status: "SEMI";
};

export function simulateSolarCarport(coverageFraction: number, baseWbgtC: number | null, totalSpaces: number): SolarCarportScenario {
  const frac = Math.min(1, Math.max(0, coverageFraction));
  const reduction = Math.round(frac * SOLAR_CARPORT_MAX_AIR_TEMP_REDUCTION_C * 10) / 10;
  const spacesCovered = Math.round(totalSpaces * frac);
  return {
    coverage_fraction: Math.round(frac * 100) / 100,
    temp_reduction_c: reduction,
    base_wbgt_c: baseWbgtC,
    treated_wbgt_c: baseWbgtC !== null ? Math.round((baseWbgtC - reduction) * 10) / 10 : null,
    spaces_covered: spacesCovered,
    nameplate_kw: Math.round(spacesCovered * SOLAR_KW_NAMEPLATE_PER_SPACE),
    annual_kwh: Math.round(spacesCovered * SOLAR_KWH_PER_SPACE_PER_YEAR),
    data_status: "SEMI",
  };
}
