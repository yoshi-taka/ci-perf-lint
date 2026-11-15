import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  prepareShared,
  registerSharedAudit,
  getSharedRecord,
  assertSharedCurrent,
  clearShared,
  finishShared,
  sharedCurrent,
  sharedEnabled,
  SharedGenerationCancelled,
} from "../src/repository-diagnostics/source-shared-records.ts";
import { emptyModuleFacts } from "../src/repository-diagnostics/source-shared-module.ts";

const payload = () => ({
  audit: { ok: true as const, value: { imports: [], wildcardExports: [], snapshots: [] } },
  mode: "negative" as const,
  module: emptyModuleFacts(),
});

test("shared records select one load per key across concurrent consumers", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 19 }), { maxLength: 50 }), async (keys) => {
      const context = {};
      const handle = prepareShared(context, true);
      const loads = new Map<string, number>();
      registerSharedAudit(
        context,
        () => true,
        (filename) => {
          loads.set(filename, (loads.get(filename) ?? 0) + 1);
          return Promise.resolve(payload());
        },
      );
      try {
        const pending = keys.map((key) => getSharedRecord(context, String(key), "playwright")!);
        const records = await Promise.all(pending);
        for (let index = 0; index < keys.length; index++) {
          const filename = String(keys[index]);
          const record = records[index]!;
          assertSharedCurrent(context, record);
          expect(record).toBe(records[keys.indexOf(keys[index]!)]!);
          expect(loads.get(filename)).toBe(1);
          expect(Object.isFrozen(record)).toBe(true);
        }
      } finally {
        await finishShared(context, handle);
      }
      expect(sharedEnabled(context)).toBe(false);
    }),
    { numRuns: 500, seed: 20261125 },
  );
});

test("stale completion and old teardown cannot publish into a new generation", async () => {
  const context = {};
  const old = prepareShared(context, true);
  const firstLoad = Promise.withResolvers<ReturnType<typeof payload>>();
  registerSharedAudit(
    context,
    () => true,
    () => firstLoad.promise,
  );
  const first = getSharedRecord(context, "a.ts")!;
  const rejection = first.catch((error: unknown) => error);
  clearShared(context);
  const current = prepareShared(context, true);
  registerSharedAudit(
    context,
    () => true,
    () => Promise.resolve(payload()),
  );
  const record = await getSharedRecord(context, "a.ts")!;
  firstLoad.resolve(payload());
  expect(await rejection).toBeInstanceOf(SharedGenerationCancelled);
  await finishShared(context, old);
  expect(sharedCurrent(context, current)).toBe(true);
  assertSharedCurrent(context, record);
  await finishShared(context, current);
  expect(() => assertSharedCurrent(context, record)).toThrow(SharedGenerationCancelled);
});

test("pre-registration reads remain legacy, including overflow", async () => {
  for (const files of [0, 1, 2]) {
    const context = {};
    const handle = prepareShared(context, true, { files, modulePayload: 1024 });
    expect(getSharedRecord(context, "early.ts", "playwright")).toBeUndefined();
    registerSharedAudit(
      context,
      () => true,
      () => Promise.resolve(payload()),
    );
    expect(getSharedRecord(context, "early.ts")).toBeUndefined();
    if (files > 0) {
      expect(await getSharedRecord(context, "later.ts")).toBeDefined();
    }
    await finishShared(context, handle);
  }
});

test("file and metadata budgets fall back without losing selected audit facts", async () => {
  const context = {};
  const handle = prepareShared(context, true, { files: 2, modulePayload: 1 });
  registerSharedAudit(
    context,
    (filename) => filename.endsWith(".ts"),
    () => Promise.resolve(payload()),
  );
  expect(getSharedRecord(context, "ignored.vue")).toBeUndefined();
  for (const filename of ["a.ts", "b.ts"]) {
    const record = await getSharedRecord(context, filename)!;
    expect(record.mode).toBe("legacy");
    expect(record.module).toBeUndefined();
    expect(record.audit.ok).toBe(true);
  }
  expect(getSharedRecord(context, "c.ts")).toBeUndefined();
  await finishShared(context, handle);
});

test("exceptions and selected read failures are reused, not replaced by successes", async () => {
  for (const throws of [false, true]) {
    const context = {};
    const handle = prepareShared(context, true);
    const error = new Error("selected failure");
    let attempts = 0;
    registerSharedAudit(
      context,
      () => true,
      () => {
        attempts++;
        if (throws) {
          throw error;
        }
        return Promise.resolve({
          audit: { ok: true, value: undefined },
          mode: "read-failed",
          module: undefined,
        });
      },
    );
    const record = await getSharedRecord(context, "a.ts")!;
    expect(record.mode).toBe(throws ? "legacy" : "read-failed");
    if (!record.audit.ok) {
      expect(record.audit.error).toBe(error);
    }
    expect(await getSharedRecord(context, "a.ts")).toBe(record);
    expect(attempts).toBe(1);
    await finishShared(context, handle);
  }
});

test("reservation precedes reentrant factory calls; teardown drains the selected reader", async () => {
  const context = {};
  const handle = prepareShared(context, true);
  const gate = Promise.withResolvers<void>();
  let reentrant: ReturnType<typeof getSharedRecord>;
  registerSharedAudit(
    context,
    () => true,
    async () => {
      reentrant = getSharedRecord(context, "a.ts");
      await gate.promise;
      return payload();
    },
  );
  const first = getSharedRecord(context, "a.ts")!;
  expect(reentrant!).toBe(first);
  const rejected = first.catch((error: unknown) => error);
  let drained = false;
  const finishing = finishShared(context, handle).then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  expect(await rejected).toBeInstanceOf(SharedGenerationCancelled);
  await finishing;
  expect(drained).toBe(true);
  expect(prepareShared({}, false)).toBeUndefined();
});
