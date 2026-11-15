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

/**
 * The published option type does not describe the raw-transfer flag yet, and raw
 * transfer is unavailable on some runtimes (Bun), so probe it once per process.
 */
type ParserOptionsWithRawTransfer = OxcParser.ParserOptions & {
  experimentalRawTransfer?: boolean;
};

let rawTransferSupported: boolean | undefined;

export async function oxcParserOptions(
  preserveParens = true,
): Promise<ParserOptionsWithRawTransfer> {
  if (rawTransferSupported === undefined) {
    const { rawTransferSupported: supported } = await loadOxcParser();
    rawTransferSupported = supported();
  }

  return {
    preserveParens,
    ...(rawTransferSupported ? { experimentalRawTransfer: true } : {}),
  };
}
