import assert from "node:assert/strict";
import { parseSourceAudit } from "../dist/fuzz-source-audit.mjs";

export async function fuzz(data) {
  const facts = await parseSourceAudit("fuzz.ts", data.toString("utf8"));
  if (!facts) {
    return;
  }
  for (const entry of [...facts.imports, ...facts.wildcardExports, ...facts.snapshots]) {
    assert.ok(Number.isInteger(entry.line) && entry.line > 0);
    assert.ok(Number.isInteger(entry.column) && entry.column > 0);
  }
}
