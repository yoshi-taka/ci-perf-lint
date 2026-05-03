import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";

const interestingRoots = new Set([
  ".github",
  "packages",
  "apps",
  "services",
  "script",
  "scripts",
  "tools",
  "docker",
  "dockerhub",
  "cmd",
  "crates",
  "pkg",
]);

const runPathPrefixPatterns = [
  /(?:^|\s)cd\s+([./A-Za-z0-9_-][^\s;|&]*)/g,
  /(?:^|[\s'"])(?:\.\/)?((?:\.github|packages|apps|services|script|scripts|tools|docker|dockerhub|cmd|crates|pkg)\/[A-Za-z0-9._/-]+)/g,
] as const;

function normalizeWorkflowPathPrefix(rawPath: string): string | undefined {
  const trimmed = rawPath
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\.\//, "");
  if (!trimmed || trimmed.startsWith("${{") || trimmed.startsWith("/")) {
    return undefined;
  }

  const parts = trimmed.split("/").filter(Boolean);
  const first = parts[0];
  if (!first || first === "." || first === ".." || !interestingRoots.has(first)) {
    return undefined;
  }

  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function collectRunPathPrefixes(run: string): string[] {
  const matches = new Set<string>();

  for (const pattern of runPathPrefixPatterns) {
    for (const match of run.matchAll(pattern)) {
      const prefix = normalizeWorkflowPathPrefix(match[1] ?? "");
      if (prefix) {
        matches.add(prefix);
      }
    }
  }

  return [...matches];
}

function collectArtifactPathPrefixes(step: WorkflowStep): string[] {
  const pathValue = typeof step.with?.path === "string" ? step.with.path : undefined;
  if (!pathValue) {
    return [];
  }

  return pathValue
    .split("\n")
    .map((entry) => normalizeWorkflowPathPrefix(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function collectLocalActionPrefixes(step: WorkflowStep): string[] {
  const uses = step.uses ?? "";
  if (!uses.startsWith("./")) {
    return [];
  }

  const prefix = normalizeWorkflowPathPrefix(uses);
  return prefix ? [prefix] : [];
}

export function collectScopePrefixes(job: WorkflowJob): string[] {
  const prefixes = new Set<string>();

  for (const step of job.steps) {
    for (const prefix of collectRunPathPrefixes(step.run ?? "")) {
      prefixes.add(prefix);
    }
    for (const prefix of collectArtifactPathPrefixes(step)) {
      prefixes.add(prefix);
    }
    for (const prefix of collectLocalActionPrefixes(step)) {
      prefixes.add(prefix);
    }
  }

  return [...prefixes];
}
