import type { RepositorySignals } from "../../repository-signals-types.ts";
import { toolInvocations, invocationOptions } from "./tool-command-evidence.ts";

const minOxlintMajor = 1;
const minOxlintMinor = 51;

/** Only explicit --noEmit proves that replacing tsc will not remove build output. */
export function textRunsTscTypeCheck(text: string): boolean {
  return toolInvocations(text).some((words) => {
    if (!/^tsc(?:@[^/]+)?$/.test(words[0] ?? "")) {
      return false;
    }
    const options = invocationOptions(words, [
      "--outDir",
      "--outFile",
      "--rootDir",
      "--baseUrl",
      "--module",
      "--target",
      "--lib",
      "--types",
      "--moduleResolution",
      "--jsx",
      "--tsBuildInfoFile",
    ]);
    if (options.some(({ name }) => ["--help", "-h", "--version", "-v"].includes(name))) {
      return false;
    }
    const last = options.filter(({ name }) => name === "--noEmit").at(-1);
    if (!last) {
      return false;
    }
    const next = words[last.index + 1];
    const value = last.value ?? (["true", "false"].includes(next ?? "") ? next : "true");
    return value === "true";
  });
}

function meetsMinimumOxlint(eslint: RepositorySignals["eslint"]): boolean {
  const { oxlintMajor, oxlintMinor } = eslint;
  if (oxlintMajor === undefined || oxlintMinor === undefined) {
    return false;
  }
  if (oxlintMajor > minOxlintMajor) {
    return true;
  }
  return oxlintMajor === minOxlintMajor && oxlintMinor >= minOxlintMinor;
}

function meetsTypeScript7(typescript: RepositorySignals["typescript"]): boolean {
  return typescript.major !== undefined && typescript.major >= 7;
}

export const oxlintTypeCheckWhy =
  "Oxlint's type-aware mode runs a TypeScript type checker inside the same program as linting, so it can replace a separate `tsc --noEmit` step and avoid the duplicate setup and analysis. The backend is `tsgolint` v7 (the TypeScript 7 native compiler, typescript-go) or the newer `tsrs` Rust port, which oxlint 1.92+ prefers when installed; both cover 59 of 61 typescript-eslint type-aware rules, and tsgolint benchmarks 12-18x faster than ESLint plus typescript-eslint on large TypeScript codebases. TypeScript 7.0+ is required, and some legacy tsconfig options (for example `baseUrl`) are unsupported.";

export const oxlintTypeCheckMeasurementHint =
  "Compare CI type-check wall-clock time and reported type errors before and after folding tsc --noEmit into oxlint --type-aware --type-check.";

function oxlintTypeCheckPrerequisite(repository: RepositorySignals): string {
  const needs: string[] = [];
  if (!meetsMinimumOxlint(repository.eslint)) {
    needs.push("upgrade oxlint to a current release (>=1.51.0; latest recommended)");
  }
  if (!repository.eslint.hasOxlintTypeAwareBackend) {
    needs.push("add `oxlint-tsgolint@7` or `tsrs` as a dev dependency");
  }
  if (!meetsTypeScript7(repository.typescript)) {
    needs.push(
      "move to TypeScript 7.0+ and migrate tsconfig options removed in TS7 (for example `baseUrl`)",
    );
  }
  if (needs.length === 0) {
    return "The repository's oxlint and TypeScript already meet the type-check prerequisites.";
  }
  return `Prerequisites: ${needs.join(", and ")}.`;
}

export function oxlintTypeCheckSuggestion(repository: RepositorySignals): string {
  return `Fold type checking into the lint pass with \`oxlint --type-aware --type-check\` and drop the separate tsc type-check invocation. ${oxlintTypeCheckPrerequisite(repository)}`;
}
