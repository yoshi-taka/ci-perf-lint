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
 * The published option type omits the raw-transfer flag, and raw transfer is
 * unavailable on some runtimes, so probe it once per process.
 */
type ParserOptionsWithRawTransfer = OxcParser.ParserOptions & {
  experimentalRawTransfer?: boolean;
};

let rawTransferAvailable: boolean | undefined;

export async function oxcParserOptions(
  preserveParens = true,
): Promise<ParserOptionsWithRawTransfer> {
  if (rawTransferAvailable === undefined) {
    const { rawTransferSupported } = await loadOxcParser();
    rawTransferAvailable = rawTransferSupported();
  }

  return {
    preserveParens,
    ...(rawTransferAvailable ? { experimentalRawTransfer: true } : {}),
  };
}
