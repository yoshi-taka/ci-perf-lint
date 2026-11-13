export const MAX_BARREL_SOURCES = 100;
export const MAX_INLINE_SNAPSHOT_LINES = 50;
export const MAX_EXTERNAL_SNAPSHOT_LINES = 300;

/** Counts come from parsed declarations/static strings, never user configuration. */
export function exceedsSourceLimit(count: number, limit: number): boolean {
  return count > limit;
}
