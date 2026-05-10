// ──────────────────────────────────────────────
// SCHEDULE HARMONICS — multi-cron spectrum analysis
// ──────────────────────────────────────────────
// Models cron schedules as harmonic components and
// detects constructive interference (resonance) between
// overlapping periodic schedules.

export interface CronComponent {
  interval: number;
  phase: number;
  raw: string;
}

export interface ResonancePair {
  intervalA: number;
  intervalB: number;
  phaseA: number;
  phaseB: number;
  lcm: number;
  overlaps: boolean;
  overlapsPerDay: number;
}

export interface ScheduleSpectrum {
  components: CronComponent[];
  minInterval: number;
  fundamentalPeriod: number;
  resonances: ResonancePair[];
  resonanceEventsPerDay: number;
  contentionRisk: number;
}

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

function parseCronComponent(cron: string): CronComponent | undefined {
  const interval = estimateCronInterval(cron);
  if (interval === undefined) {
    return undefined;
  }
  return { interval, phase: extractCronPhase(cron), raw: cron };
}

// ──────────────────────────────────────────────
// 2. HARMONIC SPECTRUM
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

function phasesOverlap(phaseA: number, phaseB: number, gcd: number): boolean {
  if (gcd === 0) {
    return phaseA === phaseB;
  }
  return Math.abs(phaseA - phaseB) % gcd === 0;
}

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

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i]!;
      const b = components[j]!;
      const g = computeGcd(a.interval, b.interval);
      const lcm = computeLcm(a.interval, b.interval);
      const overlap = phasesOverlap(a.phase, b.phase, g);

      resonances.push({
        intervalA: a.interval,
        intervalB: b.interval,
        phaseA: a.phase,
        phaseB: b.phase,
        lcm,
        overlaps: overlap,
        overlapsPerDay: overlap ? 1440 / lcm : 0,
      });
    }
  }

  const resonanceEventsPerDay = resonances.reduce((sum, r) => sum + r.overlapsPerDay, 0);
  const contentionRisk = Math.min(1, resonanceEventsPerDay / 24);

  return {
    components,
    minInterval,
    fundamentalPeriod,
    resonances,
    resonanceEventsPerDay,
    contentionRisk,
  };
}
