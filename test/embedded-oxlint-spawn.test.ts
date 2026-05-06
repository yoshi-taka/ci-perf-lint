import { describe, expect, test } from "bun:test";
import { bundledOxlintBinPath } from "../src/repository-diagnostics/embedded-oxlint-path.ts";
import { accessSync } from "node:fs";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SHORT_TIMEOUT = 200;

describe("bundledOxlintBinPath", () => {
  test("resolves to a valid path via import.meta.resolve", async () => {
    const p = await bundledOxlintBinPath();
    expect(p).toBeTruthy();
    expect(() => accessSync(p!)).not.toThrow();
    expect(p).toEndWith("oxlint");
  });

  test("falls back to directory walk when resolve fails", async () => {
    const fakeResolve = () => {
      throw new Error("not found");
    };
    const fakeAccess = () => {
      throw new Error("not found");
    };
    const p = await bundledOxlintBinPath(fakeAccess, fakeResolve);
    expect(p).toBeUndefined();
  });
});

describe("Bun.spawn with timeout", () => {
  test("captures stdout on clean exit", async () => {
    const proc = Bun.spawn(["echo", "hello"], { stdout: "pipe", stderr: "pipe" });
    const [outText, errText, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(outText.trim()).toBe("hello");
    expect(errText).toBe("");
    expect(code).toBe(0);
  });

  test("captures stderr output", async () => {
    const proc = Bun.spawn(["bash", "-c", "echo errmsg >&2"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [errText, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(errText.trim()).toBe("errmsg");
    expect(code).toBe(0);
  });

  test("kills process on timeout (signal-based exit)", async () => {
    const proc = Bun.spawn(["sleep", "30"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: SHORT_TIMEOUT,
    });
    const code = await proc.exited;
    expect(code).not.toBe(0);
    expect(code).not.toBe(null);
    await wait(100);
  });
});

describe("Node spawn with timeout (via child_process)", () => {
  test("captures stdout on clean exit", async () => {
    const { spawn } = await import("node:child_process");
    const proc = spawn("echo", ["hello"]);
    const [outText, code] = await new Promise<[string, number]>((resolve) => {
      let out = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      proc.on("close", (c) => resolve([out, c ?? 1]));
    });
    expect(outText.trim()).toBe("hello");
    expect(code).toBe(0);
  });

  test("captures stderr output", async () => {
    const { spawn } = await import("node:child_process");
    const proc = spawn("bash", ["-c", "echo errmsg >&2"]);
    const [errText, code] = await new Promise<[string, number]>((resolve) => {
      let err = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        err += chunk.toString();
      });
      proc.on("close", (c) => resolve([err, c ?? 1]));
    });
    expect(errText.trim()).toBe("errmsg");
    expect(code).toBe(0);
  });

  test("kills process on timeout (SIGTERM then SIGKILL)", async () => {
    const { spawn } = await import("node:child_process");
    const proc = spawn("sleep", ["30"]);
    const code = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 2000).unref();
      }, SHORT_TIMEOUT).unref();
      proc.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });
    });
    expect(code).not.toBe(0);
    expect(code).not.toBe(null);
    await wait(100);
  });
});
