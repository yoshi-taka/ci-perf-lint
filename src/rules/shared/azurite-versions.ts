import type { RuleMeta } from "../../types.ts";

export const preferAzurite336Meta = {
  id: "prefer-azurite-3-36",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-azurite-3-36.md",
} satisfies RuleMeta;

export const preferAzurite336Why =
  "Azurite 3.36.0 improves LokiJS metadata queries by putting more selective indexed properties first, avoiding broad account-level scans in blob, queue, and table lookups. The author's example initial-load workload fell from 12.5 seconds to about 9 seconds; this is not a whole-CI benchmark or guaranteed speedup. The improvement targets the default LokiJS backend, not the optional SQL blob metadata store, and does not require --inMemoryPersistence.";
export const preferAzurite336Suggestion =
  "Upgrade Azurite to 3.36.0 or a later compatible stable release. npm installations require Node.js >=21; prefer a supported compatible Node LTS. Preserve endpoint bindings, credentials, persistence paths, SDK/API compatibility, and readiness checks. Do not enable --inMemoryPersistence, --loose, or --skipApiVersionCheck solely for speed.";
export const preferAzurite336MeasurementHint =
  "Compare service readiness, fixture-loading time, metadata-heavy request latency, peak memory, and full integration-test duration with equivalent data and runners. Keep Blob, Queue, Table, persistence, and response assertions unchanged where used; verify the metadata backend before attributing a speedup.";
