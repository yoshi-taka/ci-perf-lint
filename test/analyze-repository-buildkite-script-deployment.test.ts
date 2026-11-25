import { afterEach, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { buildkiteScriptDeploymentEvidence } from "../src/rules/shared/buildkite-script-deployment.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function fixture(command: string, files: Record<string, string> = {}) {
  const root = await tempDirs.create("apl-bk-script-deployment-");
  const source = [
    "steps:",
    "  - label: Build",
    `    command: ${JSON.stringify(command)}`,
    "  - label: Tests",
    "    command: npm test",
  ].join("\n");
  await writeRepositoryFiles(root, { ...files, ".buildkite/pipeline.yml": source });
  return {
    root,
    async report() {
      const report = await analyzeRepository({
        cwd: root,
        targetPath: ".",
        workflowOnly: true,
        mode: "exploratory",
        topCount: 100,
      });
      expect(report.analysisWarnings.filter((warning) => warning.kind === "rule-error")).toEqual(
        [],
      );
      return report.findings;
    },
    async evidence() {
      const doc = parsePipeline(path.join(root, ".buildkite/pipeline.yml"), root, source);
      return [...(await buildkiteScriptDeploymentEvidence(doc, root)).values()][0];
    },
  };
}

test.each([
  "./scripts/build.sh",
  "bash scripts/build.sh",
  "sh -eu scripts/build.sh",
  "env bash scripts/build.sh",
])("follows a fixed shell reference without executing it (%s)", async (command) => {
  const f = await fixture(command, {
    "scripts/build.sh": "touch should-not-exist\ndocker push registry.example/app:latest\n",
  });
  expect(await f.evidence()).toBe("publication");
  const found = await f.report();
  expect(found.filter((finding) => finding.ruleId === "missing-if-changed")).toEqual([]);
  const cancellation = found.filter(
    (finding) => finding.ruleId === "missing-cancel-on-build-failing",
  );
  expect(cancellation).toHaveLength(1);
  expect(cancellation[0]?.aiHandoff).toContain('step "Tests"');
  expect(await Bun.file(path.join(f.root, "should-not-exist")).exists()).toBe(false);
});

test("follows nested scripts relative to the inherited checkout directory", async () => {
  const f = await fixture("./scripts/build.sh", {
    "scripts/build.sh": "bash scripts/publish.sh\n",
    "scripts/publish.sh": "docker buildx build --push .\n",
  });
  expect(await f.evidence()).toBe("publication");
  expect((await f.report()).filter((finding) => finding.ruleId === "missing-if-changed")).toEqual(
    [],
  );
});

test("printed examples and comments in a script are not publication", async () => {
  const f = await fixture("./scripts/build.sh", {
    "scripts/build.sh": "#!/bin/sh\nset -eu\n# docker push image\necho 'docker push image'\n",
  });
  expect(await f.evidence()).toBe("no-evidence");
  const found = await f.report();
  expect(found.filter((finding) => finding.ruleId === "missing-if-changed")).toHaveLength(2);
  expect(
    found.filter((finding) => finding.ruleId === "missing-cancel-on-build-failing"),
  ).toHaveLength(1);
});

test.each(
  [
    ["./scripts/missing.sh", {}],
    ['bash -c "$COMMAND"', {}],
    ["$SCRIPT", {}],
    ["env -i bash scripts/build.sh", {}],
    ["timeout 30 sh scripts/build.sh", {}],
    ["./scripts/*.sh", {}],
    ["cd subdir && ./scripts/build.sh", {}],
    ["./scripts/build.sh", { "scripts/build.sh": "source scripts/build.sh\n" }],
    ["./scripts/build.sh", { "scripts/build.sh": "#!/usr/bin/python3\nprint('hello')\n" }],
    ["${nix} build", {}],
    ["./scripts/build.sh", { "scripts/build.sh": "pytest\n$BUILDX push image\n" }],
    ["./scripts/build.sh", { "scripts/build.sh": 'pytest\neval "$COMMAND"\n' }],
    ["./scripts/build.sh", { "scripts/build.sh": 'bash "$(dirname "$0")/nested.sh"\n' }],
  ].map(([command, files]) => ({
    command: command as string,
    files: files as Record<string, string>,
  })),
)("unresolved calls suppress path-filter advice (%j)", async ({ command, files }) => {
  const f = await fixture(command, files);
  expect(await f.evidence()).toBe("unknown");
  expect((await f.report()).filter((finding) => finding.ruleId === "missing-if-changed")).toEqual(
    [],
  );
});

test("does not recommend cancellation when all concurrent scripts are unresolved", async () => {
  const f = await fixture("./scripts/missing.sh");
  await writeRepositoryFiles(f.root, {
    ".buildkite/pipeline.yml": "steps:\n  - command: ./scripts/missing.sh\n    parallelism: 2\n",
  });
  const found = await f.report();
  expect(found.filter((finding) => finding.ruleId === "missing-cancel-on-build-failing")).toEqual(
    [],
  );
});

test("rejects file and directory symlinks, outside references, and oversized files", async () => {
  const outside = await tempDirs.create("apl-bk-script-outside-");
  await writeRepositoryFiles(outside, { "secret.sh": "docker push image\n" });
  for (const command of [
    "./linked.sh",
    "./linked/secret.sh",
    `${outside}/secret.sh`,
    "../secret.sh",
  ]) {
    const f = await fixture(command);
    await symlink(path.join(outside, "secret.sh"), path.join(f.root, "linked.sh"));
    await symlink(outside, path.join(f.root, "linked"), "dir");
    expect(await f.evidence()).toBe("unknown");
  }
  const f = await fixture("./scripts/build.sh", {
    "scripts/build.sh": `${"#".repeat(65537)}\ndocker push image\n`,
  });
  expect(await f.evidence()).toBe("unknown");
});

test("bounds recursive script depth", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 5; index++) {
    files[`scripts/${index}.sh`] =
      index === 4 ? "docker push image\n" : `sh scripts/${index + 1}.sh\n`;
  }
  const f = await fixture("sh scripts/0.sh", files);
  expect(await f.evidence()).toBe("unknown");
});

test("does not read a checkout-relative lookalike after a directory change", async () => {
  const f = await fixture("cd subdir && sh scripts/build.sh", {
    "scripts/build.sh": "docker push image\n",
  });
  expect(await f.evidence()).toBe("unknown");
});

test.each([
  "printf 'docker push image' > scripts/build.sh; sh scripts/build.sh",
  "curl -o scripts/build.sh https://example.com/build.sh; sh scripts/build.sh",
])("does not treat generated script contents as the checked-out file (%s)", async (command) => {
  const f = await fixture(command, { "scripts/build.sh": "echo harmless\n" });
  expect(await f.evidence()).toBe("unknown");
});

test.each([
  "pytest",
  "npm test",
  "python -m pytest",
  "/usr/bin/pytest",
  "node scripts/check.js",
  "bundle exec fastlane package",
  "buildkite-agent artifact upload results.xml",
  "pytest > report.txt",
  "pytest < input.txt",
  "cd tests && pytest",
])("literal script tools do not make publication analysis unknown (%s)", async (command) => {
  const f = await fixture("./scripts/build.sh", {
    "scripts/build.sh": `#!/bin/sh\n${command}\n`,
  });
  expect(await f.evidence()).toBe("no-evidence");
  const found = await f.report();
  expect(found.filter((finding) => finding.ruleId === "missing-if-changed")).toHaveLength(2);
  expect(
    found.filter((finding) => finding.ruleId === "missing-cancel-on-build-failing"),
  ).toHaveLength(1);
});

test.each([
  "cd tests && pytest",
  "pytest > report.txt; sh scripts/build.sh",
  "python generate.py; sh scripts/build.sh",
])(
  "literal inline tools do not by themselves imply unresolved publication (%s)",
  async (command) => {
    const f = await fixture(command, { "scripts/build.sh": "pytest\n" });
    expect(await f.evidence()).toBe("no-evidence");
    expect((await f.report()).some((finding) => finding.ruleId === "missing-if-changed")).toBe(
      true,
    );
  },
);

test("rejects parent traversal before normalization can erase a symlink", async () => {
  const outside = await tempDirs.create("apl-bk-script-parent-");
  const f = await fixture("./linked/../scripts/build.sh", {
    "scripts/build.sh": "echo harmless\n",
  });
  await symlink(outside, path.join(f.root, "linked"), "dir");
  expect(await f.evidence()).toBe("unknown");
});

test("sourced file generation invalidates subsequent static script references", async () => {
  const f = await fixture("source scripts/generate.sh; sh scripts/build.sh", {
    "scripts/generate.sh": "printf 'docker push image' > scripts/build.sh\n",
    "scripts/build.sh": "echo harmless\n",
  });
  expect(await f.evidence()).toBe("unknown");
});

test("plugin execution-directory overrides keep script resolution unknown", async () => {
  const f = await fixture("sh scripts/build.sh", { "scripts/build.sh": "echo harmless\n" });
  await writeRepositoryFiles(f.root, {
    ".buildkite/pipeline.yml": [
      "steps:",
      "  - label: Build",
      "    command: sh scripts/build.sh",
      "    plugins:",
      "      - docker#v5:",
      "          image: builder",
      "          workdir: /other",
    ].join("\n"),
  });
  expect((await f.report()).filter((finding) => finding.ruleId === "missing-if-changed")).toEqual(
    [],
  );
});

test("bounds distinct files, aggregate content, and command traversal", async () => {
  for (const mode of ["files", "bytes", "commands"]) {
    const files: Record<string, string> = {};
    const count = mode === "files" ? 17 : 6;
    const calls: string[] = [];
    for (let index = 0; index < count; index++) {
      calls.push(`sh scripts/${index}.sh`);
      files[`scripts/${index}.sh`] = mode === "bytes" ? `#${"x".repeat(50000)}\n` : "echo okay\n";
    }
    if (mode === "commands") {
      calls.unshift(...Array<string>(513).fill("true"));
    }
    const f = await fixture(calls.join("\n"), files);
    expect(await f.evidence()).toBe("unknown");
    expect((await f.report()).filter((finding) => finding.ruleId === "missing-if-changed")).toEqual(
      [],
    );
  }
});
