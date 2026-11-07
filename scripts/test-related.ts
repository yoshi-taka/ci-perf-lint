import { execFileSync } from "node:child_process";
import { Glob } from "bun";

interface Selection {
  tests: Set<string>;
  broad: boolean;
  reason: string;
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function changedFiles(base: string): string[] {
  const tracked = run("git", ["diff", "--name-only", base, "--"]);
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")])].filter(Boolean);
}

function testFilesMatching(needle: string): string[] {
  const output = run("rg", ["--files-with-matches", "--fixed-strings", needle, "test"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function allTests(): string[] {
  return [...new Glob("test/**/*.test.ts").scanSync({ cwd: process.cwd() })];
}

const corePrefixes = [
  "src/repo.ts",
  "src/types.ts",
  "src/workflow.ts",
  "src/main.ts",
  "src/cli.ts",
  "src/rule-engine/",
  "src/rules/index.ts",
  "src/rules/shared/",
  "src/repository-scan-context.ts",
  "src/repository-signals",
  "src/reification.ts",
  "src/lazy-node-record.ts",
];

function select(files: string[]): Selection {
  const tests = new Set<string>();
  let broad = false;
  let reason = "";
  for (const file of files) {
    if (file.endsWith(".test.ts")) {
      tests.add(file);
      continue;
    }
    if (file.startsWith("docs/") || file.endsWith(".md") || file === "LICENSE") {
      continue;
    }
    if (["package.json", "bun.lock", "tsconfig.json", "bunfig.toml"].includes(file)) {
      broad = true;
      reason = `${file} affects the whole test environment`;
      continue;
    }
    if (file.startsWith("src/yaml-") || file === "src/yaml.ts") {
      for (const test of allTests()) {
        if (test.includes("yaml")) {
          tests.add(test);
        }
      }
      continue;
    }
    if (corePrefixes.some((prefix) => file === prefix || file.startsWith(prefix))) {
      broad = true;
      reason = `${file} is shared core`;
      continue;
    }
    const stem = file.split("/").at(-1)?.replace(/\.ts$/, "");
    if (stem) {
      const matches = testFilesMatching(stem);
      if (matches.length > 0) {
        for (const match of matches) {
          tests.add(match);
        }
        continue;
      }
      if (file.startsWith("src/repository-diagnostics/")) {
        broad = true;
        reason = `${file} has no directly named test`;
        continue;
      }
    }
  }
  if (broad) {
    for (const test of allTests()) {
      if (
        test.includes("analyze-repository") ||
        test.includes("reporters") ||
        test === "test/cli.test.ts"
      ) {
        tests.add(test);
      }
    }
  }
  return { tests, broad, reason };
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const all = args.includes("--all");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1]! : "HEAD";
const explicit = args.filter((arg, index) => {
  if (arg.startsWith("--")) {
    return false;
  }
  return baseIndex < 0 || index !== baseIndex + 1;
});
const files = explicit.length > 0 ? explicit : changedFiles(base);

if (all || files.length === 0) {
  console.log(
    all ? "--all requested: running the full suite." : "No changed files: running the full suite.",
  );
  if (!listOnly) {
    const child = Bun.spawn(["bun", "test", "--parallel", "--timings=.bun-test-timings.json"], {
      env: { ...process.env, AGENT: "1" },
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await child.exited);
  }
  process.exit(0);
}

const selection = select(files);
const tests = [...selection.tests].sort();
if (selection.broad) {
  console.log(`Broad selection (${selection.reason}).`);
}
console.log(`Changed files: ${files.length}; selected tests: ${tests.length}`);
for (const test of tests) {
  console.log(`  ${test}`);
}
if (tests.length === 0) {
  console.log("No related tests found; run the full suite before committing.");
  process.exit(0);
}
if (listOnly) {
  process.exit(0);
}
const child = Bun.spawn(
  ["bun", "test", "--parallel", "--timings=.bun-test-timings.json", ...tests],
  {
    env: { ...process.env, AGENT: "1" },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await child.exited);
