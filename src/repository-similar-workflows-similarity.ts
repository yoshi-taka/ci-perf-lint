const MINIMUM_SHARED_FEATURE_COUNT = 3;
const MINIMUM_SHARED_BAND_COUNT = 2;
const MINIMUM_SIMILARITY = 0.55;

interface FeatureComparable {
  features: Set<string>;
  featureMask: bigint;
  featureCount: number;
}

const BAND_PREFIXES = [
  "trigger",
  "push",
  "filter",
  "shape",
  "job",
  "runner",
  "runtime",
  "tool",
  "kind",
];

function featureBand(feature: string): string {
  const colon = feature.indexOf(":");
  return colon > 0 ? feature.slice(0, colon) : feature;
}

function isKnownBand(band: string): boolean {
  return BAND_PREFIXES.includes(band);
}

export function encodeFeatureMasks<T extends FeatureComparable>(summaries: T[]): void {
  const featureIndexes = new Map<string, number>();

  for (const summary of summaries) {
    for (const feature of summary.features) {
      if (!featureIndexes.has(feature)) {
        featureIndexes.set(feature, featureIndexes.size);
      }
    }
  }

  for (const summary of summaries) {
    let featureMask = 0n;

    for (const feature of summary.features) {
      const featureIndex = featureIndexes.get(feature);
      if (featureIndex !== undefined) {
        featureMask |= 1n << BigInt(featureIndex);
      }
    }

    summary.featureMask = featureMask;
    summary.featureCount = summary.features.size;
  }
}

function countBits(value: bigint): number {
  let count = 0;
  let remaining = value;

  while (remaining !== 0n) {
    remaining &= remaining - 1n;
    count += 1;
  }

  return count;
}

function countSharedFeatures(left: FeatureComparable, right: FeatureComparable): number {
  return countBits(left.featureMask & right.featureMask);
}

function jaccardSimilarity(
  left: FeatureComparable,
  right: FeatureComparable,
  sharedCount?: number,
): number {
  const shared = sharedCount ?? countSharedFeatures(left, right);
  const unionCount = left.featureCount + right.featureCount - shared;
  return unionCount === 0 ? 0 : shared / unionCount;
}

export function collectPeerIndexes<T extends FeatureComparable>(
  summaries: T[],
  isSameSummary: (left: T, right: T) => boolean,
): number[][] {
  const bandIndexes = new Map<string, Map<string, number[]>>();

  for (const [summaryIndex, summary] of summaries.entries()) {
    for (const feature of summary.features) {
      const band = featureBand(feature);
      if (!isKnownBand(band)) {
        continue;
      }
      let featureMap = bandIndexes.get(band);
      if (!featureMap) {
        featureMap = new Map();
        bandIndexes.set(band, featureMap);
      }
      const existing = featureMap.get(feature);
      if (existing) {
        existing.push(summaryIndex);
      } else {
        featureMap.set(feature, [summaryIndex]);
      }
    }
  }

  return summaries.map((summary, summaryIndex) => {
    const candidateData = new Map<number, { sharedCount: number; bands: Set<string> }>();

    for (const feature of summary.features) {
      const band = featureBand(feature);
      const featureMap = bandIndexes.get(band);
      if (!featureMap) {
        continue;
      }
      for (const candidateIndex of featureMap.get(feature) ?? []) {
        if (candidateIndex === summaryIndex) {
          continue;
        }
        let data = candidateData.get(candidateIndex);
        if (!data) {
          data = { sharedCount: 0, bands: new Set() };
          candidateData.set(candidateIndex, data);
        }
        data.sharedCount++;
        data.bands.add(band);
      }
    }

    const peerIndexes: number[] = [];

    for (const [candidateIndex, { sharedCount, bands }] of candidateData) {
      if (sharedCount < MINIMUM_SHARED_FEATURE_COUNT) {
        continue;
      }
      if (bands.size < MINIMUM_SHARED_BAND_COUNT) {
        continue;
      }

      const candidate = summaries[candidateIndex];
      if (!candidate || isSameSummary(summary, candidate)) {
        continue;
      }

      if (jaccardSimilarity(summary, candidate, sharedCount) >= MINIMUM_SIMILARITY) {
        peerIndexes.push(candidateIndex);
      }
    }

    return peerIndexes;
  });
}

export function collectConnectedComponents(peerIndexes: number[][]): number[][] {
  const parent = peerIndexes.map((_, i) => i);

  function find(x: number): number {
    if (parent[x] !== x) {
      parent[x] = find(parent[x] ?? x);
    }
    return parent[x] ?? x;
  }

  function union(x: number, y: number): void {
    const rootX = find(x);
    const rootY = find(y);
    if (rootX !== rootY) {
      parent[rootX] = rootY;
    }
  }

  for (const [i, peers] of peerIndexes.entries()) {
    for (const j of peers) {
      if (j < peerIndexes.length) {
        union(i, j);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < peerIndexes.length; i++) {
    const root = find(i);
    const group = components.get(root) ?? [];
    group.push(i);
    components.set(root, group);
  }

  return [...components.values()];
}
