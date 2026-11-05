import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "testcontainers-node-fixed-sleep-after-start", severity: "warning" } as const;
const imports = `import { GenericContainer } from "testcontainers";
import { setTimeout as delay } from "node:timers/promises";`;
function source(body: string, preamble = imports) {
  return `${preamble}\nasync function setup() {\n${body}\n}\n`;
}
const start = 'const container = await new GenericContainer("redis:7").start();';
const positive: Record<string, string> = {
  "basic.ts": source(`${start}\nawait delay(5000);`),
  "alias.ts": source(
    'await new Container("redis:7").start(); await sleep(1);',
    imports
      .replaceAll("GenericContainer", "GenericContainer as Container")
      .replace("as delay", "as sleep"),
  ),
  "chain.ts": source(
    'const container = await new GenericContainer("redis:7").withExposedPorts(6379).withStartupTimeout(60000).start(); await delay(5_000);',
  ),
  "module.ts": source(
    'const pg = await new PostgreSqlContainer("postgres:16").start(); await delay(1000);',
    imports.replace(
      'import { GenericContainer } from "testcontainers";',
      'import { PostgreSqlContainer } from "@testcontainers/postgresql";',
    ),
  ),
  "comments.ts": source(`${start} /* comment */\n// padding\nawait delay(5000);`),
  "inline.ts": source(`${start}\nawait new Promise(resolve => setTimeout(resolve, 5000));`),
  "inline-block.ts": source(`${start}\nawait new Promise((done) => { setTimeout(done, 5000); });`),
  "timer-bare.ts": source(
    `${start}\nawait delay(5000);`,
    imports.replace("node:timers/promises", "timers/promises"),
  ),
  "javascript.js": source(`${start}\nawait delay(5000);`),
  "setup.mts": `${imports}\n${start}\nawait delay(5000);`,
  "unicode.ts": source(`const label = "🚀日本語";\n${start}\nawait delay(5000);`),
};
const negative: Record<string, string> = {
  "no-delay.ts": source(start),
  "zero.ts": source(`${start} await delay(0);`),
  "negative.ts": source(`${start} await delay(-1);`),
  "fraction.ts": source(`${start} await delay(0.5);`),
  "unsafe.ts": source(`${start} await delay(9007199254740992);`),
  "dynamic.ts": source(`${start} await delay(timeout);`),
  "string-duration.ts": source(`${start} await delay("5000");`),
  "extra-args.ts": source(`${start} await delay(5000, "result");`),
  "intervening.ts": source(`${start} verifyReady(); await delay(5000);`),
  "not-awaited-start.ts": source('new GenericContainer("redis:7").start(); await delay(5000);'),
  "not-awaited-sleep.ts": source(`${start} delay(5000);`),
  "unrelated-start.ts": source("await service.start(); await delay(5000);"),
  "receiver.ts": source(
    'const builder = new GenericContainer("redis:7"); await builder.start(); await delay(5000);',
  ),
  "other-package.ts": source(
    `${start} await delay(5000);`,
    imports.replace('"testcontainers"', '"other-package"'),
  ),
  "fake-module.ts": source(
    'await new Other("redis:7").start(); await delay(5000);',
    imports.replace(
      'import { GenericContainer } from "testcontainers";',
      'import { Other } from "@testcontainers/postgresql";',
    ),
  ),
  "type-import.ts": source(
    `${start} await delay(5000);`,
    imports.replace("import { GenericContainer", "import type { GenericContainer"),
  ),
  "type-specifier.ts": source(
    `${start} await delay(5000);`,
    imports.replace("{ GenericContainer", "{ type GenericContainer"),
  ),
  "shadow-constructor.ts": source(`${start} await delay(5000);`).replace(
    "setup()",
    "setup(GenericContainer)",
  ),
  "shadow-timer.ts": source(`${start} await delay(5000);`).replace("setup()", "setup(delay)"),
  "write-constructor.ts": source(`GenericContainer = Other; ${start} await delay(5000);`),
  "write-timer.ts": source(`${start} await delay(5000); delay = other;`),
  "destructure-write.ts": source(`({ delay } = other); ${start} await delay(5000);`),
  "loop-write.ts": source(`for (delay of values) {} ${start} await delay(5000);`),
  "member-write.ts": source(`GenericContainer.prototype = other; ${start} await delay(5000);`),
  "shadow-Promise.ts": source(
    `${start} await new Promise(resolve => setTimeout(resolve, 5000));`,
  ).replace("setup()", "setup(Promise)"),
  "shadow-setTimeout.ts": source(
    `${start} await new Promise(resolve => setTimeout(resolve, 5000));`,
  ).replace("setup()", "setup(setTimeout)"),
  "shadow-inline.ts": source(
    `${start} await new Promise(setTimeout => setTimeout(setTimeout, 5000));`,
  ),
  "inline-side-effect.ts": source(
    `${start} await new Promise(resolve => { mutate(); setTimeout(resolve, 5000); });`,
  ),
  "inline-wrong-resolve.ts": source(
    `${start} await new Promise(resolve => setTimeout(other, 5000));`,
  ),
  "inline-async.ts": source(
    `${start} await new Promise(async resolve => setTimeout(resolve, 5000));`,
  ),
  "inline-custom-timer.ts": source(
    `${start} await new Promise(resolve => clock.setTimeout(resolve, 5000));`,
  ),
  "inline-unawaited.ts": source(`${start} new Promise(resolve => setTimeout(resolve, 5000));`),
  "unknown-sleep.ts": source(`${start} await sleep(5000);`),
  "unknown-timer.ts": source(
    `${start} await delay(5000);`,
    imports.replace('"node:timers/promises"', '"custom-timer"'),
  ),
  "comment-only.ts": source(`// ${start} await delay(5000);`),
  "string-only.ts": source(`const example = ${JSON.stringify(`${start} await delay(5000);`)};`),
  "invalid.ts": `${imports}\nasync function {`,
  "optional-start.ts": source(
    'await new GenericContainer("redis:7").start?.(); await delay(5000);',
  ),
  "unknown-chain.ts": source(
    'await new GenericContainer("redis:7").customize().start(); await delay(5000);',
  ),
  "different-block.ts": source(`${start} { await delay(5000); }`),
  "commonjs.cts":
    'const { GenericContainer } = require("testcontainers"); async function setup() { const db = await new GenericContainer("redis:7").start(); await new Promise(resolve => setTimeout(resolve, 5000)); }',
  "dist/generated.ts": source(`${start} await delay(5000);`),
  "__snapshots__/generated.ts": source(`${start} await delay(5000);`),
  "build.snapshot/generated.ts": source(`${start} await delay(5000);`),
};

describe("Testcontainers Node fixed startup sleeps", () => {
  let findings: Awaited<ReturnType<typeof analyzeRepositoryForRule>>["findings"];
  beforeAll(async () => {
    const root = await tempDirs.create("apl-testcontainers-node-");
    await mkdir(path.join(root, ".github/workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github/workflows/ci.yml"),
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run" },
        devDependencies: { testcontainers: "^11.0.0", vitest: "^3.0.0" },
      }),
    );
    for (const [group, cases] of [
      ["positive", positive],
      ["negative", negative],
    ] as const) {
      for (const [file, text] of Object.entries(cases)) {
        const full = path.join(root, group, file);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, text);
      }
    }
    const report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      rule,
    );
    findings = report.findings.filter((finding) => finding.ruleId === rule.id);
  });
  for (const [file, text] of Object.entries(positive)) {
    test(`detects ${file}`, () => {
      const matches = findings.filter((finding) => finding.location.path === `positive/${file}`);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.severity).toBe("warning");
      const lines = text.split("\n");
      expect(
        lines[(matches[0]?.location.line ?? 0) - 1]?.slice((matches[0]?.location.column ?? 1) - 1),
      ).toStartWith("await ");
      expect(matches[0]?.suggestion).toContain("Retain intentional elapsed-time assertions");
      expect(matches[0]?.suggestion).toContain("stop()/cleanup");
    });
  }
  for (const file of Object.keys(negative)) {
    test(`abstains for ${file}`, () => {
      expect(
        findings.filter((finding) => finding.location.path === `negative/${file}`),
      ).toHaveLength(0);
    });
  }
  test("does not emit extra findings or universal speedup claims", () => {
    expect(findings).toHaveLength(Object.keys(positive).length);
    expect(findings[0]?.why).toContain("does not prove CI execution");
    expect(findings[0]?.measurementHint).toContain("Count executions");
  });
});
