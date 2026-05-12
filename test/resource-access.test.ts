import { describe, expect, test } from "bun:test";
import type { ResourceAccessRecord } from "../src/repository-diagnostics/repository-feature-index.ts";

describe("ResourceAccessRecord", () => {
  test("resolved record has resourceId, status, and duration", () => {
    const r: ResourceAccessRecord = {
      resourceId: "dockerfile:Dockerfile",
      status: "resolved",
      durationMs: 42.5,
    };
    expect(r.resourceId).toBe("dockerfile:Dockerfile");
    expect(r.status).toBe("resolved");
    expect(r.durationMs).toBeGreaterThan(0);
  });

  test("error record has error message", () => {
    const r: ResourceAccessRecord = {
      resourceId: "docker-build-targets",
      status: "error",
      durationMs: 100,
      error: "ENOENT",
    };
    expect(r.status).toBe("error");
    expect(r.error).toBe("ENOENT");
  });

  test("resourceAccessLog is an array of records", () => {
    const log: ResourceAccessRecord[] = [
      { resourceId: "r1", status: "resolved", durationMs: 10 },
      { resourceId: "r2", status: "error", durationMs: 20, error: "fail" },
    ];
    expect(log).toHaveLength(2);
    expect(log[0]!.durationMs).toBe(10);
    expect(log[1]!.error).toBe("fail");
  });
});
