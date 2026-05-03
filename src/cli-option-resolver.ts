interface ResolvedOption {
  flag: string;
  resolvedFrom?: string;
}

export function resolveOptionFlag(arg: string, knownFlags: readonly string[]): ResolvedOption {
  if (!arg.startsWith("--")) {
    return { flag: arg };
  }

  if (knownFlags.includes(arg)) {
    return { flag: arg };
  }

  const prefixMatches = knownFlags.filter((flag) => flag.startsWith(arg));
  if (prefixMatches.length === 1) {
    return { flag: prefixMatches[0] ?? arg, resolvedFrom: arg };
  }

  if (prefixMatches.length > 1) {
    throw new Error(`ambiguous option: ${arg} (could be ${prefixMatches.join(", ")})`);
  }

  const similarFlags = findSimilarFlags(arg, knownFlags);
  if (similarFlags.length === 0) {
    throw new Error(`unknown option: ${arg}`);
  }

  throw new Error(
    [
      `unknown option: ${arg}`,
      "",
      "The most similar options are",
      ...similarFlags.map((flag) => `\t${flag}`),
    ].join("\n"),
  );
}

function findSimilarFlags(arg: string, knownFlags: readonly string[]): string[] {
  const scored = knownFlags
    .map((flag) => ({
      flag,
      distance: optionDistance(arg, flag),
    }))
    .sort((left, right) => left.distance - right.distance || left.flag.localeCompare(right.flag));

  const bestDistance = scored[0]?.distance;
  if (bestDistance === undefined || bestDistance > similarFlagDistanceLimit(arg)) {
    return [];
  }

  return scored
    .filter((entry) => entry.distance <= Math.max(bestDistance + 1, 2))
    .slice(0, 6)
    .map((entry) => entry.flag);
}

function optionDistance(input: string, flag: string): number {
  const variants = flagVariants(flag);
  return Math.min(...variants.map((variant) => levenshteinDistance(input, variant)));
}

function flagVariants(flag: string): string[] {
  const variants = new Set([flag]);

  for (const suffix of ["-only", "-locations", "-workflows"]) {
    if (flag.endsWith(suffix)) {
      variants.add(flag.slice(0, -suffix.length));
    }
  }

  return [...variants];
}

export function similarFlagDistanceLimit(arg: string): number {
  return Math.max(2, Math.floor(arg.length * 0.35));
}

export function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }

  return previous[right.length] ?? 0;
}
