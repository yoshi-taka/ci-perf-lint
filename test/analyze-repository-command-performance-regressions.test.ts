import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(files: Record<string, string>, command = "npm test") {
  const cwd = await tempDirs.create("apl-command-regression-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": `on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: ${command}\n`,
    ...files,
  });
  return analyzeRepository({ cwd, targetPath: ".", topCount: 50, mode: "exploratory" });
}

describe("command performance regressions", () => {
  test.each([
    ["tsc -b", false],
    ["tsc --build", false],
    ["tsc --noEmit false", false],
    ["tsc --noEmit true --noEmit false", false],
    ["tsc --noEmit", true],
    ["tsc --noEmit true", true],
    ["tsc -b --noEmit", true],
  ])("preserves emit semantics for %s", async (command, expected) => {
    const report = await scan(
      {
        "package.json": JSON.stringify({
          devDependencies: { oxlint: "1.86.0", typescript: "7.0.2" },
          scripts: { typecheck: command },
        }),
      },
      command,
    );
    const findings = report.findings.filter(
      (f) => f.ruleId === "prefer-oxlint-type-check-over-tsc",
    );
    expect(findings.some((f) => f.scope === "repository")).toBe(expected);
    expect(findings.some((f) => f.scope !== "repository")).toBe(expected);
  });

  test.each(["10.0.0", "11.0.0"])(
    "does not downgrade ESLint %s with concurrency enabled",
    async (version) => {
      const report = await scan(
        {
          "package.json": JSON.stringify({
            devDependencies: { eslint: version },
            scripts: { lint: "eslint . --concurrency=auto" },
          }),
        },
        "npx eslint . --concurrency=auto",
      );
      expect(report.findings.some((f) => f.ruleId === "prefer-eslint-concurrency")).toBe(false);
    },
  );

  test("still recommends concurrency for ESLint 10 without the flag", async () => {
    const report = await scan(
      {
        "package.json": JSON.stringify({
          devDependencies: { eslint: "10.0.0" },
          scripts: { lint: "eslint ." },
        }),
      },
      "npx eslint .",
    );
    const findings = report.findings.filter((f) => f.ruleId === "prefer-eslint-concurrency");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.suggestion.includes("--concurrency=auto"))).toBe(true);
    expect(findings.every((f) => !f.suggestion.includes("latest 9.x"))).toBe(true);
  });

  test.each(["unused", "audit:static"])("recognizes knip in script %s", async (scriptName) => {
    const report = await scan(
      {
        "package.json": JSON.stringify({
          dependencies: { a: "1", b: "1", c: "1", d: "1", e: "1" },
          scripts: { [scriptName]: "npx knip" },
        }),
      },
      `npm run ${scriptName}`,
    );
    expect(report.findings.some((f) => f.ruleId === "prefer-knip-in-ci")).toBe(false);
  });

  test.each(["--threads\n1C\n", "-T1C\n", "# threads\n--threads=2\n"])(
    "reads Maven thread config %s",
    async (config) => {
      const report = await scan(
        {
          "pom.xml": "<project><modules><module>a</module></modules></project>",
          ".mvn/maven.config": config,
        },
        "./mvnw verify",
      );
      expect(report.findings.some((f) => f.ruleId === "maven-parallel-not-enabled")).toBe(false);
    },
  );

  test("does not treat a commented Maven thread flag as configuration", async () => {
    const report = await scan(
      {
        "pom.xml": "<project><modules><module>a</module></modules></project>",
        ".mvn/maven.config": "# --threads 1C\n",
      },
      "./mvnw verify",
    );
    expect(report.findings.some((f) => f.ruleId === "maven-parallel-not-enabled")).toBe(true);
  });

  test.each([
    "mvn -T 1C compile && mvn verify",
    "mvn verify; mvn -T 1C compile",
    "|\n          mvn -T 1C compile\n          mvn verify",
    "|\n          # mvn -T 1C compile\n          mvn verify",
  ])("reports the untuned Maven command in %s", async (command) => {
    const report = await scan(
      { "pom.xml": "<project><modules><module>a</module></modules></project>" },
      command,
    );
    expect(report.findings.some((finding) => finding.ruleId === "maven-parallel-not-enabled")).toBe(
      true,
    );
  });

  test("a tuned Maven job does not suppress an untuned job", async () => {
    const report = await scan({
      "pom.xml": "<project><modules><module>a</module></modules></project>",
      ".github/workflows/ci.yml": `on: push
jobs:
  tuned:
    runs-on: ubuntu-latest
    steps:
      - run: mvn -T 1C compile
  untuned:
    runs-on: ubuntu-latest
    steps:
      - run: mvn verify
`,
    });
    expect(report.findings.some((finding) => finding.ruleId === "maven-parallel-not-enabled")).toBe(
      true,
    );
  });

  test.each([
    "mvn -T 1C compile && mvn --threads=2 verify",
    "mvn --version\n          # mvn verify",
  ])("does not report tuned or inactive Maven lifecycle commands: %s", async (command) => {
    const report = await scan(
      { "pom.xml": "<project><modules><module>a</module></modules></project>" },
      `|\n          ${command}`,
    );
    expect(report.findings.some((finding) => finding.ruleId === "maven-parallel-not-enabled")).toBe(
      false,
    );
  });

  test.each([
    "// command: 'npm run old',",
    "/* command: 'npm run old', */",
    "note: \"command: 'npm run old'\",",
  ])("ignores inactive Playwright command text %s", async (inactive) => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { dev: "vite" } }),
        "playwright.config.ts": `// webServer: { command: 'npm run obsolete' }\nexport default { webServer: { ${inactive}\n command: 'pnpm run dev', url: 'http://localhost:3000' } };`,
      },
      "pnpm exec playwright test",
    );
    expect(report.findings.some((f) => f.ruleId === "playwright-config-uses-npm-run")).toBe(false);
  });

  test("reports an active Playwright command at its real source line", async () => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
        "playwright.config.ts":
          "export default { webServer: {\n // command: 'pnpm dev',\n 'command': 'npm run dev',\n url: 'http://localhost:3000'\n} };",
      },
      "pnpm exec playwright test",
    );
    const finding = report.findings.find((f) => f.ruleId === "playwright-config-uses-npm-run");
    expect(finding).toBeDefined();
    expect(finding?.location.line).toBe(3);
  });
});
