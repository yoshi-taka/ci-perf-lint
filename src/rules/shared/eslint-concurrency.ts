import { toolInvocations, invocationOptions } from "./tool-command-evidence.ts";

const ESLINT_CONCURRENCY_MAJOR = 9;
const ESLINT_CONCURRENCY_MINOR = 34;

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
    return false;
  }
  return (minor ?? 0) < ESLINT_CONCURRENCY_MINOR;
}

export function textRunsEslintWithoutConcurrency(text: string): boolean {
  return toolInvocations(text).some((words) => {
    if (!/^eslint(?:@[^/]+)?$/.test(words[0] ?? "")) {
      return false;
    }
    const flags = invocationOptions(words, [
      "--format",
      "-f",
      "--output-file",
      "--parser",
      "--parser-options",
      "--rule",
      "--plugin",
      "--ext",
      "--ignore-pattern",
      "--env",
      "--global",
      "--cache-location",
      "--concurrency",
      "--print-config",
    ]);
    return !flags.some(({ name }) =>
      [
        "--version",
        "-v",
        "--help",
        "-h",
        "--init",
        "--print-config",
        "--env-info",
        "--mcp",
        "--concurrency",
      ].includes(name),
    );
  });
}
