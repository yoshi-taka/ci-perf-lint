import type { RepositorySignals } from "../../repository-signals-types.ts";

const minOxlintMajor = 1;
const minOxlintMinor = 51;

const tscCommandPattern = /(?<![\w-])tsc\b([^\n;&|]*)/gi;
const tscNoEmitPattern = /--noEmit\b/;
const tscBuildPattern = /(?:^|\s)(?:-b|--build)(?=\s|$)/;

/** True when shell text runs `tsc` in a type-check-only mode (`--noEmit`, `-b`, `--build`). */
export function textRunsTscTypeCheck(text: string): boolean {
  tscCommandPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tscCommandPattern.exec(text))) {
    const rest = match[1] ?? "";
    if (tscNoEmitPattern.test(rest) || tscBuildPattern.test(rest)) {
      return true;
    }
  }
  return false;
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
  "Oxlint's type-aware mode runs the TypeScript type checker (tsgolint) inside the same program as linting, so it can replace a separate `tsc --noEmit` step and avoid the duplicate setup and analysis. tsgolint v7 is built on the TypeScript 7 native compiler (typescript-go), covers 59 of 61 typescript-eslint type-aware rules, and is 12-18x faster than ESLint plus typescript-eslint on large TypeScript codebases. TypeScript 7.0+ is required, and some legacy tsconfig options (for example `baseUrl`) are unsupported.";

export const oxlintTypeCheckMeasurementHint =
  "Compare CI type-check wall-clock time and reported type errors before and after folding tsc --noEmit into oxlint --type-aware --type-check.";

function oxlintTypeCheckPrerequisite(repository: RepositorySignals): string {
  const needs: string[] = [];
  if (!meetsMinimumOxlint(repository.eslint)) {
    needs.push("upgrade oxlint to a current release (>=1.51.0; latest recommended)");
  }
  if (!repository.eslint.hasOxlintTsgolint) {
    needs.push("add `oxlint-tsgolint@7` as a dev dependency");
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
