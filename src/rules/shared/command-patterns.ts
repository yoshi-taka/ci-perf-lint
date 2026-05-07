export const npmRunMatcher =
  /^\s*npm\s+(?:run|run-script)\s+([A-Za-z0-9:_./-]+)((?:\s+--[^\s]+)*)((?:\s+--(?:\s+.*)?)?)\s*$/;

export function detectSimpleNpmRunFromText(
  text: string,
): { script: string; replacement: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return undefined;
  }
  const match = trimmed.match(npmRunMatcher);
  const script = match?.[1];
  if (!script) {
    return undefined;
  }
  const passthrough = match[3]?.trim() ?? "";
  return {
    script,
    replacement: passthrough ? `node --run ${script} ${passthrough}` : `node --run ${script}`,
  };
}

export const MAKE_LIKE_RE = /^\s*(?:make|gmake)\b/;
export const HAS_PARALLEL_FLAG_RE = /(?:^|\s)(?:-j\s*\d*|--jobs(?:\s*=\s*\d+)?|--parallel)\b/;

const pipInstallPattern = /\bpip\s+install\b/i;
const uvPipInstallPattern = /\buv\s+pip\s+install\b/i;

export function detectPlainPipInstall(text: string): string | undefined {
  if (!pipInstallPattern.test(text) || uvPipInstallPattern.test(text)) {
    return undefined;
  }
  return text.replace(/^.*\bpip\s+install\s*/i, "").trim();
}

export function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}
