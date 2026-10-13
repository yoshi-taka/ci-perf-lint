import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "ruby-setup-ruby-missing-bundler-cache";
const setup = (cache?: unknown) => ({
  uses: "ruby/setup-ruby@v1",
  with: { "ruby-version": "3.3", ...(cache === undefined ? {} : { "bundler-cache": cache }) },
});

async function scan(job: Record<string, unknown>, workflow: Record<string, unknown> = {}) {
  const root = await tempDirs.create("apl-ruby-cache-");
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  const source = stringify({
    name: "Ruby CI",
    on: "push",
    ...workflow,
    jobs: { test: { "runs-on": "ubuntu-latest", ...job } },
  });
  await writeFile(path.join(dir, "ci.yml"), source);
  await writeFile(path.join(root, "Gemfile"), 'source "https://rubygems.org"\ngem "rake"\n');
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return { findings: report.findings.filter((finding) => finding.ruleId === ruleId), source };
}

describe("Ruby setup and installed-gem cache coverage", () => {
  test.each([
    ["bundle install", true],
    ["bundle check || bundle install", true],
    ["bundle install && bundle exec rspec", true],
    ["bundle install --no-cache", true],
    ["bundle install --jobs 4 --no-cache", true],
    ["bundle --no-cache install", true],
    ["echo --no-cache && bundle install", true],
    ["bundle _2.5.0_ install", true],
    ["bundle", true],
    ["ruby -S bundle install", true],
    ["bundle --gemfile Gemfile install", true],
    ["echo 'bundle install'", false],
    ["bundle check", false],
    ["bundle exec bundle install", false],
    ["bundle install --help", false],
    ["bundle --version", false],
    ["cat <<EOF\nbundle install\nEOF", false],
  ] as const)("manual Bundler command: %s", async (command, expected) => {
    const { findings } = await scan({ steps: [setup(), { run: command }] });
    expect(findings).toHaveLength(expected ? 1 : 0);
    if (expected) {
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.suggestion).toContain("preserve bundle check, bundle exec");
    }
  });
  test.each([true, "true", "True", "TRUE", "${{ inputs.cache }}"])(
    "enabled or unknown setting abstains: %s",
    async (cache) => {
      expect((await scan({ steps: [setup(cache), { run: "bundle install" }] })).findings).toEqual(
        [],
      );
    },
  );
  test.each([false, "false", ""])("disabled cache remains eligible: %s", async (cache) => {
    expect(
      (await scan({ steps: [setup(cache), { run: "bundle install" }] })).findings,
    ).toHaveLength(1);
  });
  test("install before Ruby setup is not assigned to that action", async () => {
    expect((await scan({ steps: [{ run: "bundle install" }, setup()] })).findings).toEqual([]);
  });
  test("the nearest setup controls cache eligibility", async () => {
    const { findings, source } = await scan({
      steps: [setup(true), setup(false), { run: "bundle install" }],
    });
    expect(findings).toHaveLength(1);
    const line =
      source.split("\n").findLastIndex((text) => text.includes("uses: ruby/setup-ruby")) + 1;
    expect(findings[0]?.location.line).toBe(line);
  });
  test("a later cache-enabled setup does not hide an earlier manual install", async () => {
    expect(
      (await scan({ steps: [setup(), { run: "bundle install" }, setup(true)] })).findings,
    ).toHaveLength(1);
  });
  test("a newer cache-enabled setup covers later installation", async () => {
    expect(
      (await scan({ steps: [setup(), setup(true), { run: "bundle install" }] })).findings,
    ).toEqual([]);
  });
  test("a named opt-out cannot hide another eligible install", async () => {
    expect(
      (
        await scan({
          steps: [
            setup(),
            { name: "disable cache", run: "bundle install" },
            { run: "bundle install" },
          ],
        })
      ).findings,
    ).toHaveLength(1);
  });
  test("named opt-out alone is respected", async () => {
    expect(
      (await scan({ steps: [setup(), { name: "no cache", run: "bundle install" }] })).findings,
    ).toEqual([]);
  });
  test.each([
    ["actions/cache@v4", "vendor/bundle", false],
    ["actions/cache/restore@v4", ["vendor/bundle", ".bundle"], false],
    ["actions/cache/save@v4", "vendor/bundle", true],
    ["actions/cache@v4", "node_modules", true],
    ["actions/cache@v4", "vendor/cache", true],
  ] as const)("manual cache coverage: %s %s", async (uses, cachePath, expected) => {
    const { findings } = await scan({
      steps: [setup(), { uses, with: { path: cachePath, key: "gems" } }, { run: "bundle install" }],
    });
    expect(findings).toHaveLength(expected ? 1 : 0);
  });
  test.each(["none", "write-only", "${{ inputs.mode }}"])(
    "cache policy opt-out: %s",
    async (mode) => {
      expect(
        (await scan({ "cache-mode": mode, steps: [setup(), { run: "bundle install" }] })).findings,
      ).toEqual([]);
    },
  );
  test("container jobs are excluded", async () => {
    expect(
      (await scan({ container: "ruby:3.3", steps: [setup(), { run: "bundle install" }] })).findings,
    ).toEqual([]);
  });
});
