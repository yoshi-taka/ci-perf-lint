import { describe, expect, test } from "bun:test";
import {
  buildCollectorCooccurrenceDebug,
  orderCollectorsForDiagnostics,
} from "../src/repository-diagnostics/collector-cooccurrence.ts";

describe("buildCollectorCooccurrenceDebug", () => {
  test("deduplicates and sorts fired collectors", () => {
    expect(buildCollectorCooccurrenceDebug(["b", "a", "b"])).toEqual({
      firedCollectors: ["a", "b"],
      collectorSupport: [
        { collector: "a", support: 1 },
        { collector: "b", support: 1 },
      ],
      pairSupport: [{ left: "a", right: "b", support: 1 }],
    });
  });

  test("ranks hardcoded paired collectors first", () => {
    const debug = orderCollectorsForDiagnostics([
      "misc-collector",
      "prefer-ruff-format-over-black",
      "prefer-ruff-import-sorting-over-isort",
      "avoid-eslint-plugin-prettier",
      "prefer-oxlint-over-eslint",
    ]);

    expect(debug.schedule.map((entry) => entry.collector)).toEqual([
      "avoid-eslint-plugin-prettier",
      "prefer-oxlint-over-eslint",
      "prefer-ruff-format-over-black",
      "prefer-ruff-import-sorting-over-isort",
      "misc-collector",
    ]);
    expect(debug.schedule[0]).toMatchObject({
      score: 50,
      matchedPairs: 1,
    });
  });
});
