// Solar altitude (elevation angle above horizon, degrees) for a given geographic
// position and UTC instant. Uses a low-precision algorithm (~0.5° error) that is
// more than sufficient for a weather-app display.
//
// Algorithm: Jean Meeus "Astronomical Algorithms" ch. 25 (low-precision solar position)
//   L  — mean longitude
//   g  — mean anomaly
//   λ  — ecliptic longitude (with equation-of-centre correction)
//   ε  — obliquity of the ecliptic
//   δ  — declination
//   HA — local hour angle
//   alt = arcsin( sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(HA) )

const DEG = Math.PI / 180;

export function solarAltitudeDeg(latDeg: number, lonDeg: number, utcMs: number): number {
  const jd = utcMs / 86400000 + 2440587.5;   // Julian day
  const n  = jd - 2451545.0;                  // days since J2000.0

  const L  = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g  = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
  const gR = g * DEG;
  const λ  = (L + 1.915 * Math.sin(gR) + 0.020 * Math.sin(2 * gR)) * DEG;
  const ε  = (23.439 - 0.0000004 * n) * DEG;

  const δ  = Math.asin(Math.sin(ε) * Math.sin(λ));                           // declination
  const αH = ((Math.atan2(Math.cos(ε) * Math.sin(λ), Math.cos(λ)) / DEG / 15) % 24 + 24) % 24; // RA (hours)

  const utH  = (utcMs % 86400000) / 3600000;
  const GMST = ((6.697375 + 0.0657098242 * n + utH) % 24 + 24) % 24;        // Greenwich sidereal time
  const LST  = ((GMST + lonDeg / 15) % 24 + 24) % 24;                        // local sidereal time
  const HA   = (LST - αH) * 15 * DEG;                                         // hour angle (radians)

  const latR  = latDeg * DEG;
  const sinAlt = Math.sin(latR) * Math.sin(δ) + Math.cos(latR) * Math.cos(δ) * Math.cos(HA);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
}

// Compute solar altitude for an n-hour window at the given step resolution.
// firstSlotUtcMs is the UTC timestamp of the first sample (midnight of day 0).
export function solarAltitudeHourly(
  latDeg: number,
  lonDeg: number,
  firstSlotUtcMs: number,
  nHours: number,
  stepMinutes = 60,
): number[] {
  const stepMs = stepMinutes * 60000;
  const nSteps = Math.round(nHours * 60 / stepMinutes);
  const out: number[] = [];
  for (let i = 0; i < nSteps; i++) {
    out.push(solarAltitudeDeg(latDeg, lonDeg, firstSlotUtcMs + i * stepMs));
  }
  return out;
}
