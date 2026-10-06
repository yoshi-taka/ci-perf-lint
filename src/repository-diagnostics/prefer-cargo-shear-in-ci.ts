import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "prefer-cargo-shear-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cargo-shear-in-ci.md",
} satisfies RuleMeta;

const CI_COMMAND = /\b(cargo-shear|cargo-machete|cargo\s+shear|cargo\s+machete|cargo\s+udeps)\b/i;

const CARGO_TOML_CONFIG =
  /\b(?:metadata\s*\.\s*(?:shear|machete)|\[[^\]]*\b(?:shear|machete)\b[^\]]*\])\b/i;

const CONFIG_FILE_NAMES = [
  ".cargo-shear.toml",
  ".shear.toml",
  "shear.toml",
  ".machete.toml",
] as const;

function declaresDependencies(cargoToml: string): boolean {
  let inDependenciesSection = false;
  for (const rawLine of cargoToml.split("\n")) {
    const trimmed = rawLine.trim();
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      const section = header[1]!.toLowerCase();
      if (/^dependencies\./.test(section)) {
        return true;
      }
      inDependenciesSection = section.includes("dependencies");
      continue;
    }
    if (
      inDependenciesSection &&
      trimmed.length > 0 &&
      !trimmed.startsWith("#") &&
      trimmed.includes("=")
    ) {
      return true;
    }
  }
  return false;
}

async function hasConfigFile(context: RepositoryDiagnosticContext): Promise<boolean> {
  const checks = await Promise.all(
    CONFIG_FILE_NAMES.map((fileName) =>
      context.scanContext.pathExists(context.scanContext.resolve(fileName)),
    ),
  );
  return checks.some(Boolean);
}

export async function collectPreferCargoShearInCiDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repository, workflows } = context;
  if (!repository.rust.hasCargoToml) {
    return [];
  }

  const workflowSource = workflows.map((workflow) => workflow.source ?? "").join("\n");
  if (CI_COMMAND.test(workflowSource)) {
    return [];
  }

  const cargoToml = await context.scanContext.readTextFileOrWarn(
    context.scanContext.resolve("Cargo.toml"),
  );
  if (cargoToml && CARGO_TOML_CONFIG.test(cargoToml)) {
    return [];
  }

  const hasDependencies =
    declaresDependencies(cargoToml ?? "") ||
    (repository.rust.hasWorkspace && (repository.rust.workspaceMemberCount ?? 0) > 0);
  if (!hasDependencies) {
    return [];
  }

  if (await hasConfigFile(context)) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "Cargo.toml", line: 1, column: 1 },
      message:
        "Rust project has no visible unused-dependency check (cargo-shear or cargo-machete) in CI.",
      why: "Cargo compiles every dependency declared in Cargo.toml even when the crate never imports it, and an unused dependency can also create a spurious build-graph synchronization point that blocks later crates. Removing unused dependencies typically cuts a few percent of build time and shrinks the target and cache, and cargo-shear finds them statically with rust-analyzer's parser (no compile needed) including misplaced and unlinked entries. The win is larger in big workspaces or when a heavy dependency is declared but unused.",
      suggestion:
        "Add a CI step that runs cargo-shear (or cargo-machete) on the workspace and fails on findings, for example `cargo install cargo-shear && cargo shear --deny-warnings`. Add ignore configuration for the few false positives (macro-generated imports, feature-only dependencies, cargo-hakari workspace-hack crates).",
      measurementHint:
        "Compare `cargo build`/`cargo check --workspace` wall-clock time, dependency count, and target directory size before and after removing unused dependencies.",
      aiHandoff:
        "Run cargo-shear (or cargo-machete) on the workspace, review the unused/misplaced dependency findings, add ignore configuration for false positives, remove the confirmed-unused dependencies, then compare `cargo check --workspace` time and confirm the workspace still builds and tests.",
      score: 45,
    }),
  ];
}
