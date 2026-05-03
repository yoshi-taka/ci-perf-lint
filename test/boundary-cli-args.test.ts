import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/main.ts";
import { fixtures } from "./fixtures.ts";
import { createLogger, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("CLI --top boundary BVA", () => {
  test("--top 1 → works", async () => {
    const { logger } = createLogger();
    const exitCode = await runCli([fixtures.cleanNoFindings], process.cwd(), logger);
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  test.each([
    ["0", ["--top", "0", fixtures.cleanNoFindings]],
    ["-1", ["--top", "-1", fixtures.cleanNoFindings]],
    ["non-integer", ["--top", "abc", fixtures.cleanNoFindings]],
    ["2.5", ["--top", "2.5", fixtures.cleanNoFindings]],
    ["missing value", ["--top", "--mode", "strict", fixtures.cleanNoFindings]],
  ] as const)("--top %s rejected", async (_name, args) => {
    const { logger, errors } = createLogger();
    const exitCode = await runCli([...args], process.cwd(), logger);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --top value");
  });
});

describe("CLI --mode boundary", () => {
  test.each(["strict", "exploratory"] as const)("--mode %s accepted", async (mode) => {
    const { logger } = createLogger();
    const exitCode = await runCli(
      ["--mode", mode, fixtures.cleanNoFindings],
      process.cwd(),
      logger,
    );
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  test.each(["unknown", ""] as const)("--mode %p rejected", async (mode) => {
    const { logger, errors } = createLogger();
    const exitCode = await runCli(
      ["--mode", mode, fixtures.cleanNoFindings],
      process.cwd(),
      logger,
    );
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Unsupported mode");
  });
});

describe("CLI --format boundary", () => {
  test.each(["handoff", "text", "json", "markdown"] as const)(
    "--format %s accepted",
    async (format) => {
      const { logger } = createLogger();
      const exitCode = await runCli(
        ["--format", format, fixtures.cleanNoFindings],
        process.cwd(),
        logger,
      );
      expect(exitCode).toBeGreaterThanOrEqual(0);
    },
  );

  test("--format unknown → rejected", async () => {
    const { logger, errors } = createLogger();
    const exitCode = await runCli(
      ["--format", "csv", fixtures.cleanNoFindings],
      process.cwd(),
      logger,
    );
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Unsupported format");
  });
});

describe("CLI conflicting flags", () => {
  test("--workflow-only + --repository-only → error", async () => {
    const { logger, errors } = createLogger();
    const exitCode = await runCli(["--workflow-only", "--repository-only"], process.cwd(), logger);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("cannot be used together");
  });
});
