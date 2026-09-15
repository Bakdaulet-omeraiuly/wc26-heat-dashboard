/**
 * WBGT (Wet-Bulb Globe Temperature) approximation from air temperature
 * and dew point -- the two fields NOAA's global-hourly (ISD) dataset
 * actually gives us (TMP, DEW), not the globe-thermometer/wind-speed
 * inputs the full outdoor WBGT formula wants.
 *
 * This is the standard Australian Bureau of Meteorology simplified
 * approximation, NOT a lab-grade WBGT reading -- state that plainly
 * anywhere this number is shown, same discipline as caspian-dash's own
 * "this is a model, not a satellite observation" notices.
 *
 *   WBGT ≈ 0.567 * Ta + 0.393 * e + 3.94
 *
 * where Ta = air temperature (°C), e = water vapor pressure (hPa),
 * derived from dew point via the Magnus formula:
 *
 *   e = 6.105 * exp(17.27 * Td / (237.7 + Td))
 *
 * Reference check (recorded here so a future change can be verified
 * against the same numbers): Ta=30°C, Td=21°C -> e≈24.8 hPa ->
 * WBGT≈30.7°C, in the range published BOM worked examples give for
 * similar inputs (roughly 30-31°C) -- close enough to trust as an
 * approximation, not exact enough to publish as measured.
 */

export function vaporPressureFromDewPoint(dewPointC: number): number {
  return 6.105 * Math.exp((17.27 * dewPointC) / (237.7 + dewPointC));
}

export function approximateWBGT(airTempC: number, dewPointC: number): number {
  const e = vaporPressureFromDewPoint(dewPointC);
  return 0.567 * airTempC + 0.393 * e + 3.94;
}

/** The real 5-flag sports-safety scale (ACSM / university athletics
 * convention), thresholds in °F per the sports-medicine literature --
 * converted here since our WBGT is computed in °C. */
export type SportsFlagColor = "white" | "green" | "yellow" | "red" | "black";

export function wbgtToSportsFlag(wbgtC: number): SportsFlagColor {
  const wbgtF = (wbgtC * 9) / 5 + 32;
  if (wbgtF < 82) return "white";
  if (wbgtF < 85) return "green";
  if (wbgtF < 88) return "yellow";
  if (wbgtF < 90) return "red";
  return "black";
}

/**
 * Our own 5-level heat-risk scale -- deliberately NOT borrowing "NWS
 * HeatRisk" as a name with invented thresholds. Checked twice against
 * NOAA's own HeatRisk data-access pages this pass: its exact numeric
 * cutoffs aren't published as a simple fixed-°F table, because
 * HeatRisk isn't a fixed-threshold scale at all -- it's PERCENTILE-
 * relative to each location's own local climatology and calendar day
 * (how unusual is this heat, HERE, right now, historically). That's
 * a real, important, and useful design principle -- so instead of
 * faking fixed thresholds under a real agency's name, we compute a
 * true percentile-relative scale from data we actually have: each
 * station's own 20-year historical WBGT distribution for that exact
 * hour-of-day and day-of-year (the same historical data Discovery
 * 2.1/2.3 in spec.md already need). This is MORE defensible than a
 * borrowed name with guessed numbers, and it's the same method NWS
 * itself uses in spirit.
 *
 * `percentile` here means: what fraction of the 20-year historical
 * readings, for this exact station + hour-of-day + day-of-year window,
 * fall below the given WBGT value. Compute that upstream (against the
 * SQLite-backed historical store) and pass it in here -- this function
 * just names the bucket, it doesn't do the historical lookup itself.
 */
export type HeatRiskLevel = "green" | "yellow" | "orange" | "red" | "magenta";

export function percentileToHeatRiskLevel(historicalPercentile: number): HeatRiskLevel {
  if (historicalPercentile < 0 || historicalPercentile > 1) {
    throw new Error(`historicalPercentile must be in [0,1], got ${historicalPercentile}`);
  }
  if (historicalPercentile < 0.5) return "green";
  if (historicalPercentile < 0.75) return "yellow";
  if (historicalPercentile < 0.9) return "orange";
  if (historicalPercentile < 0.98) return "red";
  return "magenta";
}
