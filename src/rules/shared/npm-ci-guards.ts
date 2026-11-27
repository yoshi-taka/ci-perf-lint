const NPM_CI = /\bnpm\s+(?:ci|clean-install)\b/i;

interface ExistenceGuard {
  index: number;
  end: number;
  path: string;
  positive: boolean;
}

function normalizePathToken(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/** Existence checks on a cached node_modules path, including `[[ ... ]]` forms. */
function existenceGuards(command: string): ExistenceGuard[] {
  const guards: ExistenceGuard[] = [];
  const patterns: [RegExp, boolean][] = [
    [/\[\[\s*!\s*-d\s+([^\]\r\n;]+)\]\]/gi, false],
    [/\[\[\s*-d\s+([^\]\r\n;]+)\]\](?=\s*\|\|)/gi, true],
    [/\[\s*!\s*-d\s+([^\]\r\n;]+)\]/gi, false],
    [/test\s+!\s*-d\s+([^\s;\r\n]+)/gi, false],
    [/test\s+-d\s+([^\s;\r\n]+)(?=\s*\|\|)/gi, true],
  ];
  for (const [pattern, positive] of patterns) {
    for (const match of command.matchAll(pattern)) {
      guards.push({
        index: match.index,
        end: match.index + match[0].length,
        path: match[1] ?? "",
        positive,
      });
    }
  }
  return guards;
}

/**
 * Treat npm ci as guarded when an earlier existence check on the same cached
 * path controls it. The raw command keeps newlines, so multi-line if blocks
 * are handled without collapsing the text into a single regex line.
 */
export function npmCiIsGuarded(command: string, cachedPaths: readonly string[]): boolean {
  const ci = NPM_CI.exec(command);
  if (!ci) {
    return false;
  }
  const cached = cachedPaths.map(normalizePathToken);
  return existenceGuards(command).some((guard) => {
    if (guard.end > ci.index || !cached.includes(normalizePathToken(guard.path))) {
      return false;
    }
    if (guard.positive) {
      return command.slice(guard.end, ci.index).includes("||");
    }
    return /&&|\bthen\b|[;\r\n]/.test(command.slice(guard.end, ci.index));
  });
}
