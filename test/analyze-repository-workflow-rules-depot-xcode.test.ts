import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { fixtures } from "./fixtures.ts";
import type { Diagnostic } from "../src/types.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const xcodeRun = "xcodebuild -scheme App build";
const runner = "depot-macos-26";

interface ScanOptions {
  steps: readonly Record<string, unknown>[];
  id: string;
  job?: Record<string, unknown>;
  workflowEnv?: Record<string, unknown>;
  mode?: "strict" | "exploratory";
  directory?: ".depot" | ".github";
}

type ScanCase = { name: string; options: Partial<ScanOptions> };

async function scan(options: ScanOptions): Promise<Diagnostic[]> {
  const cwd = await tempDirs.create("apl-depot-xcode-");
  await writeRepositoryFiles(cwd, {
    [`${options.directory ?? ".depot"}/workflows/ci.yml`]: stringify({
      name: "Xcode",
      on: "push",
      ...(options.workflowEnv ? { env: options.workflowEnv } : {}),
      jobs: {
        build: { "runs-on": runner, ...options.job, steps: options.steps },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: options.mode ?? "strict", topCount: 1000 },
    { id: options.id, severity: options.mode === "exploratory" ? "suggestion" : "warning" },
  );
  return report.findings.filter((finding) => finding.ruleId === options.id);
}

const overrideId = "depot-xcode-xcconfig-override";
const derivedId = "depot-xcode-deriveddata-restore";

test("fixtures: override fires, intentional opt-out does not", async () => {
  for (const [fixture, count] of [
    [fixtures.depotXcodeXcconfigOverrideLike, 1],
    [fixtures.depotXcodeXcconfigOverrideOk, 0],
  ] as const) {
    const report = await analyzeRepositoryForRule(
      { cwd: fixture, targetPath: ".", mode: "strict", topCount: 1000 },
      { id: overrideId, severity: "warning" },
    );
    expect(report.findings.filter((finding) => finding.ruleId === overrideId)).toHaveLength(count);
  }
});

test.each<ScanCase>([
  { name: "workflow env", options: { workflowEnv: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } } },
  { name: "job env", options: { job: { env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } } } },
  {
    name: "step env",
    options: { steps: [{ run: xcodeRun, env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } }] },
  },
  {
    name: "export",
    options: { steps: [{ run: `export XCODE_XCCONFIG_FILE=Custom.xcconfig\n${xcodeRun}` }] },
  },
  {
    name: "env prefix on the command",
    options: { steps: [{ run: `env XCODE_XCCONFIG_FILE=Custom.xcconfig ${xcodeRun}` }] },
  },
  {
    name: "GITHUB_ENV",
    options: {
      steps: [
        { run: `echo "XCODE_XCCONFIG_FILE=Custom.xcconfig" >> $GITHUB_ENV` },
        { run: xcodeRun },
      ],
    },
  },
])("XCODE_XCCONFIG_FILE set via $name fires", async ({ options }) => {
  const findings = await scan({
    ...options,
    id: overrideId,
    steps: options.steps ?? [{ run: xcodeRun }],
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("XCODE_XCCONFIG_FILE");
  expect(findings[0]?.why).toContain("Depot Cache");
});

test("the finding points at the earlier GITHUB_ENV write, not the xcodebuild step", async () => {
  const cwd = await tempDirs.create("apl-depot-xcode-location-");
  await writeRepositoryFiles(cwd, {
    ".depot/workflows/ci.yml": [
      "name: Xcode",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: depot-macos-26",
      "    steps:",
      '      - run: echo "XCODE_XCCONFIG_FILE=Custom.xcconfig" >> $GITHUB_ENV',
      "      - run: xcodebuild build",
    ].join("\n"),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "strict", topCount: 1000 },
    { id: overrideId, severity: "warning" },
  );
  const findings = report.findings.filter((finding) => finding.ruleId === overrideId);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.line).toBe(7);
});

test.each<ScanCase>([
  { name: "no override", options: { steps: [{ run: xcodeRun }] } },
  {
    name: "job opt-out",
    options: {
      job: { env: { DEPOT_XCODE_CACHE_ENABLED: 0, XCODE_XCCONFIG_FILE: "Custom.xcconfig" } },
      steps: [{ run: xcodeRun }],
    },
  },
  {
    name: "workflow opt-out string",
    options: {
      workflowEnv: { DEPOT_XCODE_CACHE_ENABLED: "0", XCODE_XCCONFIG_FILE: "Custom.xcconfig" },
      steps: [{ run: xcodeRun }],
    },
  },
  {
    name: "exported opt-out",
    options: {
      steps: [
        { run: `export DEPOT_XCODE_CACHE_ENABLED=0\nexport XCODE_XCCONFIG_FILE=Custom.xcconfig` },
        { run: xcodeRun },
      ],
    },
  },
  {
    name: "GITHUB_ENV opt-out",
    options: {
      steps: [
        {
          run: `echo "DEPOT_XCODE_CACHE_ENABLED=0" >> $GITHUB_ENV\necho "XCODE_XCCONFIG_FILE=Custom.xcconfig" >> $GITHUB_ENV`,
        },
        { run: xcodeRun },
      ],
    },
  },
  {
    name: "non-Depot macOS",
    options: {
      job: { "runs-on": "macos-15" },
      steps: [{ run: xcodeRun, env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } }],
    },
  },
  {
    name: "Depot Linux",
    options: {
      job: { "runs-on": "depot-ubuntu-24.04" },
      steps: [{ run: xcodeRun, env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } }],
    },
  },
  {
    name: "expression label",
    options: {
      job: { "runs-on": "${{ matrix.runner }}" },
      steps: [{ run: xcodeRun, env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } }],
    },
  },
  {
    name: "step env on another step",
    options: {
      steps: [
        { run: "echo ready", env: { XCODE_XCCONFIG_FILE: "Custom.xcconfig" } },
        { run: xcodeRun },
      ],
    },
  },
  {
    name: "export on another step",
    options: {
      steps: [{ run: "export XCODE_XCCONFIG_FILE=Custom.xcconfig" }, { run: xcodeRun }],
    },
  },
  {
    name: "GITHUB_ENV after the build",
    options: {
      steps: [
        { run: xcodeRun },
        { run: `echo "XCODE_XCCONFIG_FILE=Custom.xcconfig" >> $GITHUB_ENV` },
      ],
    },
  },
  {
    name: "export after xcodebuild in the same script",
    options: { steps: [{ run: `${xcodeRun}\nexport XCODE_XCCONFIG_FILE=Custom.xcconfig` }] },
  },
])("override rule excludes $name", async ({ options }) => {
  expect(
    await scan({
      ...options,
      id: overrideId,
      mode: "exploratory",
      steps: options.steps ?? [{ run: xcodeRun }],
    }),
  ).toHaveLength(0);
});

const derivedRestore = {
  uses: "actions/cache@v4",
  with: { path: "~/Library/Developer/Xcode/DerivedData", key: "derived-v1" },
};

test("fixtures: DerivedData restore fires, SwiftPM-only cache does not", async () => {
  for (const [fixture, count] of [
    [fixtures.depotXcodeDeriveddataRestoreLike, 1],
    [fixtures.depotXcodeDeriveddataRestoreOk, 0],
  ] as const) {
    const report = await analyzeRepositoryForRule(
      { cwd: fixture, targetPath: ".", mode: "exploratory", topCount: 1000 },
      { id: derivedId, severity: "suggestion" },
    );
    expect(report.findings.filter((finding) => finding.ruleId === derivedId)).toHaveLength(count);
  }
});

test("DerivedData restore before the build fires with advisory wording", async () => {
  const findings = await scan({
    id: derivedId,
    mode: "exploratory",
    steps: [derivedRestore, { run: xcodeRun }],
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("suggestion");
  expect(findings[0]?.why).toContain("might not use Depot Cache");
});

test("actions/cache/restore before the build also fires", async () => {
  expect(
    await scan({
      id: derivedId,
      mode: "exploratory",
      steps: [{ ...derivedRestore, uses: "actions/cache/restore@v4" }, { run: xcodeRun }],
    }),
  ).toHaveLength(1);
});

test.each<ScanCase>([
  { name: "restore after the build", options: { steps: [{ run: xcodeRun }, derivedRestore] } },
  {
    name: "SwiftPM-only cache",
    options: {
      steps: [
        { ...derivedRestore, with: { path: "~/.cache/org.swift.swiftpm", key: "spm" } },
        { run: xcodeRun },
      ],
    },
  },
  {
    name: "xcodebuild caching disabled",
    options: {
      steps: [derivedRestore, { run: "xcodebuild COMPILATION_CACHE_ENABLE_CACHING=NO build" }],
    },
  },
  {
    name: "job opt-out",
    options: {
      job: { env: { DEPOT_XCODE_CACHE_ENABLED: 0 } },
      steps: [derivedRestore, { run: xcodeRun }],
    },
  },
  {
    name: "conditional restore",
    options: {
      steps: [{ ...derivedRestore, if: "github.ref == 'refs/heads/main'" }, { run: xcodeRun }],
    },
  },
  {
    name: "non-Depot macOS",
    options: { job: { "runs-on": "macos-15" }, steps: [derivedRestore, { run: xcodeRun }] },
  },
])("DerivedData rule excludes $name", async ({ options }) => {
  expect(
    await scan({
      ...options,
      id: derivedId,
      mode: "exploratory",
      steps: options.steps ?? [{ run: xcodeRun }],
    }),
  ).toHaveLength(0);
});
