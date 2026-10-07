import type { RuleMeta } from "../../types.ts";

export const preferPnpm1210Meta = {
  id: "prefer-pnpm-12-10",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-pnpm-12-10.md",
} satisfies RuleMeta;

// 12.10 introduced faster cached metadata reads and workspace relinking.
export function pnpmVersionIsBelow1210(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") {
    return false;
  }
  const match =
    /^v?(\d+)(?:\.(\d+|x|\*)(?:\.(\d+|x|\*))?)?(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/i.exec(
      String(value).trim(),
    );
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 12 || (major === 12 && minor < 10);
}

export const pnpm1210Advice = {
  why: "pnpm 12 rewrote the CLI in Rust. pnpm 12.10 adds faster cached registry metadata reads, avoids metadata requests waiting behind tarball downloads, and speeds up existing workspace dependency relinking on macOS. Benefits depend on the dependency graph, platform, and cache state.",
  suggestion:
    "Upgrade pnpm pins to a stable 12.10.0 or later release, keeping packageManager and CI setup versions aligned. Review pnpm 12 compatibility differences before switching older major versions.",
  measurementHint:
    "Compare dependency resolution and install wall-clock time with cold and warm caches, and verify frozen-lockfile installs and project scripts still pass. The first run after upgrading may refill the metadata cache.",
  score: 45,
};
