import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(commands: string[], allPlatforms = false) {
  const cwd = await tempDirs.create("apl-shell-rule-migration-");
  await writeRepositoryFiles(cwd, {
    "Cargo.toml": '[package]\nname = "example"\nversion = "0.1.0"\nedition = "2021"\n',
    "src/lib.rs": "",
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          steps: commands.map((run) => ({ name: "Run", run })),
        },
      },
    }),
    ...(allPlatforms
      ? {
          ".buildkite/pipeline.yml": stringify({
            steps: commands.map((command) => ({ label: "check", command })),
          }),
          ".gitlab-ci.yml": stringify({ check: { script: commands } }),
          ".circleci/config.yml": stringify({
            version: 2.1,
            jobs: {
              check: {
                docker: [{ image: "cimg/base:stable" }],
                steps: commands.map((command) => ({ run: command })),
              },
            },
          }),
        }
      : {}),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.scope !== "repository");
}

const cases = [
  ["npm-audit-in-ci", ["npm audit"]],
  ["unnecessary-npm-global-upgrade-before-npm-install", ["npm install -g npm@latest", "npm ci"]],
  ["wasteful-npm-global-install", ["npm install -g npm@latest", "pnpm install"]],
  ["prefer-nextest-for-heavy-rust-tests", ["cargo test --workspace"]],
  ["tox-without-tox-uv", ["tox"]],
  ["go-test-repeats-vet-after-go-vet", ["go vet ./...", "go test ./..."]],
  ["go-build-before-race-test", ["go build ./...", "go test -race ./..."]],
  ["go-test-broad-package-serial-p-one", ["go test -p 1 ./..."]],
] as const;

test.each(cases)("%s uses command evidence, not printed text", async (ruleId, commands) => {
  for (const variant of ["actual", "echo", "printf", "comment", "substitution"]) {
    // Build equivalence intentionally abstains on captured/subshell builds.
    if (ruleId === "go-build-before-race-test" && variant === "substitution") {
      continue;
    }
    const text = commands.map((command) => {
      if (variant === "echo") {
        return `echo '${command}'`;
      }
      if (variant === "printf") {
        return `printf '%s\\n' '${command}'`;
      }
      if (variant === "comment") {
        return `# ${command}\necho done`;
      }
      if (variant === "substitution") {
        return `echo "$( ${command} )"`;
      }
      return command;
    });
    const findings = await scan(text);
    expect(findings.some((finding) => finding.ruleId === ruleId)).toBe(
      variant === "actual" || variant === "substitution",
    );
  }
});

test.each(["echo 'npm publish'", "printf '%s' 'pnpm install'", "# npm publish\necho done"])(
  "printed exemptions do not hide a real npm upgrade: %s",
  async (display) => {
    const findings = await scan(["npm install -g npm@latest", "npm ci", display]);
    expect(
      findings.some(
        (finding) => finding.ruleId === "unnecessary-npm-global-upgrade-before-npm-install",
      ),
    ).toBe(true);
  },
);

test.each(["command npm publish", "exec npm publish", "time npm publish", "env CI=1 npm publish"])(
  "real compatibility clients retain their exemption: %s",
  async (command) => {
    const findings = await scan(["npm install -g npm@latest", "pnpm install", command]);
    expect(findings.some((finding) => finding.ruleId === "wasteful-npm-global-install")).toBe(
      false,
    );
  },
);

test.each(["echo 'cargo nextest run'", "printf '%s' 'cargo nextest run'", "# cargo nextest run"])(
  "nextest output does not hide cargo test: %s",
  async (display) => {
    const findings = await scan(["cargo test --workspace", display]);
    expect(
      findings.some((finding) => finding.ruleId === "prefer-nextest-for-heavy-rust-tests"),
    ).toBe(true);
  },
);

test("real nextest installation retains its exemption", async () => {
  const findings = await scan(["cargo install cargo-nextest --locked", "cargo test --workspace"]);
  expect(findings.some((finding) => finding.ruleId === "prefer-nextest-for-heavy-rust-tests")).toBe(
    false,
  );
});

test("a crate name used as an install option is not nextest adoption", async () => {
  const findings = await scan([
    "cargo install other --root cargo-nextest",
    "cargo test --workspace",
  ]);
  expect(findings.some((finding) => finding.ruleId === "prefer-nextest-for-heavy-rust-tests")).toBe(
    true,
  );
});

test.each([
  "echo 'pip install tox-uv'",
  "printf '%s' 'pip install tox-uv'",
  "# pip install tox-uv",
  "pip install other --cache-dir tox-uv",
])("tox-uv setup must be an actual package install: %s", async (command) => {
  const findings = await scan([command, "tox"]);
  expect(findings.some((finding) => finding.ruleId === "tox-without-tox-uv")).toBe(true);
});

test.each(["pip install tox tox-uv", "uv pip install tox-uv==1.0", "python -m pip install tox-uv"])(
  "real tox-uv setup remains recognized: %s",
  async (command) => {
    const findings = await scan([command, "tox"]);
    expect(findings.some((finding) => finding.ruleId === "tox-without-tox-uv")).toBe(false);
  },
);

test("Go flags cannot be borrowed from output or option values", async () => {
  const findings = await scan([
    "go build ./...",
    "go test -run '-race' ./...",
    "echo '-race -p 1 ./...'",
  ]);
  expect(
    findings.some((finding) =>
      ["go-build-before-race-test", "go-test-broad-package-serial-p-one"].includes(finding.ruleId),
    ),
  ).toBe(false);
});

test("one vet-disabled command does not hide another real test", async () => {
  const findings = await scan(["go vet ./...", "go test -vet=off ./...; go test ./..."]);
  expect(findings.some((finding) => finding.ruleId === "go-test-repeats-vet-after-go-vet")).toBe(
    true,
  );
});

test.each([
  ["unnecessary-npm-global-upgrade-before-npm-install", ["npm install -g npm@latest", "npm ci"]],
  ["wasteful-npm-global-install", ["npm install -g npm@latest", "pnpm install"]],
] as const)("all CI formats share npm execution evidence: %s", async (ruleId, commands) => {
  for (const variant of ["actual", "echo", "printf", "comment"]) {
    const text = commands.map((command) =>
      variant === "actual"
        ? command
        : variant === "comment"
          ? `# ${command}\necho done`
          : `${variant} '%s' '${command}'`,
    );
    const findings = await scan(text, true);
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(
      variant === "actual" ? 4 : 0,
    );
  }
});
