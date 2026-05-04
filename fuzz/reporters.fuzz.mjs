import { renderReport } from "../dist/reporters.js";

function makeString(value) {
  return typeof value === "string" ? value : "";
}

function makeArray(value) {
  return Array.isArray(value) ? value : [];
}

function makeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function coerceDiagnostic(value, index) {
  const object = makeObject(value);
  const location = makeObject(object.location);

  return {
    ruleId: makeString(object.ruleId) || `fuzz-rule-${index}`,
    severity:
      object.severity === "error" || object.severity === "warning" || object.severity === "suggestion"
        ? object.severity
        : "warning",
    confidence: object.confidence === "medium" ? "medium" : "high",
    scope: object.scope === "repository" ? "repository" : "workflow",
    docsPath: makeString(object.docsPath),
    workflow: makeString(object.workflow),
    location: {
      path: makeString(location.path),
      line: typeof location.line === "number" ? location.line : 1,
      column: typeof location.column === "number" ? location.column : 1,
    },
    message: makeString(object.message),
    why: makeString(object.why),
    suggestion: makeString(object.suggestion),
    measurementHint: makeString(object.measurementHint),
    aiHandoff: makeString(object.aiHandoff),
    score: typeof object.score === "number" ? object.score : 0,
  };
}

export function fuzz(data) {
  let parsed;

  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    return;
  }

  const findings = makeArray(parsed.findings).slice(0, 50).map(coerceDiagnostic);
  const report = {
    targetPath: makeString(parsed.targetPath),
    workflowCount: typeof parsed.workflowCount === "number" ? parsed.workflowCount : 0,
    scannedAt: makeString(parsed.scannedAt),
    topFindings: findings.slice(0, 10),
    topAggregatedFindings: [],
    findings,
    workflows: [],
    fixFirst: makeArray(parsed.fixFirst).filter((v) => typeof v === "string").slice(0, 10),
    aiHandoff: makeArray(parsed.aiHandoff).filter((v) => typeof v === "string").slice(0, 10),
    analysisWarnings: [],
  };

  renderReport(report, "text");
  renderReport(report, "json", { findingsOnly: true });
  renderReport(report, "markdown");
  renderReport(report, "handoff", { topCount: 5, mode: "strict" });
}
