import { describe, expect, test } from "bun:test";
import { spawnOxlintProcess } from "../src/repository-diagnostics/embedded-oxlint-runner.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SHORT_TIMEOUT = 200;

describe("spawnOxlintProcess - Bun path", () => {
  test("resolves exited with 0 on clean exit", async () => {
    const { stdout, stderr, exited } = spawnOxlintProcess(["echo", "hello"], process.cwd());
    const [outText, errText, code] = await Promise.all([stdout, stderr, exited]);
    expect(outText.trim()).toBe("hello");
    expect(errText).toBe("");
    expect(code).toBe(0);
  });

  test("captures stderr output", async () => {
    const { stderr, exited } = spawnOxlintProcess(
      ["bash", "-c", "echo errmsg >&2"],
      process.cwd(),
    );
    const [code, errText] = await Promise.all([exited, stderr]);
    expect(errText.trim()).toBe("errmsg");
    expect(code).toBe(0);
  });

  test("resolves exited with non-zero when timeout fires (Bun sends SIGTERM → 143)", async () => {
    const { exited } = spawnOxlintProcess(
      ["sleep", "30"],
      process.cwd(),
      false,
      SHORT_TIMEOUT,
    );
    const code = await exited;
    expect(code).not.toBe(0);
    expect(code).not.toBe(null);
    await wait(100);
  });
});

describe("spawnOxlintProcess - Node fallback path", () => {
  test("resolves exited with 0 on clean exit", async () => {
    const { stdout, stderr, exited } = spawnOxlintProcess(
      ["echo", "hello"],
      process.cwd(),
      true,
    );
    const [outText, errText, code] = await Promise.all([stdout, stderr, exited]);
    expect(outText.trim()).toBe("hello");
    expect(errText).toBe("");
    expect(code).toBe(0);
  });

  test("captures stderr output", async () => {
    const { stderr, exited } = spawnOxlintProcess(
      ["bash", "-c", "echo errmsg >&2"],
      process.cwd(),
      true,
    );
    const [code, errText] = await Promise.all([exited, stderr]);
    expect(errText.trim()).toBe("errmsg");
    expect(code).toBe(0);
  });

  test("kills process on timeout (SIGTERM → SIGKILL)", async () => {
    const { exited } = spawnOxlintProcess(
      ["sleep", "30"],
      process.cwd(),
      true,
      SHORT_TIMEOUT,
    );
    const code = await exited;
    expect(code).not.toBe(0);
    expect(code).not.toBe(null);
    await wait(100);
  });
});
