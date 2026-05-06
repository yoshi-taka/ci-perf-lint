import { describe, expect, test } from "bun:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { renderReport } from "../src/reporters.ts";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

const GOLDEN_DIR = path.resolve(import.meta.dir, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const goldenFixtures = [
  "sampleRepo",
  "cleanNoFindings",
  "barrelFileLike",
  "deepCheckoutExcessiveLike",
  "dependencyCacheLike",
  "dockerBuildWithoutLayerCacheLike",
  "releaseGuardLike",
  "sparseCheckoutLike",
  "nativeBuildRiskLike",
  "buildkiteTimeoutLike",
  "circleciFullCloneLike",
  "gitlabCiTimeoutLike",
  "agenticWorkflowLike",
  "elixirSecurityAdvisoriesOk",
  "qemuArmLike",
  "blobNoneLike",
] as const;

describe("golden regression", () => {
  for (const name of goldenFixtures) {
    test(name, async () => {
      const fixturePath = fixtures[name as keyof typeof fixtures];
      if (!fixturePath) {
        throw new Error(`Fixture not found: ${name}`);
      }

      const report = await memoizedAnalyzeRepository({
        cwd: fixturePath,
        targetPath: ".",
        topCount: 100,
        mode: "exploratory",
      });

      const findingsJson = renderReport(report, "json", { findingsOnly: true });
      const goldenPath = path.join(GOLDEN_DIR, `${name}.json`);

      if (UPDATE) {
        await mkdir(GOLDEN_DIR, { recursive: true });
        await writeFile(goldenPath, findingsJson);
        return;
      }

      if (!existsSync(goldenPath)) {
        process.stderr.write(
          `[golden] No golden file for "${name}". Run with UPDATE_GOLDEN=1 to create.\n`,
        );
        expect(existsSync(goldenPath)).toBe(true);
        return;
      }

      const golden = await readFile(goldenPath, "utf8");
      expect(JSON.parse(findingsJson)).toEqual(JSON.parse(golden));
    });
  }
});
