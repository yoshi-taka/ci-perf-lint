export function setIntersection<T>(a: Iterable<T>, b: Iterable<T>): Set<T> {
  const setB = b instanceof Set ? b : new Set(b);
  const result = new Set<T>();
  for (const item of a) {
    if (setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

export function setDifference<T>(a: Iterable<T>, b: Iterable<T>): Set<T> {
  const setB = b instanceof Set ? b : new Set(b);
  const result = new Set<T>();
  for (const item of a) {
    if (!setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

export function setUnion<T>(...iterables: Iterable<T>[]): Set<T> {
  const result = new Set<T>();
  for (const iterable of iterables) {
    for (const item of iterable) {
      result.add(item);
    }
  }
  return result;
}

export function isSubset<T>(a: Iterable<T>, b: Iterable<T>): boolean {
  const setB = b instanceof Set ? b : new Set(b);
  for (const item of a) {
    if (!setB.has(item)) {
      return false;
    }
  }
  return true;
}

export function jaccardIndex<T>(a: Iterable<T>, b: Iterable<T>): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  let shared = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      shared++;
    }
  }
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}
