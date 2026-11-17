export interface Retention {
  seen: Set<string>;
  fresh: boolean;
}

/** Keep an input only when its coverage adds at least one unseen key. */
export function retainCoverage(seen: ReadonlySet<string>, coverage: Iterable<string>): Retention {
  const next = new Set(seen);
  let fresh = false;
  for (const key of coverage) {
    if (!next.has(key)) {
      next.add(key);
      fresh = true;
    }
  }
  return { seen: next, fresh };
}
