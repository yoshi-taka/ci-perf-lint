import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  dynamodbLocalCommandEntries,
  dynamodbLocalRuns,
  isDisposableDiskBackedSharedRun,
} from "./shared/dynamodb-local.ts";

const meta = {
  id: "consider-dynamodb-local-in-memory",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-dynamodb-local-in-memory.md",
  scope: "all",
} satisfies RuleMeta;

export const considerDynamodbLocalInMemoryRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    for (const entry of dynamodbLocalCommandEntries(doc)) {
      const run = dynamodbLocalRuns(entry.text).find(isDisposableDiskBackedSharedRun);
      if (!run) {
        continue;
      }
      findings.push(
        buildDiagnostic(doc, meta, entry.node, {
          message: `Job "${entry.jobName}" starts disposable ${run.image} with -sharedDb and disk-backed storage.`,
          why: "DynamoDB Local writes database files by default. Its -inMemory option avoids those files and discards data when the process stops, which can reduce disk I/O for disposable test data. --rm and absent mounts do not prove that restart persistence is unused or that the runner has enough RAM; there is no guaranteed speedup.",
          suggestion:
            "If tests do not need restart recovery or durable files and have sufficient memory, benchmark adding -inMemory while retaining -sharedDb. Keep disk-backed mode for persistence/restart tests or large datasets. Do not combine -inMemory with -dbPath, remove parity flags, or disable cleanup to gain reuse.",
          measurementHint:
            "Compare fixture creation, disk I/O, peak memory including JVM overhead, and total test duration on equivalent runners. Check restart expectations and test isolation before changing modes; keep the change only if behavior remains correct and costs improve.",
          aiHandoff: `Review ${doc.relativePath} job "${entry.jobName}" and disposable DynamoDB Local command using ${run.image}. Check persistence/restart assertions and memory headroom first. If appropriate, compare -inMemory with the current disk-backed mode while preserving -sharedDb, cleanup, endpoints, and assertions. Do not blindly switch storage mode.`,
          score: 35,
        }),
      );
    }
    return findings;
  },
};
