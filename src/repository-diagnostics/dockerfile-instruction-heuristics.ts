const commentStripPattern = /\s+#.*$/;
const runMountCachePattern = /^run\b[\s\S]*--mount=type=cache\b/i;
const runBindMountPattern = /^run\b[\s\S]*--mount=(?:type=bind\b|[^\s]*target=\.?(?:,|\s|$))/i;
const npmInstallMatchPattern = /\bnpm\s+(?:install|i|add|-i)(?:\s+[^;&|]+)?/gi;
const globalFlagPattern = /\s(?:-g|--global)(?:\s|$)/i;
const pnpmInstallRunPattern = /^run\b[\s\S]*\bpnpm\s+(?:install|i)(?:\s|$)/i;
const frozenLockfilePattern = /\s--frozen-lockfile(?:\s|$)/i;
const immutableOrFrozenPattern = /\s--(?:immutable|frozen-lockfile)(?:\s|$)/i;
const yarnInstallMatchPattern = /\byarn\s+(?:install|add)(?:\s+[^;&|]+)?/gi;
const globalAddPattern = /\s(?:global\s+add|add\s+global|-g|--global)(?:\s|$)/i;
const bareYarnRunPattern = /^run\b\s+yarn\s*$/i;
const bunInstallMatchPattern = /\bbun\s+(?:install|i|add)(?:\s+[^;&|]+)?/gi;
const uvSyncRunPattern = /^run\b[\s\S]*\buv\s+sync(?:\s|$)/i;
const frozenOrLockedPattern = /\s--(?:frozen|locked)(?:\s|$)/i;
const noInstallPattern = /\s--no-install-(?:project|workspace|package)(?:\s|$)/i;
const onlyDevGroupPattern = /\s--only-(?:dev|group)(?:\s|$)/i;
const cargoInstallRunPattern = /^run\b[\s\S]*\bcargo\s+install(?:\s|$)/i;
const lockedPattern = /\s--locked(?:\s|$)/i;
const pathFlagPattern = /\s--path(?:=|\s+)/i;
const cargoBuildReleaseRunPattern = /^run\b[\s\S]*\bcargo\s+build\b[\s\S]*\s--release(?:\s|$)/i;
const goModDownloadRunPattern = /^run\b[\s\S]*\bgo\s+mod\s+download(?:\s|$)/i;
const goBuildRunPattern = /^run\b[\s\S]*\bgo\s+build(?:\s|$)/i;
const cargoBuildRunPattern = /^run\b[\s\S]*\bcargo\s+build\b/i;
const mvnGoOfflineRunPattern =
  /^run\b[\s\S]*\b(?:mvn|mvnw|[.][/\\]mvnw)\b[\s\S]*\bdependency:go-offline\b/i;
const mvnBuildRunPattern =
  /^run\b[\s\S]*\b(?:mvn|mvnw|[.][/\\]mvnw)\b[\s\S]*\b(?:clean\s+)?(?:package|install|verify)\b/i;
const gradleDependenciesRunPattern =
  /^run\b[\s\S]*\b(?:gradle|gradlew|[.][/\\]gradlew)\b[\s\S]*\bdependencies\b/i;
const gradleBuildRunPattern =
  /^run\b[\s\S]*\b(?:gradle|gradlew|[.][/\\]gradlew)\b[\s\S]*\b(?:build|assemble|bootJar|shadowJar)\b/i;
const bundleInstallRunPattern = /^run\b[\s\S]*\bbundle\s+install(?:\s|$)/i;
const aptUpdateInstallRunPattern = /^run\b[\s\S]*\bapt(?:-get)?\s+(?:update|install)(?:\s|$)/i;
const aptCacheMountPattern =
  /^run\b[\s\S]*--mount=type=cache,[^\s]*target=\/var\/(?:cache|lib)\/apt\b/i;
const rmVarLibAptPattern = /\brm\s+-rf\s+\/var\/lib\/apt\/lists\/\*/i;
const aptInstallRunPattern = /^run\b[\s\S]*\bapt(?:-get)?\s+install(?:\s|$)/i;
const noInstallRecommendsPattern = /\s--no-install-recommends(?:\s|$)/i;
const apkAddRunPattern = /^run\b[\s\S]*\bapk\s+add(?:\s|$)/i;
const noCachePattern = /\s--no-cache(?:\s|$)/i;
const apkCacheMountPattern = /^run\b[\s\S]*--mount=type=cache,[^\s]*target=\/var\/cache\/apk\b/i;

function stripDockerfileComment(text: string): string {
  return text.replace(commentStripPattern, "").trim();
}

export function instructionLooksNpmInstallInsteadOfCi(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  const matches = normalized.matchAll(npmInstallMatchPattern);

  for (const match of matches) {
    const command = match[0];
    if (!globalFlagPattern.test(command)) {
      return true;
    }
  }

  return false;
}

export function instructionLooksPnpmInstallWithoutFrozenLockfile(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return pnpmInstallRunPattern.test(normalized) && !frozenLockfilePattern.test(normalized);
}

export function instructionLooksYarnInstallWithoutImmutableLockfile(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  if (!immutableOrFrozenPattern.test(normalized)) {
    const matches = normalized.matchAll(yarnInstallMatchPattern);
    for (const match of matches) {
      const command = match[0];
      if (!globalAddPattern.test(command)) {
        return true;
      }
    }

    if (bareYarnRunPattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

export function instructionLooksBunInstallWithoutFrozenLockfile(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  if (!frozenLockfilePattern.test(normalized)) {
    const matches = normalized.matchAll(bunInstallMatchPattern);
    for (const match of matches) {
      const command = match[0];
      if (!globalFlagPattern.test(command)) {
        return true;
      }
    }
  }

  return false;
}

export function instructionLooksUvProjectSyncWithoutFrozenLockfile(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return (
    uvSyncRunPattern.test(normalized) &&
    !frozenOrLockedPattern.test(normalized) &&
    !noInstallPattern.test(normalized) &&
    !onlyDevGroupPattern.test(normalized)
  );
}

export function instructionLooksCargoInstallWithoutLocked(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return (
    cargoInstallRunPattern.test(normalized) &&
    !lockedPattern.test(normalized) &&
    !pathFlagPattern.test(normalized)
  );
}

export function instructionLooksCargoBuildReleaseWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return cargoBuildReleaseRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksGoModDownloadWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return goModDownloadRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksGoBuildWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return goBuildRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

function instructionLooksCompiledBuildWithoutBindMount(
  instruction: string,
): "Go" | "Rust" | undefined {
  const normalized = stripDockerfileComment(instruction);
  if (goBuildRunPattern.test(normalized) && !runBindMountPattern.test(normalized)) {
    return "Go";
  }

  if (cargoBuildRunPattern.test(normalized) && !runBindMountPattern.test(normalized)) {
    return "Rust";
  }

  return undefined;
}

export function instructionLooksBroadCompiledBuildWithoutBindMount(
  instruction: string,
): "Go" | "Rust" | undefined {
  return instructionLooksCompiledBuildWithoutBindMount(instruction);
}

export function instructionLooksMavenGoOfflineWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return mvnGoOfflineRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksMavenBuildWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return mvnBuildRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksGradleDependenciesWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return gradleDependenciesRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksGradleBuildWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return gradleBuildRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksBundleInstallWithoutCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return bundleInstallRunPattern.test(normalized) && !runMountCachePattern.test(normalized);
}

export function instructionLooksAptInstallWithoutCleanupOrCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return (
    aptUpdateInstallRunPattern.test(normalized) &&
    !aptCacheMountPattern.test(normalized) &&
    !rmVarLibAptPattern.test(normalized)
  );
}

export function instructionLooksAptInstallWithoutNoInstallRecommends(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return aptInstallRunPattern.test(normalized) && !noInstallRecommendsPattern.test(normalized);
}

export function instructionLooksApkAddWithoutNoCacheOrCacheMount(instruction: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  return (
    apkAddRunPattern.test(normalized) &&
    !noCachePattern.test(normalized) &&
    !apkCacheMountPattern.test(normalized)
  );
}
