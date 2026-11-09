import { afterEach, expect, test } from "bun:test";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const cases = [
  ["next-cache-like", "missing-next-build-cache"],
  ["angular-cache-like", "missing-angular-cli-cache"],
  ["turbo-cache-like", "missing-turbo-cache"],
  ["hatch-without-uv-installer-like", "hatch-without-uv-installer"],
  ["pdm-without-use-uv-like", "pdm-without-use-uv"],
  ["eslint-concurrency-workflow-like", "prefer-eslint-concurrency"],
  ["prefer-oxlint-type-check-over-tsc-like", "prefer-oxlint-type-check-over-tsc"],
  ["native-build-risk-like", "native-dependency-may-fall-back-to-source-build"],
  ["nextjs-14-minor-like", "prefer-nextjs-14-minor-performance-milestone"],
  ["storybook-7-minor-like", "prefer-storybook-7-minor-performance-milestone"],
  ["tailwind-v3-upgrade-tool-like", "prefer-tailwind-v4-upgrade-tool"],
  ["cuda-torch-on-cpu-runner-like", "cuda-torch-install-on-cpu-runner"],
] as const;

function transform(value: unknown, variant: string): void {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "run" && typeof child === "string") {
      const step = value as Record<string, unknown>;
      if (variant === "printed") {
        step.run = `printf '%s\\n' '${child.replaceAll("'", "'\\''")}'`;
      }
      if (variant === "comment") {
        step.run = `${child
          .split("\n")
          .map((line) => `# ${line}`)
          .join("\n")}\necho done`;
      }
      if (variant === "label") {
        step.name = child;
        step.run = "echo done";
      }
      if (variant === "substitution") {
        step.run = `printf '%s' "$(${child}\n)"`;
      }
    } else {
      transform(child, variant);
    }
  }
}

for (const [fixture, ruleId] of cases) {
  test.each(["actual", "printed", "comment", "label", "substitution"])(
    `${ruleId} uses executable evidence: %s`,
    async (variant) => {
      const cwd = await tempDirs.create("apl-shell-remaining-");
      await cp(path.join(import.meta.dir, "fixtures", fixture), cwd, { recursive: true });
      const directory = path.join(cwd, ".github/workflows");
      for (const file of await readdir(directory)) {
        if (!/\.ya?ml$/.test(file)) {
          continue;
        }
        const filePath = path.join(directory, file);
        const config = parse(await readFile(filePath, "utf8"));
        transform(config, variant);
        await writeFile(filePath, stringify(config));
      }
      const report = await analyzeRepository({
        cwd,
        targetPath: ".",
        mode: "exploratory",
        topCount: 100,
      });
      expect(
        report.findings.some(
          (finding) => finding.ruleId === ruleId && finding.scope !== "repository",
        ),
      ).toBe(["actual", "substitution"].includes(variant));
    },
  );
}
