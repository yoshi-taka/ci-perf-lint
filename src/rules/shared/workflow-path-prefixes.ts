import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";
import {
  repositoryInvocations,
  shellFileRedirectionTargets,
} from "./repository-command-evidence.ts";
import { staticShellWords } from "./command-patterns.ts";

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

function normalizeWorkflowPathPrefix(rawPath: string): string | undefined {
  const trimmed = rawPath
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\.\//, "");
  if (
    !trimmed ||
    /[$`]/.test(trimmed) ||
    trimmed.includes("__shell_substitution__") ||
    trimmed.startsWith("/")
  ) {
    return undefined;
  }

  const parts = trimmed.split("/").filter((part) => part && part !== ".");
  const first = parts[0];
  if (
    !first ||
    !interestingRoots.has(first) ||
    parts.includes("..") ||
    (parts[1] !== undefined && !/^[A-Za-z0-9_.-]+$/.test(parts[1]))
  ) {
    return undefined;
  }

  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function collectRunPathPrefixes(run: string): string[] {
  const matches = new Set<string>();
  const pathTools = new Set([
    "cd",
    "cat",
    "cp",
    "mv",
    "rm",
    "chmod",
    "chown",
    "ln",
    "rsync",
    "tar",
    "install",
    "tee",
    "test",
    "[",
    "[[",
  ]);
  const operands = repositoryInvocations(run).flatMap(([tool, ...args]) => {
    if (!pathTools.has(tool ?? "")) {
      return [];
    }
    if (["test", "[", "[["].includes(tool ?? "")) {
      return ["-f", "-d", "-e", "-r", "-w", "-x", "-s", "-L", "-h"].includes(args[0] ?? "") &&
        (args.length === 2 || (args.length === 3 && ["]", "]]"].includes(args[2] ?? "")))
        ? [args[1]!]
        : [];
    }
    // Option values such as --label/--transform are not path operands. Only model simple forms.
    if (args.some((arg) => arg.startsWith("--") && arg !== "--")) {
      return [];
    }
    if (
      ["chmod", "chown", "install", "tar", "rsync"].includes(tool ?? "") &&
      args.some((arg) => arg.startsWith("-"))
    ) {
      return [];
    }
    const booleanOptions: Record<string, RegExp> = {
      cd: /^-[LPe]+$/,
      cat: /^-[AbEenstTuv]+$/,
      cp: /^-[abdfiLnprRsTvux]+$/,
      mv: /^-[bfinTuv]+$/,
      rm: /^-[dfiIrRv]+$/,
      ln: /^-[bdfinrsTv]+$/,
      tee: /^-[ai]+$/,
    };
    const options = booleanOptions[tool ?? ""];
    if (options && args.some((arg) => arg !== "--" && arg.startsWith("-") && !options.test(arg))) {
      return [];
    }
    return args.filter((arg) => !arg.startsWith("-"));
  });
  for (const target of shellFileRedirectionTargets(run)) {
    const words = staticShellWords(target);
    if (words?.length === 1) {
      operands.push(words[0]!);
    }
  }
  for (const operand of operands) {
    const prefix = normalizeWorkflowPathPrefix(operand);
    if (prefix) {
      matches.add(prefix);
    }
  }

  return [...matches];
}

function collectArtifactPathPrefixes(step: WorkflowStep): string[] {
  if (
    !["actions/upload-artifact@", "actions/download-artifact@"].some((prefix) =>
      step.uses?.toLowerCase().startsWith(prefix),
    )
  ) {
    return [];
  }
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
    const workingDirectory = normalizeWorkflowPathPrefix(step.workingDirectory ?? "");
    if (workingDirectory) {
      prefixes.add(workingDirectory);
    }
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
