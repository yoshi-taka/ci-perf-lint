const prettierCheckMatcher =
  /^(?:(?:npx|bunx|pnpm\s+exec|yarn\s+exec)\s+)?prettier\s+--check\s+([\s\S]+)$/;

/** Exact file scope of a plain `prettier --check <scope>` command, if any. */
export function prettierCheckTarget(segment: string): string | undefined {
  const match = prettierCheckMatcher.exec(segment.trim());
  const target = match?.[1]?.trim();
  if (!target) {
    return undefined;
  }
  return target;
}
