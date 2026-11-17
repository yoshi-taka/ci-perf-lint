import { createInterface } from "node:readline";
import path from "node:path";
import { mock } from "bun:test";
import * as HarnessRuntime from "./harness-runtime.ts";

interface InitMessage {
  dir: string;
  testFiles: string[];
  targets: string[];
  harnessPath: string;
}

interface RunMessage {
  type: string;
  runId: number;
  target: string;
  mutantRel: string | null;
  testFiles?: string[];
}

const write = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

for (const method of ["log", "error", "warn", "info", "debug"] as const) {
  console[method] = () => {};
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const queued: string[] = [];
let resolveLine: ((line: string) => void) | undefined;
lines.on("line", (line) => {
  if (resolveLine) {
    const resolve = resolveLine;
    resolveLine = undefined;
    resolve(line);
  } else {
    queued.push(line);
  }
});
async function nextLine(): Promise<string | null> {
  if (queued.length > 0) {
    return queued.shift()!;
  }
  return new Promise((resolve) => {
    resolveLine = (line) => resolve(line);
  });
}

const init = JSON.parse((await nextLine()) ?? "{}") as InitMessage;
const harness = HarnessRuntime;
const baseModules: Record<string, Record<string, unknown>> = {};
const current: Record<string, Record<string, unknown>> = {};
const wrappersByTarget: Record<string, Record<string, unknown>> = {};
for (const target of init.targets) {
  const baseRel = path.join(path.dirname(target), `.mutbase-${path.basename(target)}`);
  const base = (await import(path.join(init.dir, baseRel))) as Record<string, unknown>;
  baseModules[target] = base;
  current[target] = base;
  const wrappers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    wrappers[key] =
      typeof value === "function"
        ? (...args: unknown[]) => (current[target]![key] as (...a: unknown[]) => unknown)(...args)
        : value;
  }
  wrappersByTarget[target] = wrappers;
  await mock.module(path.join(init.dir, target), () => wrappers);
}

write({ type: "ready" });

let generation = 0;
for (;;) {
  const line = await nextLine();
  if (line === null) {
    break;
  }
  const message = JSON.parse(line) as RunMessage;
  if (message.type !== "run") {
    continue;
  }
  try {
    for (const target of init.targets) {
      current[target] = baseModules[target]!;
    }
    if (message.mutantRel) {
      current[message.target] = (await import(path.join(init.dir, message.mutantRel))) as Record<
        string,
        unknown
      >;
    }
    harness.resetHarness();
    for (const file of message.testFiles ?? init.testFiles) {
      await import(`${path.join(init.dir, "test", file)}?m=${generation++}`);
    }
    const failed: string[] = [];
    for (const testCase of harness.harnessState.cases) {
      try {
        for (const hook of testCase.before) {
          await hook();
        }
        await testCase.fn();
      } catch (error) {
        failed.push(`${testCase.name}: ${String(error).slice(0, 120)}`);
      }
      for (const hook of testCase.after) {
        try {
          await hook();
        } catch {
          // afterEach failures are cleanup-only for mutation classification.
        }
      }
    }
    for (const hook of harness.harnessState.afterAll) {
      try {
        await hook();
      } catch {
        // cleanup only
      }
    }
    write({ runId: message.runId, failed });
  } catch (error) {
    write({ runId: message.runId, failed: [`runner error: ${String(error)}`] });
  }
}
