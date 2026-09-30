const ESLINT_CONCURRENCY_MAJOR = 9;
const ESLINT_CONCURRENCY_MINOR = 34;

const eslintExecPattern =
  /(?:^|[\s;&|()])(?:npx\s+|bunx\s+|bun\s+x\s+|npm\s+(?:exec|x)\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+(?:exec|dlx)\s+)?eslint(?=\s|$)([^\n;&|]*)/gi;

const eslintNonLintFlagPattern = /--(?:version|help|init|print-config|env-info|mcp)\b/;

export function eslintVersionSupportsConcurrency(major?: number, minor?: number): boolean {
  if (major === undefined) {
    return false;
  }
  if (major !== ESLINT_CONCURRENCY_MAJOR) {
    return major > ESLINT_CONCURRENCY_MAJOR;
  }
  return (minor ?? 0) >= ESLINT_CONCURRENCY_MINOR;
}

export function eslintVersionIsPromotableToConcurrency(major?: number, minor?: number): boolean {
  if (major === undefined) {
    return false;
  }
  if (major !== ESLINT_CONCURRENCY_MAJOR) {
    return major > ESLINT_CONCURRENCY_MAJOR;
  }
  return (minor ?? 0) < ESLINT_CONCURRENCY_MINOR;
}

export function textRunsEslintWithoutConcurrency(text: string): boolean {
  eslintExecPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = eslintExecPattern.exec(text))) {
    const args = match[1] ?? "";
    if (eslintNonLintFlagPattern.test(args)) {
      continue;
    }
    if (!/--concurrency(?:=|\s|$)/.test(args)) {
      return true;
    }
  }
  return false;
}
