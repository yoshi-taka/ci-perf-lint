import type * as OxcParser from "oxc-parser";

let loaded: Promise<typeof OxcParser> | undefined;

/**
 * Repository collectors are registered for every run, but the native parser is
 * only needed when a JS/TS collector actually parses source. A dynamic import
 * keeps the native module out of workflow-only startup.
 */
export function loadOxcParser(): Promise<typeof OxcParser> {
  loaded ??= import("oxc-parser");
  return loaded;
}
