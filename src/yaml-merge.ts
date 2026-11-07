export type ConvertedMap = Record<string, unknown> | Map<unknown, unknown> | Set<unknown>;

/** First merge source wins; explicit assignments before or after a merge win too. */
export function mergeEntries(target: ConvertedMap, entries: Iterable<unknown>): void {
  // A !!set source deliberately keeps the backend's iterable/destructuring
  // behavior, including TypeError for a non-iterable set member.
  for (const [key, value] of entries as Iterable<[unknown, unknown]>) {
    if (target instanceof Map) {
      if (!target.has(key)) {
        target.set(key, value);
      }
    } else if (target instanceof Set) {
      target.add(key);
    } else if (!Object.hasOwn(target, key as PropertyKey)) {
      // Merge-map keys use JS ToPropertyKey, unlike ordinary YAML key formatting.
      Object.defineProperty(target, key as PropertyKey, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  }
}
