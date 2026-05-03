import {
  instructionLooksBunInstallWithoutFrozenLockfile,
  instructionLooksNpmInstallInsteadOfCi,
  instructionLooksPnpmInstallWithoutFrozenLockfile,
  instructionLooksUvProjectSyncWithoutFrozenLockfile,
  instructionLooksYarnInstallWithoutImmutableLockfile,
} from "./dockerfile-instructions.ts";

const dockerfileNpmInstallWithLockfileDocsPath =
  "docs/rules/dockerfile-uses-npm-install-with-lockfile.md";
const dockerfilePnpmInstallWithoutFrozenLockfileDocsPath =
  "docs/rules/dockerfile-pnpm-install-without-frozen-lockfile.md";
const dockerfileYarnInstallWithoutImmutableLockfileDocsPath =
  "docs/rules/dockerfile-yarn-install-without-immutable-lockfile.md";
const dockerfileBunInstallWithoutFrozenLockfileDocsPath =
  "docs/rules/dockerfile-bun-install-without-frozen-lockfile.md";
const dockerfileUvSyncWithoutFrozenLockfileDocsPath =
  "docs/rules/dockerfile-uv-sync-without-frozen-lockfile.md";
export const dockerfileCargoInstallWithoutLockedDocsPath =
  "docs/rules/dockerfile-cargo-install-without-locked.md";
export const dockerfileCargoBuildReleaseWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-cargo-build-release-without-cache-mount.md";
export const dockerfileGoModDownloadWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-go-mod-download-without-cache-mount.md";
export const dockerfileGoBuildWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-go-build-without-cache-mount.md";
export const dockerfileCompiledBuildCopiesSourceLayerDocsPath =
  "docs/rules/dockerfile-compiled-build-copies-source-layer.md";
export const dockerfileMavenGoOfflineWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-maven-go-offline-without-cache-mount.md";
export const dockerfileMavenBuildWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-maven-build-without-cache-mount.md";
export const dockerfileGradleDependenciesWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-gradle-dependencies-without-cache-mount.md";
export const dockerfileGradleBuildWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-gradle-build-without-cache-mount.md";
export const dockerfileBundleInstallWithoutCacheMountDocsPath =
  "docs/rules/dockerfile-bundle-install-without-cache-mount.md";
export const dockerfileAptInstallWithoutCleanupOrCacheMountDocsPath =
  "docs/rules/dockerfile-apt-install-without-cleanup-or-cache-mount.md";
export const dockerfileAptInstallWithoutNoInstallRecommendsDocsPath =
  "docs/rules/dockerfile-apt-install-without-no-install-recommends.md";
export const dockerfileApkAddWithoutNoCacheOrCacheMountDocsPath =
  "docs/rules/dockerfile-apk-add-without-no-cache-or-cache-mount.md";
export const dockerfileAddWithoutClearNeedDocsPath =
  "docs/rules/dockerfile-add-without-clear-need.md";
export const dockerfileBaseImageUsesFloatingTagDocsPath =
  "docs/rules/dockerfile-base-image-uses-floating-tag.md";
export const dockerfileFinalStageCopiesBroadContextDocsPath =
  "docs/rules/dockerfile-final-stage-copies-broad-context.md";

export type NodeDockerfileLockfileKind = "npm" | "pnpm" | "yarn" | "bun" | "uv";

interface NodeDockerfileLockfileDiagnosticRule {
  lockfile: NodeDockerfileLockfileKind;
  matcher: (instruction: string) => boolean;
  ruleId: string;
  docsPath: string;
  message: (dockerfileRelativePath: string) => string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: (dockerfileRelativePath: string) => string;
  score: number;
}

export const nodeDockerfileLockfileDiagnosticRules: readonly NodeDockerfileLockfileDiagnosticRule[] =
  [
    {
      lockfile: "npm",
      matcher: instructionLooksNpmInstallInsteadOfCi,
      ruleId: "dockerfile-uses-npm-install-with-lockfile",
      docsPath: dockerfileNpmInstallWithLockfileDocsPath,
      message: (dockerfileRelativePath) =>
        `Dockerfile ${dockerfileRelativePath} uses \`npm install\`-style dependency installation even though package-lock.json is present in the build context.`,
      why: "`npm ci` is designed for clean, lockfile-based CI and Docker installs. Using `npm install`, `npm i`, `npm -i`, or `npm add` can spend time resolving dependencies and can mutate lockfile state instead of strictly installing from it.",
      suggestion:
        "Use `npm ci` in the Dockerfile when package-lock.json is present, and keep package manifest and lockfile COPY steps before the broader source COPY.",
      measurementHint:
        "Compare Docker dependency install duration and rebuild stability before and after replacing npm install-style commands with npm ci.",
      aiHandoff: (dockerfileRelativePath) =>
        `Review ${dockerfileRelativePath} and replace Docker build dependency installation via \`npm install\`, \`npm i\`, \`npm -i\`, or \`npm add\` with \`npm ci\` where package-lock.json is available.`,
      score: 82,
    },
    {
      lockfile: "pnpm",
      matcher: instructionLooksPnpmInstallWithoutFrozenLockfile,
      ruleId: "dockerfile-pnpm-install-without-frozen-lockfile",
      docsPath: dockerfilePnpmInstallWithoutFrozenLockfileDocsPath,
      message: (dockerfileRelativePath) =>
        `Dockerfile ${dockerfileRelativePath} runs \`pnpm install\` without \`--frozen-lockfile\` even though pnpm-lock.yaml is present in the build context.`,
      why: "`pnpm install --frozen-lockfile` keeps Docker dependency installation tied to the committed lockfile. Without it, the build can spend time resolving dependency metadata and may fail or drift differently from the intended locked dependency graph.",
      suggestion:
        "Add `--frozen-lockfile` to Dockerfile pnpm install steps. For stronger BuildKit caching, consider pairing `pnpm fetch --frozen-lockfile` with `pnpm install --frozen-lockfile --offline`.",
      measurementHint:
        "Compare Docker dependency install duration and lockfile reproducibility before and after adding --frozen-lockfile.",
      aiHandoff: (dockerfileRelativePath) =>
        `Review ${dockerfileRelativePath} and add \`--frozen-lockfile\` to Docker build \`pnpm install\` commands where pnpm-lock.yaml is available.`,
      score: 81,
    },
    {
      lockfile: "yarn",
      matcher: instructionLooksYarnInstallWithoutImmutableLockfile,
      ruleId: "dockerfile-yarn-install-without-immutable-lockfile",
      docsPath: dockerfileYarnInstallWithoutImmutableLockfileDocsPath,
      message: (dockerfileRelativePath) =>
        `Dockerfile ${dockerfileRelativePath} runs Yarn dependency installation without an immutable lockfile flag even though yarn.lock is present in the build context.`,
      why: "Docker dependency installs should be tied to the committed lockfile. Yarn Classic uses `--frozen-lockfile` for this, while modern Yarn uses `--immutable`; `yarn add` is also a dependency mutation command rather than a clean Docker install.",
      suggestion:
        "Use `yarn install --immutable` for modern Yarn or `yarn install --frozen-lockfile` for Yarn Classic in Dockerfiles, and avoid `yarn add` during image builds.",
      measurementHint:
        "Compare Docker dependency install duration and lockfile reproducibility before and after using Yarn immutable lockfile installs.",
      aiHandoff: (dockerfileRelativePath) =>
        `Review ${dockerfileRelativePath} and replace Docker build Yarn dependency installation with a lockfile-immutable install, using \`yarn install --immutable\` or \`yarn install --frozen-lockfile\` as appropriate for the repository's Yarn version.`,
      score: 80,
    },
    {
      lockfile: "bun",
      matcher: instructionLooksBunInstallWithoutFrozenLockfile,
      ruleId: "dockerfile-bun-install-without-frozen-lockfile",
      docsPath: dockerfileBunInstallWithoutFrozenLockfileDocsPath,
      message: (dockerfileRelativePath) =>
        `Dockerfile ${dockerfileRelativePath} runs Bun dependency installation without \`--frozen-lockfile\` even though a Bun lockfile is present in the build context.`,
      why: "`bun ci` and `bun install --frozen-lockfile` install exact versions from the committed Bun lockfile and fail when package.json is out of sync. Plain `bun install`, `bun i`, or `bun add` can update dependency state during the Docker build.",
      suggestion:
        "Use `bun ci` or `bun install --frozen-lockfile` in Dockerfiles when bun.lock or bun.lockb is present, and avoid `bun add` during image builds.",
      measurementHint:
        "Compare Docker dependency install duration and lockfile reproducibility before and after using Bun frozen lockfile installs.",
      aiHandoff: (dockerfileRelativePath) =>
        `Review ${dockerfileRelativePath} and replace Docker build Bun dependency installation with \`bun ci\` or \`bun install --frozen-lockfile\` where a Bun lockfile is available.`,
      score: 80,
    },
    {
      lockfile: "uv",
      matcher: instructionLooksUvProjectSyncWithoutFrozenLockfile,
      ruleId: "dockerfile-uv-sync-without-frozen-lockfile",
      docsPath: dockerfileUvSyncWithoutFrozenLockfileDocsPath,
      message: (dockerfileRelativePath) =>
        `Dockerfile ${dockerfileRelativePath} runs project-level \`uv sync\` without \`--frozen\` or \`--locked\` even though uv.lock is present in the build context.`,
      why: "uv can update the lockfile automatically during sync. Docker builds should install from the committed uv.lock so dependency resolution does not happen as part of image construction.",
      suggestion:
        "Use `uv sync --frozen` for Docker project installation, or `uv sync --locked` when you want uv to check that uv.lock is still up to date.",
      measurementHint:
        "Compare Docker dependency install duration and lockfile reproducibility before and after using frozen or locked uv sync.",
      aiHandoff: (dockerfileRelativePath) =>
        `Review ${dockerfileRelativePath} and add \`--frozen\` or \`--locked\` to project-level Docker build \`uv sync\` commands where uv.lock is available. Keep dependency-only \`uv sync --no-install-project\` layering intact when present.`,
      score: 81,
    },
  ];
