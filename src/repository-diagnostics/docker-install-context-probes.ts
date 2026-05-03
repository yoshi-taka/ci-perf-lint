import path from "node:path";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { NodeDockerfileLockfileKind } from "./docker-image-rule-catalog.ts";

export interface DockerInstallContextProbes {
  nodeLockfiles: Record<NodeDockerfileLockfileKind, boolean>;
  hasCargoManifest: boolean;
  hasGoMod: boolean;
  hasMavenPom: boolean;
  hasGradleBuild: boolean;
  hasGemfile: boolean;
}

export async function collectDockerInstallContextProbes(
  context: RepositoryScanContext,
  contextPath: string,
): Promise<DockerInstallContextProbes> {
  const hasNpmLockfile = await context.pathExists(path.join(contextPath, "package-lock.json"));
  const hasPnpmLockfile = await context.pathExists(path.join(contextPath, "pnpm-lock.yaml"));
  const hasYarnLockfile = await context.pathExists(path.join(contextPath, "yarn.lock"));
  const hasBunLockfile =
    (await context.pathExists(path.join(contextPath, "bun.lock"))) ||
    (await context.pathExists(path.join(contextPath, "bun.lockb")));
  const hasUvLockfile = await context.pathExists(path.join(contextPath, "uv.lock"));
  const hasCargoManifest = await context.pathExists(path.join(contextPath, "Cargo.toml"));
  const hasGoMod = await context.pathExists(path.join(contextPath, "go.mod"));
  const hasMavenPom = await context.pathExists(path.join(contextPath, "pom.xml"));
  const hasGradleBuild =
    (await context.pathExists(path.join(contextPath, "build.gradle"))) ||
    (await context.pathExists(path.join(contextPath, "build.gradle.kts"))) ||
    (await context.pathExists(path.join(contextPath, "settings.gradle"))) ||
    (await context.pathExists(path.join(contextPath, "settings.gradle.kts")));
  const hasGemfile = await context.pathExists(path.join(contextPath, "Gemfile"));

  return {
    nodeLockfiles: {
      npm: hasNpmLockfile,
      pnpm: hasPnpmLockfile,
      yarn: hasYarnLockfile,
      bun: hasBunLockfile,
      uv: hasUvLockfile,
    },
    hasCargoManifest,
    hasGoMod,
    hasMavenPom,
    hasGradleBuild,
    hasGemfile,
  };
}

export function dockerInstallContextHasSignals(probes: DockerInstallContextProbes): boolean {
  return (
    Object.values(probes.nodeLockfiles).some(Boolean) ||
    probes.hasCargoManifest ||
    probes.hasGoMod ||
    probes.hasMavenPom ||
    probes.hasGradleBuild ||
    probes.hasGemfile
  );
}
