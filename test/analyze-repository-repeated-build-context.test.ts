import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "repeated-build-in-same-workflow";
type Step = Record<string, unknown>;
interface Job {
  "runs-on": unknown;
  steps: Step[];
  [key: string]: unknown;
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    "runs-on": "ubuntu-latest",
    steps: [
      { uses: "actions/checkout@v4" },
      { uses: "actions/setup-node@v4", with: { "node-version": 20 } },
      { run: "npm ci" },
      { run: "npm run build" },
    ],
    ...overrides,
  };
}

async function findings(jobs: Record<string, Job>, extra: Record<string, unknown> = {}) {
  const cwd = await tempDirs.create("apl-build-context-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({ name: "CI", on: "pull_request", ...extra, jobs }),
  });
  const report = await getWorkflowFocusedFixtureReport(cwd, { targetPath: ".", topCount: 100 });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("repeated builds require matching visible inputs", () => {
  test("reports identical builds as artifact-reuse candidates in strict mode", async () => {
    const matches = await findings({ lint: job(), test: job() });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("lint, test");
    expect(matches[0]?.suggestion).toContain("preserving each job's downstream tests");
    expect(matches[0]?.why).toContain("does not prove artifact equivalence");
  });

  test.each([
    [
      "different repository",
      (j: Job) => {
        j.steps[0]!.with = { repository: "eslint/json" };
      },
    ],
    [
      "different ref",
      (j: Job) => {
        j.steps[0]!.with = { ref: "main" };
      },
    ],
    [
      "different checkout path",
      (j: Job) => {
        j.steps[0]!.with = { path: "other" };
      },
    ],
    [
      "different checkout files",
      (j: Job) => {
        j.steps[0]!.with = { "sparse-checkout": "src" };
      },
    ],
    [
      "different task",
      (j: Job) => {
        j.steps[3]!.run = "npm run build:types";
      },
    ],
    [
      "different arguments",
      (j: Job) => {
        j.steps[3]!.run = "npm run build -- --mode production";
      },
    ],
    [
      "different working directory",
      (j: Job) => {
        j.steps[3]!["working-directory"] = "packages/json";
      },
    ],
    [
      "different job directory",
      (j: Job) => {
        j.defaults = { run: { "working-directory": "packages/json" } };
      },
    ],
    [
      "different runner",
      (j: Job) => {
        j["runs-on"] = "ubuntu-24.04-arm";
      },
    ],
    [
      "different container",
      (j: Job) => {
        j.container = "node:20";
      },
    ],
    [
      "different services",
      (j: Job) => {
        j.services = { db: { image: "postgres:16" } };
      },
    ],
    [
      "different runtime",
      (j: Job) => {
        j.steps[1]!.with = { "node-version": 22 };
      },
    ],
    [
      "different install",
      (j: Job) => {
        j.steps[2]!.run = "npm install";
      },
    ],
    [
      "different build environment",
      (j: Job) => {
        j.steps[3]!.env = { NODE_ENV: "production" };
      },
    ],
    [
      "different job environment",
      (j: Job) => {
        j.env = { BUILD_TARGET: "browser" };
      },
    ],
    [
      "different shell",
      (j: Job) => {
        j.steps[3]!.shell = "sh";
      },
    ],
    [
      "different dependency path",
      (j: Job) => {
        j.needs = "prepare";
      },
    ],
    [
      "prior source mutation",
      (j: Job) => {
        j.steps.splice(3, 0, { run: "git apply custom.patch" });
      },
    ],
    [
      "unknown runner",
      (j: Job) => {
        j["runs-on"] = "${{ inputs.runner }}";
      },
    ],
    [
      "self hosted runner",
      (j: Job) => {
        j["runs-on"] = ["self-hosted", "linux"];
      },
    ],
    [
      "unknown ref",
      (j: Job) => {
        j.steps[0]!.with = { ref: "${{ inputs.ref }}" };
      },
    ],
    [
      "unknown env",
      (j: Job) => {
        j.env = { BUILD_TARGET: "${{ inputs.target }}" };
      },
    ],
    [
      "shell variable",
      (j: Job) => {
        j.steps[3]!.run = "npm run build -- $TARGET";
      },
    ],
    [
      "exported shell state",
      (j: Job) => {
        j.steps.splice(3, 0, { run: 'echo "TARGET=web" >> "$GITHUB_ENV"' });
      },
    ],
    [
      "opaque action",
      (j: Job) => {
        j.steps.splice(3, 0, { uses: "./.github/actions/prepare" });
      },
    ],
    [
      "conditional setup",
      (j: Job) => {
        j.steps[1]!.if = "inputs.setup";
      },
    ],
    [
      "conditional build",
      (j: Job) => {
        j.steps[3]!.if = "inputs.build";
      },
    ],
    [
      "conditional job",
      (j: Job) => {
        j.if = "github.ref == 'refs/heads/main'";
      },
    ],
    [
      "missing checkout",
      (j: Job) => {
        j.steps.shift();
      },
    ],
    [
      "second checkout",
      (j: Job) => {
        j.steps.splice(1, 0, {
          uses: "actions/checkout@v4",
          with: { repository: "eslint/json", path: "json" },
        });
      },
    ],
    [
      "source cache",
      (j: Job) => {
        j.steps.splice(3, 0, {
          uses: "actions/cache@v4",
          with: { path: "src", key: "${{ github.sha }}" },
        });
      },
    ],
  ])("excludes %s", async (_name, modify) => {
    const other = job();
    modify(other);
    expect(await findings({ first: job(), other })).toHaveLength(0);
  });

  test("the ESLint external-repository builds are not one repeated build", async () => {
    const visitorKeys = job();
    visitorKeys.steps[0]!.with = { repository: "eslint/js", path: "eslint-js" };
    visitorKeys.steps[3] = {
      run: "npm run build:types --workspace eslint-visitor-keys",
      "working-directory": "eslint-js",
    };
    const json = job();
    json.steps[0]!.with = { repository: "eslint/json", path: "json" };
    json.steps[3] = { run: "npm run build", "working-directory": "json" };
    expect(await findings({ visitorKeys, json })).toHaveLength(0);
  });

  test("groups only matching jobs, not every user of the same build tool", async () => {
    const unrelated = job();
    unrelated.steps[3]!.run = "npm run build:types";
    const matches = await findings({ first: job(), unrelated, second: job() });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("first, second");
    expect(matches[0]?.message).not.toContain("unrelated");
  });

  test("retains separate groups for distinct matching commands", async () => {
    const typed = () => {
      const j = job();
      j.steps[3]!.run = "npm run build:types";
      return j;
    };
    expect(await findings({ a: job(), b: job(), c: typed(), d: typed() })).toHaveLength(2);
  });

  test("does not depend on unrelated jobs being nearby", async () => {
    const between = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `noop${index}`,
        job({ steps: [{ run: "echo unrelated" }] }),
      ]),
    );
    expect(await findings({ first: job(), ...between, last: job() })).toHaveLength(1);
  });

  test("compares effective defaults and environment in canonical key order", async () => {
    const first = job({
      env: { A: "one", B: "two" },
      defaults: { run: { "working-directory": "app" } },
    });
    const second = job({ env: { B: "two", A: "one" } });
    second.steps[2]!["working-directory"] = "app";
    second.steps[3]!["working-directory"] = "app";
    expect(await findings({ first, second })).toHaveLength(1);
  });

  test("does not match unresolved expressions even when their text is identical", async () => {
    const unknown = () => job({ env: { TARGET: "${{ github.job }}" } });
    expect(await findings({ first: unknown(), second: unknown() })).toHaveLength(0);
  });

  test("ignores an optional outside-checkout dependency cache, not build inputs", async () => {
    const cached = job();
    cached.steps[1]!.with = { "node-version": 20, cache: "npm" };
    cached.steps.splice(3, 0, {
      uses: "actions/cache@v4",
      with: { path: "~/.npm", key: "${{ hashFiles('package-lock.json') }}" },
    });
    expect(await findings({ cached, plain: job() })).toHaveLength(1);
  });

  test("later opaque steps do not invalidate an already matched build", async () => {
    const first = job();
    first.steps.push({ uses: "./.github/actions/test" });
    expect(await findings({ first, second: job() })).toHaveLength(1);
  });

  test("does not combine multiple builds in one job or matrix variants", async () => {
    const single = job();
    single.steps.push({ run: "npm run build" });
    expect(await findings({ single })).toHaveLength(0);
    const matrix = () => job({ strategy: { matrix: { variant: ["a", "b"] } } });
    expect(await findings({ a: matrix(), b: matrix() })).toHaveLength(0);
  });
});
