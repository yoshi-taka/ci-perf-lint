import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let cached: string | undefined;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeStaleRoots(parent: string): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const match = /^apl-tmp-(\d+)-/.exec(entry.name);
    if (!match) {
      continue;
    }
    const full = path.join(parent, entry.name);
    const pid = Number(match[1]);
    try {
      if (!processIsAlive(pid) || statSync(full).mtimeMs < cutoff) {
        rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // ignore stale/racing entries
    }
  }
}

/** Root for test-created temporary directories. Mutation runs point this at a
 * sandbox-owned directory; ordinary runs get a per-process root removed on exit. */
export function testTempRoot(): string {
  if (cached) {
    mkdirSync(cached, { recursive: true });
    return cached;
  }
  const configured = process.env.CI_PERF_LINT_TEST_TMP;
  if (configured) {
    cached = path.resolve(configured);
    mkdirSync(cached, { recursive: true });
    return cached;
  }
  const parent = os.tmpdir();
  removeStaleRoots(parent);
  cached = path.join(parent, `apl-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cached, { recursive: true });
  process.once("exit", () => {
    try {
      rmSync(cached!, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return cached;
}
