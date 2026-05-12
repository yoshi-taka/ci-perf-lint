import { describe, expect, test } from "bun:test";

type SignalStatus = "resolved" | "skipped" | "error";

interface SignalResult<T> {
  readonly status: SignalStatus;
  readonly value: T;
  readonly error?: string;
}

describe("SignalResult type semantics", () => {
  test("resolved has status and value", () => {
    const r: SignalResult<number> = { status: "resolved", value: 42 };
    expect(r.status).toBe("resolved");
    expect(r.value).toBe(42);
  });

  test("skipped has status and fallback value", () => {
    const r: SignalResult<string> = { status: "skipped", value: "fallback" };
    expect(r.status).toBe("skipped");
    expect(r.value).toBe("fallback");
  });

  test("error has status, fallback value, and error message", () => {
    const r: SignalResult<boolean> = {
      status: "error",
      value: false,
      error: "something broke",
    };
    expect(r.status).toBe("error");
    expect(r.value).toBe(false);
    expect(r.error).toBe("something broke");
  });

  test("SignalResult discriminated union covers three states", () => {
    const resolved: SignalResult<number> = { status: "resolved", value: 1 };
    const skipped: SignalResult<number> = { status: "skipped", value: 0 };
    const errored: SignalResult<number> = { status: "error", value: 0, error: "fail" };
    expect(resolved.status).toBe("resolved");
    expect(skipped.status).toBe("skipped");
    expect(errored.status).toBe("error");
  });
});
