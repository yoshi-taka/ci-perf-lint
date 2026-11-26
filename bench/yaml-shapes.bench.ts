import { readFileSync } from "node:fs";
import path from "node:path";
import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { parseCiYaml } from "../src/ci-yaml.ts";
import { parseDocument } from "../src/yaml.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");
const workflowSource = readFileSync(
  path.join(fixturesDir, "workflow-efficiency-like/.github/workflows/ci.yml"),
  "utf8",
);

// Shapes that exercise parser paths rather than any particular repository.
const lockfile = ["lockfileVersion: '9.0'", "packages:"];
for (let index = 0; index < 10_000; index += 1) {
  lockfile.push(
    `  pkg-${index}@1.0.0:`,
    `    resolution: {integrity: sha512-${index}}`,
  );
}
const lockfileSource = `${lockfile.join("\n")}\n`;

const flowSource = `m: {${Array.from(
  { length: 4000 },
  (_, index) => `key${index}: value${index}`,
).join(", ")}}\n`;

// Many workflow documents share no parser state; this is the per-repository
// cost seen in monorepos that generate one workflow per package.
const workflowCorpus = Array.from({ length: 200 }, (_, index) =>
  workflowSource.replaceAll("CI", `CI ${index}`),
);

const bench = withCodSpeed(new Bench({ iterations: 10, time: 0, warmup: false }));

bench
  .add("yaml > parse 10k-package lockfile mapping", () => {
    parseDocument(lockfileSource, { uniqueKeys: true });
  })
  .add("yaml > parse single-line 4k-key flow mapping", () => {
    parseDocument(flowSource);
  })
  .add("yaml > parse 200 workflow documents", () => {
    for (const source of workflowCorpus) {
      parseCiYaml(source, "github-actions");
    }
  });

export { bench };
