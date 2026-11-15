import type { SourceFileAudit } from "./source-audit-parser.ts";
import type { PlaywrightModuleFacts } from "./playwright-route-detector.ts";

export const PLAYWRIGHT_LIMIT = 256 * 1024;
// Shared negative decisions must match Playwright's candidate filter exactly.
export const routeCallPattern = /\.route\s*\(|\[\s*["']route["']\s*\]/;

interface Payload {
  audit: { ok: true; value: SourceFileAudit | undefined } | { ok: false; error: unknown };
  mode: "negative" | "oversized" | "read-failed" | "legacy";
  module: PlaywrightModuleFacts | undefined;
}
export interface SharedRecord extends Payload {
  readonly path: string;
}
interface Slot {
  promise: Promise<SharedRecord>;
  record?: SharedRecord;
}
interface SharedGeneration {
  records: Map<string, Slot>;
  eligible?: (filename: string) => boolean;
  factory?: (filename: string) => Promise<Payload>;
  pending: Set<Promise<void>>;
  legacy: Set<string>;
  stopNewShares: boolean;
  maxFiles: number;
  maxModulePayload: number;
  modulePayload: number;
}
export class SharedGenerationCancelled extends Error {
  constructor() {
    super("Shared source generation changed");
  }
}
const states = new WeakMap<object, SharedGeneration>();

/**
 * Shared files select one read outcome per generation, including failures.
 * Later edits appear on the next analysis. Legacy paths retain their behavior;
 * this is not an atomic repository snapshot. Limits bound metadata, not RSS.
 */
export function prepareShared(
  context: object,
  enabled: boolean,
  limits = { files: 16_384, modulePayload: 8 * 1024 * 1024 },
): SharedGeneration | undefined {
  if (!enabled) {
    return undefined;
  }
  const state: SharedGeneration = {
    records: new Map(),
    pending: new Set(),
    legacy: new Set(),
    stopNewShares: false,
    maxFiles: limits.files,
    maxModulePayload: limits.modulePayload,
    modulePayload: 0,
  };
  states.set(context, state);
  return state;
}
export function sharedEnabled(context: object): boolean {
  return states.has(context);
}
export function sharedCurrent(context: object, handle: SharedGeneration | undefined): boolean {
  return handle === undefined || states.get(context) === handle;
}
export function registerSharedAudit(
  context: object,
  eligible: (filename: string) => boolean,
  factory: (filename: string) => Promise<Payload>,
): void {
  const state = states.get(context);
  if (state && !state.factory) {
    state.eligible = eligible;
    state.factory = factory;
  }
}
function moduleSize(module: PlaywrightModuleFacts | undefined): number {
  if (!module) {
    return 0;
  }
  let bytes = 64;
  for (const values of [module.localImports, module.localTestImports]) {
    for (const value of values) {
      bytes += 2 * value.length + 16;
    }
  }
  return bytes;
}
export function getSharedRecord(
  context: object,
  filename: string,
  consumer: "audit" | "playwright" = "audit",
): Promise<SharedRecord> | undefined {
  const state = states.get(context);
  if (!state) {
    return undefined;
  }
  const cached = state.records.get(filename);
  if (cached) {
    return cached.promise;
  }
  if (state.stopNewShares || state.legacy.has(filename)) {
    return undefined;
  }
  if (!state.factory) {
    // Never retroactively share a path that already selected the legacy reader.
    if (consumer === "playwright") {
      if (state.legacy.size < state.maxFiles) {
        state.legacy.add(filename);
      } else {
        state.stopNewShares = true;
      }
    }
    return undefined;
  }
  if (!state.eligible?.(filename) || state.records.size >= state.maxFiles) {
    return undefined;
  }
  const deferred = Promise.withResolvers<SharedRecord>();
  const slot: Slot = { promise: deferred.promise };
  // Reserve before invoking the reader, including reentrant/concurrent requests.
  state.records.set(filename, slot);
  const work = (async () => {
    let payload: Payload;
    try {
      payload = await state.factory!(filename);
    } catch (error) {
      payload = { audit: { ok: false, error }, mode: "legacy", module: undefined };
    }
    if (states.get(context) !== state || state.records.get(filename) !== slot) {
      throw new SharedGenerationCancelled();
    }
    const bytes = moduleSize(payload.module);
    if (state.modulePayload + bytes > state.maxModulePayload) {
      payload = { ...payload, mode: "legacy", module: undefined };
    } else {
      state.modulePayload += bytes;
    }
    const record = Object.freeze({ path: filename, ...payload });
    slot.record = record;
    return record;
  })();
  const handled = work.then(deferred.resolve, deferred.reject);
  state.pending.add(handled);
  void handled.finally(() => state.pending.delete(handled));
  // Teardown may cancel an unused prefetch; awaiting callers still see rejection.
  void deferred.promise.catch(() => {});
  return deferred.promise;
}
export function assertSharedCurrent(context: object, record: SharedRecord): void {
  if (states.get(context)?.records.get(record.path)?.record !== record) {
    throw new SharedGenerationCancelled();
  }
}
export function clearShared(context: object): void {
  states.delete(context);
}
export async function finishShared(
  context: object,
  handle: SharedGeneration | undefined,
): Promise<void> {
  if (!handle) {
    return;
  }
  if (states.get(context) === handle) {
    states.delete(context);
  }
  await Promise.all([...handle.pending]);
  handle.records.clear();
  handle.legacy.clear();
}
