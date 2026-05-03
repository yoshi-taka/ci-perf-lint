export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function hasAutomerge(config: Record<string, unknown>): boolean {
  if (config.automerge === true) {
    return true;
  }
  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  for (const rule of packageRules) {
    const ruleRecord = asRecord(rule);
    if (ruleRecord?.automerge === true) {
      return true;
    }
  }
  return false;
}

function isExternalExtend(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length === 0) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+>/.test(value) && !value.startsWith("local>");
}

export function hasExternalExtends(config: Record<string, unknown>): boolean {
  const extendsValue = config.extends;
  if (Array.isArray(extendsValue)) {
    return extendsValue.some(isExternalExtend);
  }
  return isExternalExtend(extendsValue);
}

export function getExtends(config: Record<string, unknown>): string[] {
  const extendsValue = config.extends;
  if (Array.isArray(extendsValue)) {
    return extendsValue.filter((v): v is string => typeof v === "string");
  }
  return typeof extendsValue === "string" ? [extendsValue] : [];
}

export function findRenovateKeyLocation(
  text: string,
  key: string,
): { line: number; column: number } {
  const regex = new RegExp(`"${key}"`);
  const match = regex.exec(text);
  if (match?.index != null) {
    const before = text.slice(0, match.index);
    const lines = before.split("\n");
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
  }
  return { line: 1, column: 1 };
}

export const renovateConfigPaths = [
  "renovate.json",
  ".github/renovate.json",
  ".renovaterc.json",
  ".renovaterc",
];
