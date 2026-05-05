export type ParamSpec = {
  name: string;
  values: unknown[];
};

interface SortedParam {
  s: ParamSpec;
  origIdx: number;
}

function pairKey(i: number, j: number): string {
  return `${i},${j}`;
}

function valuePairKey(a: unknown, b: unknown): string {
  return `${JSON.stringify(a)}\x00${JSON.stringify(b)}`;
}

export function generatePairwise(specs: ParamSpec[]): Record<string, unknown>[] {
  const sorted: SortedParam[] = specs
    .map((s, i) => ({ s, origIdx: i }))
    .sort((a, b) => b.s.values.length - a.s.values.length);

  const names: string[] = sorted.map((x) => x.s.name);
  const vals: unknown[][] = sorted.map((x) => x.s.values);

  const coveredPairs = new Map<string, Set<string>>();

  function markCovered(test: Record<string, unknown>, maxIdx: number): void {
    for (let a = 0; a <= maxIdx; a++) {
      for (let b = a + 1; b <= maxIdx; b++) {
        const sa = sorted[a];
        const sb = sorted[b];
        if (!sa || !sb) { continue; }
        const key = pairKey(sa.origIdx, sb.origIdx);
        if (!coveredPairs.has(key)) {
          coveredPairs.set(key, new Set());
        }
        coveredPairs.get(key)!.add(valuePairKey(test[names[a]!], test[names[b]!]));
      }
    }
  }

  function isCovered(
    origI: number,
    origJ: number,
    vi: unknown,
    vj: unknown,
  ): boolean {
    const key = pairKey(origI, origJ);
    return coveredPairs.get(key)?.has(valuePairKey(vi, vj)) ?? false;
  }

  const tests: Record<string, unknown>[] = [];

  const v0vals = vals[0]!;
  const v1vals = vals[1]!;
  const name0 = names[0]!;
  const name1 = names[1]!;

  for (const v0 of v0vals) {
    for (const v1 of v1vals) {
      const test: Record<string, unknown> = {};
      test[name0] = v0;
      test[name1] = v1;
      tests.push(test);
    }
  }

  for (const test of tests) {
    markCovered(test, 1);
  }

  for (let pIdx = 2; pIdx < sorted.length; pIdx++) {
    const pName = names[pIdx]!;
    const pOrig = sorted[pIdx]!.origIdx;
    const pVals = vals[pIdx]!;

    for (const test of tests) {
      let bestVal: unknown = pVals[0];
      let bestCount = -1;

      for (const v of pVals) {
        let count = 0;
        for (let q = 0; q < pIdx; q++) {
          const qOrig = sorted[q]!.origIdx;
          if (!isCovered(qOrig, pOrig, test[names[q]!], v)) {
            count++;
          }
        }
        if (count > bestCount) {
          bestCount = count;
          bestVal = v;
        }
      }
      test[pName] = bestVal;
    }

    for (const test of tests) {
      markCovered(test, pIdx);
    }

    for (let q = 0; q < pIdx; q++) {
      const qOrig = sorted[q]!.origIdx;
      const qName = names[q]!;
      const qVals = vals[q]!;
      for (const vq of qVals) {
        for (const vp of pVals) {
          if (!isCovered(qOrig, pOrig, vq, vp)) {
            const newTest: Record<string, unknown> = {};
            newTest[qName] = vq;
            newTest[pName] = vp;
            for (let r = 0; r < sorted.length; r++) {
              if (r !== q && r !== pIdx) {
                const rName = names[r];
                const rVals = vals[r];
                if (rName && rVals) {
                  newTest[rName] = rVals[0]!;
                }
              }
            }
            tests.push(newTest);
            markCovered(newTest, pIdx);
          }
        }
      }
    }
  }

  return tests;
}
