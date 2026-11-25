import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import { buildkiteStepDeploys, buildkiteTextDeploys } from "./buildkite-deployment.ts";
import { hasShellInputDocument } from "./command-patterns.ts";
import { shellInvocations } from "./shell-invocations.ts";
import { invocationOptions } from "./tool-command-evidence.ts";
import { unwrapBuildkiteCommand } from "./buildkite-command-wrappers.ts";
import { buildkiteAllowsCheckoutScripts } from "./buildkite-plugin-script-context.ts";

export type BuildkiteDeploymentEvidence = "publication" | "no-evidence" | "unknown";

const MAX_DEPTH = 4;
const MAX_FILES = 16;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_COMMANDS = 512;
const analyses = new WeakMap<
  PipelineDocument,
  Map<string | undefined, Promise<ReadonlyMap<PipelineStep, BuildkiteDeploymentEvidence>>>
>();

/** Only command-position shell references are followed; arguments are never executed. */
function shellReference(words: string[]): string | undefined {
  const tool = words[0] ?? "";
  if (["bash", "sh", "/bin/bash", "/bin/sh", "source", "."].includes(tool)) {
    let index = 1;
    while (/^-[eux]+$/.test(words[index] ?? "")) {
      index++;
    }
    if (words[index] === "--") {
      index++;
    }
    return words[index] ?? "";
  }
  if (["zsh", "fish", "dash", "parallel"].includes(tool)) {
    return "";
  }
  // Literal non-shell tools are not recursively inspected. Their existence
  // alone is not evidence of publication or unresolved shell execution.
  if (path.isAbsolute(tool) && !/\.(?:sh|bash)$/.test(tool)) {
    return undefined;
  }
  if (/\.(?:py|js|mjs|cjs|rb|pl)$/.test(tool)) {
    return undefined;
  }
  return tool.includes("/") || /\.(?:sh|bash)$/.test(tool) ? tool : undefined;
}

interface ScriptEffects {
  changedDirectory: boolean;
  writes: Set<string>;
  dynamicWrite: boolean;
}

function collectWrites(original: string[], effects: ScriptEffects): void {
  const record = (target: string | undefined) => {
    if (/^&\d+$/.test(target ?? "")) {
      return;
    }
    if (
      !target ||
      effects.changedDirectory ||
      path.isAbsolute(target) ||
      /[$`*?{}~\\]/.test(target)
    ) {
      effects.dynamicWrite = true;
    } else {
      effects.writes.add(path.normalize(target));
    }
  };
  const words = unwrapBuildkiteCommand(original) ?? original;
  for (let index = 0; index < words.length; index++) {
    if (words[index] === ">") {
      while (words[index + 1] === ">") {
        index++;
      }
      record(words[index + 1]);
    }
  }
  if (["curl", "wget"].includes(words[0] ?? "")) {
    for (const option of invocationOptions(
      words,
      words[0] === "wget" ? ["-O", "--output-document"] : [],
    )) {
      if (words[0] === "curl" && option.name === "-O") {
        effects.dynamicWrite = true;
        continue;
      }
      if (["--output", "-o", "-O", "--output-document"].includes(option.name)) {
        record(option.value);
      }
    }
  }
}

function fixedRelativePath(reference: string): boolean {
  return (
    reference.length > 0 &&
    !path.isAbsolute(reference) &&
    !reference.split("/").includes("..") &&
    !reference.includes("__shell_substitution__") &&
    !/[$`*?{}~\\\0]/.test(reference) &&
    reference.includes("/")
  );
}

class ScriptDeploymentScan {
  #root: Promise<string | undefined> | undefined;
  readonly #files = new Map<string, Promise<string | undefined>>();
  #bytes = 0;
  #commands = 0;

  constructor(private readonly repoRoot: string | undefined) {}

  async #read(reference: string): Promise<string | undefined> {
    const normalized = path.normalize(reference);
    const existing = this.#files.get(normalized);
    if (existing) {
      return existing;
    }
    if (!fixedRelativePath(reference) || this.#files.size >= MAX_FILES) {
      return undefined;
    }
    const load = this.#readFile(normalized);
    this.#files.set(normalized, load);
    return load;
  }

  async #readFile(relative: string): Promise<string | undefined> {
    if (!this.repoRoot) {
      return undefined;
    }
    this.#root ??= realpath(this.repoRoot).catch(() => undefined);
    const root = await this.#root;
    if (!root || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      return undefined;
    }
    const target = path.resolve(root, relative);
    try {
      let current = root;
      for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          return undefined;
        }
      }
      const info = await lstat(target);
      if (
        !info.isFile() ||
        info.size > MAX_FILE_BYTES ||
        info.size + this.#bytes > MAX_TOTAL_BYTES
      ) {
        return undefined;
      }
      const handle = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!(await handle.stat()).isFile()) {
          return undefined;
        }
        // Bounded even if a regular file grows after stat.
        const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - this.#bytes) + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (bytesRead === 0) {
            break;
          }
          length += bytesRead;
        }
        this.#bytes += length;
        if (length > MAX_FILE_BYTES || this.#bytes > MAX_TOTAL_BYTES) {
          return undefined;
        }
        return buffer.subarray(0, length).toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  }

  async text(
    source: string,
    active: ReadonlySet<string> = new Set(),
    referencesAllowed = true,
    effects: ScriptEffects = { changedDirectory: false, writes: new Set(), dynamicWrite: false },
  ): Promise<BuildkiteDeploymentEvidence> {
    if (buildkiteTextDeploys(source)) {
      return "publication";
    }
    if (hasShellInputDocument(source)) {
      return "unknown";
    }
    const invocations = shellInvocations(source, false).map((original) => ({
      original,
      words: unwrapBuildkiteCommand(original),
    }));
    const hasReferences = invocations.some(
      ({ words }) => words === undefined || shellReference(words) !== undefined,
    );
    // Only writes that may replace a referenced/executing script invalidate
    // static contents; ordinary test output does not make the pipeline unknown.
    let unknown = hasReferences && !referencesAllowed;
    for (const { original, words } of invocations) {
      if (++this.#commands > MAX_COMMANDS) {
        return "unknown";
      }
      collectWrites(original, effects);
      unknown ||= [...active].some((reference) => effects.writes.has(reference));
      if (!words) {
        unknown = true;
        continue;
      }
      const tool = words[0] ?? "";
      if (
        tool === "eval" ||
        tool.startsWith("-") ||
        /[$`]/.test(tool) ||
        tool.includes("__shell_substitution__")
      ) {
        unknown = true;
      }
      if (["cd", "pushd", "popd"].includes(tool)) {
        // Directory changes matter to later file resolution, not to a literal
        // pytest/npm command that needs no shell-script lookup.
        effects.changedDirectory = true;
      }
      const reference = shellReference(words);
      if (reference !== undefined) {
        const normalized = path.normalize(reference);
        if (
          unknown ||
          effects.changedDirectory ||
          effects.dynamicWrite ||
          effects.writes.has(normalized) ||
          !fixedRelativePath(reference) ||
          active.size >= MAX_DEPTH ||
          active.has(normalized)
        ) {
          unknown = true;
          continue;
        }
        const text = await this.#read(reference);
        if (
          text === undefined ||
          text.includes("\0") ||
          (/^#!/.test(text) && !/^#![^\r\n]*\b(?:bash|sh)(?:\s|$)/.test(text))
        ) {
          unknown = true;
          continue;
        }
        const result = await this.text(text, new Set([...active, normalized]), true, effects);
        if (result === "publication") {
          return result;
        }
        unknown ||= result === "unknown";
      }
    }
    return unknown ? "unknown" : "no-evidence";
  }
}

/** Cached only for this parsed document/root, with a shared per-pipeline read budget. */
export function buildkiteScriptDeploymentEvidence(
  pipeline: PipelineDocument,
  repoRoot: string | undefined,
): Promise<ReadonlyMap<PipelineStep, BuildkiteDeploymentEvidence>> {
  let byRoot = analyses.get(pipeline);
  if (!byRoot) {
    byRoot = new Map();
    analyses.set(pipeline, byRoot);
  }
  let analysis = byRoot.get(repoRoot);
  if (!analysis) {
    analysis = (async () => {
      const scan = new ScriptDeploymentScan(repoRoot);
      const result = new Map<PipelineStep, BuildkiteDeploymentEvidence>();
      for (const step of pipeline.steps) {
        const source = [step.command ?? "", ...(step.commands ?? [])].join("\n");
        result.set(
          step,
          buildkiteStepDeploys(step)
            ? "publication"
            : await scan.text(source, new Set(), buildkiteAllowsCheckoutScripts(step)),
        );
      }
      return result;
    })();
    byRoot.set(repoRoot, analysis);
  }
  return analysis;
}
