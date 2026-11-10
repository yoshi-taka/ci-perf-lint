import { expect, test } from "bun:test";
import type { Diagnostic } from "../src/types.ts";
import {
  shellInvocations,
  shellNonDisplayInvocations,
} from "../src/rules/shared/shell-invocations.ts";
import { toolInvocations } from "../src/rules/shared/tool-command-evidence.ts";
import { declaredShellEnvironmentValues } from "../src/rules/shared/shell-environment-evidence.ts";
import {
  shellDataVariants,
  assertShellEvidenceReport,
  shellEvidenceProjection,
  type ShellEvidenceScenario,
} from "./shell-evidence-metamorphic.ts";

test.each([
  "npm install",
  "printf '%s' \"$(npm install)\"",
  "x='quoted'\n# data\n`npm install`",
  "npm install\r\n$(npm install)",
])("literal generators keep quotes/substitutions/comments as data: %s", (command) => {
  for (const variant of shellDataVariants(command)) {
    expect(toolInvocations(variant.run).some(([tool]) => tool === "npm")).toBe(false);
  }
});

test.each(["echo", "printf", "/bin/echo", "/usr/bin/echo", "/bin/printf", "/usr/bin/printf"])(
  "display filtering rejects %s but retains actual substitutions",
  (tool) => {
    expect(shellNonDisplayInvocations(`${tool} 'npm install'`)).toEqual([]);
    expect(shellNonDisplayInvocations(`${tool} "$(npm install)"`)).toEqual([["npm", "install"]]);
  },
);

test.each([
  ["npm install", ["npm", "install"]],
  ["env CI=1 sudo -n npm install", ["npm", "install"]],
  ["if npm install; then echo done; fi", ["npm", "install"]],
  ["command npm install", ["npm", "install"]],
  ["exec npm install", ["npm", "install"]],
  ["nohup npm install", ["npm", "install"]],
  ["time npm install", ["npm", "install"]],
  ["npx --yes oxlint .", ["oxlint", "."]],
  ["pnpm exec oxlint .", ["oxlint", "."]],
  ["uv run ruff check .", ["ruff", "check", "."]],
  ["python3 -m ruff check .", ["ruff", "check", "."]],
] as const)("wrappers retain the command in %s", (text, words) => {
  expect(shellInvocations(text)).toContainEqual([...words]);
});

test("raw and tool-unwrapped views remain distinct", () => {
  expect(shellInvocations("npx oxlint .", false)).toEqual([["npx", "oxlint", "."]]);
  expect(shellInvocations("npx oxlint .", true)).toEqual([["oxlint", "."]]);
});

test.each(["npx", "pnpx", "bunx", "uvx"])(
  "single-tool runner %s unwraps only recognized prefix options",
  (runner) => {
    for (const option of ["", "--yes ", "-y ", "--no-install ", "-- "]) {
      expect(shellInvocations(`${runner} ${option}oxlint .`)).toEqual([["oxlint", "."]]);
    }
    expect(shellInvocations(`${runner} --unknown oxlint .`)).toEqual([]);
    expect(shellInvocations(runner)).toEqual([]);
  },
);

for (const runner of ["pnpm", "yarn", "bun"]) {
  test.each(["exec", "dlx", "run", "x"])(`${runner} %s retains the selected tool`, (action) => {
    expect(shellInvocations(`${runner} ${action} oxlint .`)).toEqual([["oxlint", "."]]);
    expect(shellInvocations(`${runner} ${action}`)).toEqual([]);
  });
}

test.each(["--yes", "-y", "--no", "--"])("npm exec unwraps its %s option", (option) => {
  expect(shellInvocations(`npm exec ${option} oxlint .`)).toEqual([["oxlint", "."]]);
});

test.each(["python", "python3", "python3.13"])("module invocation stays owned by %s", (python) => {
  expect(shellInvocations(`${python} -m ruff check .`)).toEqual([["ruff", "check", "."]]);
  expect(shellInvocations(`${python} script.py ruff`)[0]?.[0]).toBe(python);
});

test("uv tool run is not confused with a direct uv subcommand", () => {
  expect(shellInvocations("uv tool run ruff check .")).toEqual([["ruff", "check", "."]]);
  expect(shellInvocations("uv sync")).toEqual([["uv", "sync"]]);
});

test.each(["if", "then", "elif", "else", "while", "until", "do", "!", "{"])(
  "control-segment prefix %s is not the executable",
  (prefix) => {
    expect(shellInvocations(`${prefix} npm install`)).toEqual([["npm", "install"]]);
  },
);

test("assignments and incomplete/unsupported wrappers do not invent a tool", () => {
  expect(shellInvocations("BUILD_2=yes npm install")).toEqual([["npm", "install"]]);
  expect(shellInvocations("2BUILD=yes npm install")[0]?.[0]).toBe("2BUILD=yes");
  expect(shellInvocations("env BUILD_2=yes")).toEqual([]);
  expect(shellInvocations("sudo -n BUILD_2=yes npm install")).toEqual([["npm", "install"]]);
  expect(shellInvocations("sudo npm install")).toEqual([["npm", "install"]]);
  expect(shellInvocations("sudo --user=root npm install")).toEqual([]);
  expect(shellInvocations("command --version npm install")).toEqual([
    ["command", "--version", "npm", "install"],
  ]);
  expect(shellInvocations("command")).toEqual([["command"]]);
  expect(shellInvocations("   ")).toEqual([]);
});

test("environment-file writes are not thrown away as harmless display", () => {
  expect(declaredShellEnvironmentValues("echo 'COUNT=4'")).toEqual({});
  expect(declaredShellEnvironmentValues("echo 'COUNT=4' >> $GITHUB_ENV")).toEqual({ COUNT: "4" });
});

test("raw view strips execution prefixes and omits exhausted commands", () => {
  expect(shellInvocations("env CI=1 sudo -n npm install", false)).toEqual([["npm", "install"]]);
  for (const text of ["env", "CI=1", "sudo", "sudo -n", "sudo A=1", "if"]) {
    expect(shellInvocations(text, false)).toEqual([]);
    expect(shellInvocations(text)).toEqual([]);
  }
});

test("display filtering defaults to preserving tool runners", () => {
  expect(shellNonDisplayInvocations("npx oxlint .")).toEqual([["npx", "oxlint", "."]]);
  expect(shellNonDisplayInvocations("npx oxlint .", true)).toEqual([["oxlint", "."]]);
});

test.each(["xpython", "python-tools", "python2", "python3.x", "python3.13x"])(
  "Python-like executable %s is not a recognized module runner",
  (runner) => {
    expect(shellInvocations(`${runner} -m ruff check .`)).toEqual([
      [runner, "-m", "ruff", "check", "."],
    ]);
  },
);

test.each([
  "other exec oxlint .",
  "other run oxlint .",
  "other tool run oxlint .",
  "uv other run oxlint .",
  "uv tool list oxlint",
  "uv tool",
  "npm run build",
  "pnpm install",
  "yarn install",
  "bun install",
  "other -m ruff",
  "sudo 2BUILD=yes npm install",
])("unrecognized runner shape stays unwrapped: %s", (text) => {
  const words = text.split(" ");
  expect(shellInvocations(text)).toEqual([words[0] === "sudo" ? words.slice(1) : words]);
});

test("single-letter assignments remain valid after sudo", () => {
  expect(shellInvocations("sudo A=1 _=2 npm install")).toEqual([["npm", "install"]]);
});

test.each(["env CI=1", "sudo -n", "command"])(
  "tool-runner offsets remain correct after %s",
  (prefix) => {
    expect(shellInvocations(`${prefix} npm exec oxlint .`)).toEqual([["oxlint", "."]]);
    expect(shellInvocations(`${prefix} uv tool run ruff check .`)).toEqual([
      ["ruff", "check", "."],
    ]);
  },
);

test.each(["cat <<'EOF'\nnpm install\nEOF", "npm install <<<'data'"])(
  "input documents stay conservatively opaque: %s",
  (text) => {
    expect(shellInvocations(text)).toEqual([]);
    expect(shellInvocations(text, false)).toEqual([]);
  },
);

const expectation = { id: "sample", severity: "warning" as const, count: 1, literalCount: 0 };
test("an always-empty detector cannot pass a positive baseline", () => {
  expect(() =>
    assertShellEvidenceReport({ findings: [], analysisWarnings: [] }, [expectation]),
  ).toThrow();
});
test.each([
  "gate-skipped",
  "rule-error",
  "collector-error",
  "parser-error",
  "max-findings-hit",
] as const)("a skipped/broken/truncated negative control fails: %s", (kind) => {
  expect(() =>
    assertShellEvidenceReport(
      { findings: [], analysisWarnings: [{ kind, source: "sample", message: "fixture" }] },
      [expectation],
      true,
    ),
  ).toThrow();
});

const finding: Diagnostic = {
  ruleId: "sample",
  severity: "warning",
  confidence: "medium",
  scope: "workflow",
  docsPath: "docs/rules/sample.md",
  workflow: ".github/workflows/ci.yml",
  location: { path: ".github/workflows/ci.yml", line: 1, column: 1 },
  message: "sample",
  why: "because",
  suggestion: "fix",
  measurementHint: "measure",
  aiHandoff: "review",
  score: 50,
};
const scenario: ShellEvidenceScenario = {
  name: "fixture",
  command: "sample",
  build: () => ({}),
  expectations: [expectation],
};
test("projection ignores line offsets, not severity/score/context", () => {
  const baseline = shellEvidenceProjection({ findings: [finding] }, scenario);
  expect(
    shellEvidenceProjection(
      { findings: [{ ...finding, location: { ...finding.location, line: 10, column: 4 } }] },
      scenario,
    ),
  ).toEqual(baseline);
  for (const changed of [
    { ...finding, severity: "suggestion" as const },
    { ...finding, score: 49 },
    { ...finding, why: "different context" },
  ]) {
    expect(shellEvidenceProjection({ findings: [changed] }, scenario)).not.toEqual(baseline);
  }
});
