export interface CollectorSupportCount {
  collector: string;
  support: number;
}

export interface CollectorPairSupportCount {
  left: string;
  right: string;
  support: number;
}

export interface CollectorCooccurrenceDebug {
  firedCollectors: string[];
  collectorSupport: CollectorSupportCount[];
  pairSupport: CollectorPairSupportCount[];
}

export interface CollectorSchedulingPair {
  left: string;
  right: string;
  weight: number;
}

export interface CollectorScheduleEntry {
  collector: string;
  score: number;
  matchedPairs: number;
}

export interface CollectorScheduleDebug {
  schedule: CollectorScheduleEntry[];
  pairs: CollectorSchedulingPair[];
}

const collectorSchedulingPairs: readonly CollectorSchedulingPair[] = [
  { left: "prefer-oxlint-over-eslint", right: "avoid-eslint-plugin-prettier", weight: 50 },
  {
    left: "prefer-ruff-format-over-black",
    right: "prefer-ruff-import-sorting-over-isort",
    weight: 40,
  },
  { left: "prefer-oxfmt-over-prettier", right: "avoid-prettier-eslint", weight: 30 },
];

function buildCollectorScoreMap(
  collectors: readonly string[],
): Map<string, CollectorScheduleEntry> {
  const collectorSet = new Set(collectors);
  const scores = new Map<string, CollectorScheduleEntry>();

  for (const collector of collectorSet) {
    scores.set(collector, { collector, score: 0, matchedPairs: 0 });
  }

  for (const pair of collectorSchedulingPairs) {
    const left = scores.get(pair.left);
    const right = scores.get(pair.right);
    if (!left || !right) {
      continue;
    }

    left.score += pair.weight;
    right.score += pair.weight;
    left.matchedPairs += 1;
    right.matchedPairs += 1;
  }

  return scores;
}

export function orderCollectorsForDiagnostics(
  collectors: readonly string[],
): CollectorScheduleDebug {
  const scores = buildCollectorScoreMap(collectors);
  const schedule = [...scores.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.matchedPairs !== left.matchedPairs) {
      return right.matchedPairs - left.matchedPairs;
    }
    return left.collector.localeCompare(right.collector);
  });

  return {
    schedule,
    pairs: [...collectorSchedulingPairs],
  };
}

export function buildCollectorCooccurrenceDebug(
  firedCollectors: readonly string[],
): CollectorCooccurrenceDebug {
  const fired = [...new Set(firedCollectors)].sort();
  const collectorSupport = fired.map((collector) => ({ collector, support: 1 }));
  const pairSupport: CollectorPairSupportCount[] = [];

  for (let leftIndex = 0; leftIndex < fired.length; leftIndex++) {
    const left = fired[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < fired.length; rightIndex++) {
      pairSupport.push({
        left,
        right: fired[rightIndex]!,
        support: 1,
      });
    }
  }

  return {
    firedCollectors: fired,
    collectorSupport,
    pairSupport,
  };
}
