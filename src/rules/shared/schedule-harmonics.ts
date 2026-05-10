// ──────────────────────────────────────────────
// SCHEDULE HARMONICS — multi-cron spectrum analysis
// ──────────────────────────────────────────────
// Models cron schedules as harmonic components and
// detects constructive interference (resonance) between
// overlapping periodic schedules.
//
// Features:
//   - exact phase-aligned overlaps (LCM-based)
//   - near-integer frequency ratios (beat periods)
//   - proximity overlaps (crons firing within tolerance)
//   - day-of-week mutual exclusivity

export interface CronComponent {
  interval: number;
  phase: number;
  dayMask: number;
  raw: string;
}

export interface ResonancePair {
  intervalA: number;
  intervalB: number;
  phaseA: number;
  phaseB: number;
  lcm: number;
  exactOverlap: boolean;
  exactOverlapsPerDay: number;
  proximityMinutes: number;
  dayOverlapFraction: number;
  harmonicRatio: HarmonicRatio | null;
}

export interface HarmonicRatio {
  nearestInteger: number;
  deviation: number;
  beatPeriodMinutes: number;
}

export interface ScheduleSpectrum {
  components: CronComponent[];
  minInterval: number;
  fundamentalPeriod: number;
  resonances: ResonancePair[];
  exactEventsPerDay: number;
  proximityScore: number;
  contentionRisk: number;
}

const PROXIMITY_TOLERANCE = 5;

// ──────────────────────────────────────────────
// 1. CRON PARSING
// ──────────────────────────────────────────────

export function estimateCronInterval(cron: string): number | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return undefined;
  }

  const minute = parts[0];
  const hour = parts[1];
  if (!minute || !hour) {
    return undefined;
  }

  const minuteEveryMatch = /^\*\/(\d+)$/.exec(minute);
  if (minuteEveryMatch?.[1]) {
    return Number.parseInt(minuteEveryMatch[1], 10);
  }
  if (minute === "*" && hour === "*") {
    return 1;
  }
  if (minute === "*") {
    return 1;
  }
  if (/^\d+$/.test(minute) && hour === "*") {
    return 60;
  }

  const hourEveryMatch = /^\*\/(\d+)$/.exec(hour);
  if (hourEveryMatch?.[1]) {
    return Number.parseInt(hourEveryMatch[1], 10) * 60;
  }
  if (/^\d+(,\d+)+$/.test(hour)) {
    const values = hour
      .split(",")
      .map((v) => Number.parseInt(v, 10))
      .sort((a, b) => a - b);
    const first = values[0];
    const second = values[1];
    if (first !== undefined && second !== undefined) {
      return Math.max(1, second - first) * 60;
    }
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return 24 * 60;
  }

  return undefined;
}

function extractCronPhase(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return 0;
  }

  const minute = parts[0]!;
  const hour = parts[1]!;

  const minuteNum = /^\d+$/.test(minute) ? Number.parseInt(minute, 10) : 0;

  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    return Number.parseInt(hour, 10) * 60 + minuteNum;
  }

  return minuteNum;
}

const DAY_MASK_ALL = 0x7f;

function parseDayOfWeek(field: string | undefined): number {
  if (!field || field === "*") {
    return DAY_MASK_ALL;
  }

  const dayIndex = (d: number): number => {
    const idx = d === 7 ? 0 : d;
    return 1 << idx;
  };

  let mask = 0;
  const segments = field.split(",");
  for (const seg of segments) {
    const range = /^(\d+)-(\d+)$/.exec(seg.trim());
    if (range) {
      const lo = Number.parseInt(range[1]!, 10);
      const hi = Number.parseInt(range[2]!, 10);
      for (let d = lo; d <= hi; d++) {
        mask |= dayIndex(d);
      }
    } else {
      const d = Number.parseInt(seg.trim(), 10);
      if (!Number.isNaN(d)) {
        mask |= dayIndex(d);
      }
    }
  }
  return mask;
}

function popcount(mask: number): number {
  let c = 0;
  while (mask) {
    c += mask & 1;
    mask >>>= 1;
  }
  return c;
}

function parseCronComponent(cron: string): CronComponent | undefined {
  const interval = estimateCronInterval(cron);
  if (interval === undefined) {
    return undefined;
  }
  const parts = cron.trim().split(/\s+/);
  return {
    interval,
    phase: extractCronPhase(cron),
    dayMask: parseDayOfWeek(parts[4]),
    raw: cron,
  };
}

// ──────────────────────────────────────────────
// 2. ARITHMETIC HELPERS
// ──────────────────────────────────────────────

function computeGcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function computeLcm(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return (a / computeGcd(a, b)) * b;
}

// ──────────────────────────────────────────────
// 3. HARMONIC RATIO — near-integer frequency
// ──────────────────────────────────────────────

function detectHarmonicRatio(intervalA: number, intervalB: number): HarmonicRatio | null {
  const smaller = Math.min(intervalA, intervalB);
  const larger = Math.max(intervalA, intervalB);
  const ratio = larger / smaller;
  const nearestInteger = Math.round(ratio);
  if (nearestInteger === 0) {
    return null;
  }

  const deviation = Math.abs(ratio - nearestInteger) / ratio;
  if (deviation > 0.1) {
    return null;
  }

  const beatPeriodMinutes = Math.abs((smaller * larger) / (larger - nearestInteger * smaller));

  return { nearestInteger, deviation, beatPeriodMinutes };
}

// ──────────────────────────────────────────────
// 4. PROXIMITY — firing distance between crons
// ──────────────────────────────────────────────

function computeProximityMinutes(phaseA: number, phaseB: number, gcd: number): number {
  if (gcd === 0) {
    return Math.abs(phaseA - phaseB);
  }
  const d = Math.abs(phaseA - phaseB) % gcd;
  return Math.min(d, gcd - d);
}

// ──────────────────────────────────────────────
// 5. SPECTRUM BUILDER
// ──────────────────────────────────────────────

export function buildScheduleSpectrum(crons: string[]): ScheduleSpectrum {
  const components: CronComponent[] = [];

  for (const cron of crons) {
    const comp = parseCronComponent(cron);
    if (comp) {
      components.push(comp);
    }
  }

  const minInterval =
    components.length > 0 ? Math.min(...components.map((c) => c.interval)) : Infinity;

  const allIntervals = components.map((c) => c.interval);
  const fundamentalPeriod = allIntervals.reduce((g, i) => computeGcd(g, i), allIntervals[0] ?? 0);

  const resonances: ResonancePair[] = [];
  let proximityCount = 0;
  let pairCount = 0;

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i]!;
      const b = components[j]!;
      pairCount++;

      const g = computeGcd(a.interval, b.interval);
      const lcm = computeLcm(a.interval, b.interval);
      const phaseGap = computeProximityMinutes(a.phase, b.phase, g);
      const exactOverlap = phaseGap === 0;
      const isProximate = phaseGap <= PROXIMITY_TOLERANCE;
      if (isProximate) {
        proximityCount++;
      }

      const dayOverlap = a.dayMask & b.dayMask;
      const dayOverlapFraction = popcount(dayOverlap) / 7;

      const harmonicRatio =
        a.interval !== b.interval ? detectHarmonicRatio(a.interval, b.interval) : null;

      resonances.push({
        intervalA: a.interval,
        intervalB: b.interval,
        phaseA: a.phase,
        phaseB: b.phase,
        lcm,
        exactOverlap,
        exactOverlapsPerDay: exactOverlap && dayOverlap > 0 ? (1440 / lcm) * dayOverlapFraction : 0,
        proximityMinutes: phaseGap,
        dayOverlapFraction,
        harmonicRatio,
      });
    }
  }

  const exactEventsPerDay = resonances.reduce((sum, r) => sum + r.exactOverlapsPerDay, 0);
  const proximityScore = pairCount > 0 ? proximityCount / pairCount : 0;
  const contentionRisk = Math.min(1, exactEventsPerDay / 6);

  return {
    components,
    minInterval,
    fundamentalPeriod,
    resonances,
    exactEventsPerDay,
    proximityScore,
    contentionRisk,
  };
}
