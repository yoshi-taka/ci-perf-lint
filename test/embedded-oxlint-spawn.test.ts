import { describe, expect, test } from "bun:test";
import { bundledOxlintBinPath } from "../src/repository-diagnostics/embedded-oxlint-path.ts";
import { parseOxlintLine } from "../src/repository-diagnostics/embedded-oxlint-parser.ts";
import { spawnOxlintProcess } from "../src/repository-diagnostics/embedded-oxlint-spawn.ts";
import { runEmbeddedOxlint } from "../src/repository-diagnostics/embedded-oxlint-runner.ts";
import { accessSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

describe("embedded oxlint fixture retry", () => {
  test("retries with fixture ignores after a silent failure", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-oxlint-fixture-retry-"));
    try {
      const calls: string[][] = [];
      const fakeSpawn = (cmd: string[]) => {
        calls.push(cmd);
        const exitCode = calls.length === 1 ? 1 : 0;
        return {
          stdout: Promise.resolve(""),
          stderr: Promise.resolve(""),
          exited: Promise.resolve(exitCode),
          timedOut: false,
          signaled: false,
        };
      };

      const result = await runEmbeddedOxlint(tmpDir, "non-import", undefined, undefined, fakeSpawn);
      expect(result).toEqual([]);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.join(" ")).toContain("**/fixtures/**");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
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

describe("spawnOxlintProcess timeout", () => {
  test("kills the full process group", async () => {
    const proc = spawnOxlintProcess(
      ["bash", "-lc", "sleep 30 & wait"],
      process.cwd(),
      true,
      SHORT_TIMEOUT,
    );

    const [outText, errText, code] = await Promise.all([proc.stdout, proc.stderr, proc.exited]);

    expect(proc.timedOut).toBe(true);
    expect(code).not.toBe(0);
    expect(typeof outText).toBe("string");
    expect(typeof errText).toBe("string");
  });
});

describe("parseOxlintLine", () => {
  test("parses [Category/Rule] format", () => {
    const result = parseOxlintLine(
      "src/file.ts:10:5: Use strict equality. [Warning/eslint(no-unused-vars)]",
    );
    expect(result).toEqual({
      filename: "src/file.ts",
      line: 10,
      column: 5,
      message: "Use strict equality.",
      severity: "Warning",
      code: "eslint(no-unused-vars)",
    });
  });

  test("parses [Error] format", () => {
    const result = parseOxlintLine("src/file.ts:1:1: Expected JSX closing tag. [Error]");
    expect(result).toEqual({
      filename: "src/file.ts",
      line: 1,
      column: 1,
      message: "Expected JSX closing tag.",
      severity: "Error",
      code: "oxc(error)",
    });
  });

  test("returns undefined for summary line", () => {
    expect(parseOxlintLine("9 problems")).toBeUndefined();
  });

  test("returns undefined for malformed line", () => {
    expect(parseOxlintLine("random text")).toBeUndefined();
  });

  test("returns undefined for empty line", () => {
    expect(parseOxlintLine("")).toBeUndefined();
  });
});

describe("runEmbeddedOxlint with mock spawn", () => {
  test("returns undefined on timeout with no output", async () => {
    const fakeSpawn = () => ({
      stdout: Promise.resolve(""),
      stderr: Promise.resolve(""),
      exited: Promise.resolve(1),
      timedOut: true,
      signaled: false,
    });
    const result = await runEmbeddedOxlint("/tmp", "non-import", undefined, undefined, fakeSpawn);
    expect(result).toBeUndefined();
  });

  test("returns partial diagnostics on timeout with output", async () => {
    const fakeSpawn = () => ({
      stdout: Promise.resolve("src/file.ts:1:1: large barrel [Warning/oxc(no-barrel-file)]\n"),
      stderr: Promise.resolve(""),
      exited: Promise.resolve(1),
      timedOut: true,
      signaled: false,
    });
    const result = await runEmbeddedOxlint("/tmp", "non-import", undefined, undefined, fakeSpawn);
    expect(result).toHaveLength(1);
    expect(result![0]!.code).toBe("oxc(no-barrel-file)");
  });

  test("falls back to node on signal", async () => {
    let callCount = 0;
    const fakeSpawn = () => {
      callCount++;
      if (callCount === 1) {
        return {
          stdout: Promise.resolve(""),
          stderr: Promise.resolve(""),
          exited: Promise.resolve(1),
          timedOut: false,
          signaled: true,
        };
      }
      return {
        stdout: Promise.resolve("src/file.ts:1:1: msg [Warning/oxc(no-barrel-file)]\n"),
        stderr: Promise.resolve(""),
        exited: Promise.resolve(1),
        timedOut: false,
        signaled: false,
      };
    };
    const result = await runEmbeddedOxlint("/tmp", "non-import", undefined, undefined, fakeSpawn);
    expect(result).toHaveLength(1);
    expect(callCount).toBe(2);
  });

  test("trigger fixture retry on silent failure", async () => {
    let callCount = 0;
    const cmds: string[][] = [];
    const fakeSpawn = (cmd: string[]) => {
      cmds.push(cmd);
      callCount++;
      const last = callCount >= 2;
      return {
        stdout: Promise.resolve(last ? "src/file.ts:1:1: msg [Warning/oxc(no-barrel-file)]\n" : ""),
        stderr: Promise.resolve(""),
        exited: Promise.resolve(last ? 1 : 1),
        timedOut: false,
        signaled: false,
      };
    };
    const result = await runEmbeddedOxlint("/tmp", "non-import", undefined, undefined, fakeSpawn);
    expect(result).toHaveLength(1);
    expect(callCount).toBe(2);
    expect(cmds[1]!.join(" ")).toContain("**/fixtures/**");
  });
});
