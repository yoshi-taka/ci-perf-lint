import path from "node:path";
import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  collectDockerfileData,
  type DockerBuildTarget,
  normalizeRelativePath,
} from "./docker-build-targets.ts";
import {
  dockerfileSourceLooksAllowedArtifact,
  dockerfileSourceLooksBroadOrVolatile,
  dockerfileSourceLooksSmall,
  dockerignoreCoversRoot,
  lineLooksInstall,
  lineLooksWideCopy,
  parseDockerfileCopyInstruction,
  runInstructionModifiesPath,
} from "./dockerfile-instructions.ts";
import { experimentalArtifactDirs } from "./waste-patterns.ts";

const missingDockerignoreDocsPath = "docs/rules/missing-dockerignore-for-build-context.md";
const weakDockerignoreDocsPath = "docs/rules/dockerignore-misses-noisy-build-context-paths.md";
const dockerfileCopyOrderDocsPath = "docs/rules/dockerfile-copies-all-before-deps.md";
const dockerfileCopyLinkWithoutCacheBenefitDocsPath =
  "docs/rules/dockerfile-copy-link-without-cache-benefit.md";

async function listVisibleFiles(
  context: RepositoryScanContext,
  contextPath: string,
): Promise<string[]> {
  const entries = await context.readDirectoryEntries(contextPath);
  return entries.map((entry) => entry.name);
}

async function looksLikeRelevantBuildContext(
  context: RepositoryScanContext,
  repoRoot: string,
  target: DockerBuildTarget,
): Promise<boolean> {
  if (!(await context.pathExists(target.contextPath))) {
    return false;
  }

  const relativePath = normalizeRelativePath(repoRoot, target.contextPath);
  if (relativePath === "." || relativePath === "") {
    return true;
  }

  if (await context.pathExists(target.dockerfilePath)) {
    return true;
  }

  const visibleFiles = await listVisibleFiles(context, target.contextPath);
  return visibleFiles.some((name) =>
    [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "requirements.txt",
      "pyproject.toml",
      "Gemfile",
      "Gemfile.lock",
      "go.mod",
      "go.sum",
      "Cargo.toml",
      "Cargo.lock",
    ].includes(name),
  );
}

export async function collectDockerignoreDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  for (const target of targets) {
    if (!(await looksLikeRelevantBuildContext(context, repoRoot, target))) {
      continue;
    }

    const dockerignorePath = path.join(target.contextPath, ".dockerignore");
    if (await context.pathExists(dockerignorePath)) {
      const dockerignoreText = await context.readTextFileOrWarn(dockerignorePath);
      if (!dockerignoreText) {
        continue;
      }

      const visibleFiles = await listVisibleFiles(context, target.contextPath);
      const noisyRoots = visibleFiles.filter((name) =>
        [
          ".git",
          ".github",
          "node_modules",
          "dist",
          "build",
          ".next",
          ".turbo",
          "coverage",
          ...experimentalArtifactDirs,
        ].includes(name),
      );
      const uncoveredRoots = noisyRoots.filter(
        (name) => !dockerignoreCoversRoot(dockerignoreText, name),
      );
      if (uncoveredRoots.length === 0) {
        continue;
      }

      const representativePath = normalizeRelativePath(repoRoot, target.contextPath);
      diagnostics.push({
        ruleId: "dockerignore-misses-noisy-build-context-paths",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: weakDockerignoreDocsPath,
        workflow: repository.primaryWorkflowPath ?? target.workflow,
        location: {
          path: normalizeRelativePath(repoRoot, dockerignorePath),
          line: 1,
          column: 1,
        },
        message: `Docker build context ${representativePath === "." ? "`.`" : `\`${representativePath}\``} has a .dockerignore, but it does not exclude ${uncoveredRoots.map((name) => `\`${name}\``).join(", ")}.`,
        why: "Noisy generated, dependency, VCS, and local-only directories can still enter broad COPY layers, increasing context transfer time, image size, and cache invalidations even when a .dockerignore file exists.",
        suggestion:
          "Extend .dockerignore to exclude noisy paths that do not need to be sent to the Docker build context, especially generated output, dependency directories, VCS metadata, and CI metadata.",
        measurementHint:
          "Compare Docker build context size and broad COPY layer size before and after tightening .dockerignore.",
        aiHandoff: `Review ${normalizeRelativePath(repoRoot, dockerignorePath)} and add ignore entries for ${uncoveredRoots.map((name) => `\`${name}\``).join(", ")} unless the Dockerfile intentionally copies those paths from the build context.`,
        score: 69,
      });
      continue;
    }

    const visibleFiles = await listVisibleFiles(context, target.contextPath);
    const noisyRoots = visibleFiles.filter((name) =>
      [
        ".git",
        "node_modules",
        "dist",
        "build",
        ".next",
        ".turbo",
        "coverage",
        ...experimentalArtifactDirs,
      ].includes(name),
    );
    const representativePath = normalizeRelativePath(repoRoot, target.contextPath);
    diagnostics.push({
      ruleId: "missing-dockerignore-for-build-context",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: missingDockerignoreDocsPath,
      workflow: repository.primaryWorkflowPath ?? target.workflow,
      location: {
        path: normalizeRelativePath(repoRoot, target.dockerfilePath),
        line: 1,
        column: 1,
      },
      message: `Docker build context ${representativePath === "." ? "`.`" : `\`${representativePath}\``} does not contain a visible \`.dockerignore\` file.`,
      why: `Without \`.dockerignore\`, irrelevant files in the build context can increase context transfer time and invalidate Docker cache layers more often${noisyRoots.length > 0 ? `, especially when ${noisyRoots.map((name) => `\`${name}\``).join(", ")} exist in the context root` : ""}.`,
      suggestion:
        "Add a .dockerignore file for this build context and exclude files that do not affect the image, especially large generated, dependency, VCS, and local-only directories.",
      measurementHint:
        "Compare Docker build context size, cache reuse, and wall-clock build time before and after adding .dockerignore.",
      aiHandoff: `Review the Docker build context rooted at ${representativePath === "." ? "repo root" : `\`${representativePath}\``} and add a \`.dockerignore\` file so irrelevant files do not bloat context transfer or invalidate cache.`,
      score: 67,
    });
  }

  return diagnostics;
}

export async function collectDockerfileCopyOrderDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    const dockerfileData = await collectDockerfileData(context, target.dockerfilePath);
    if (!dockerfileData) {
      continue;
    }

    let broadCopyLine: number | undefined;
    let offendingInstallLine: number | undefined;
    const { lines } = dockerfileData;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (/^\s*from\b/i.test(line)) {
        broadCopyLine = undefined;
      }

      if (broadCopyLine === undefined && lineLooksWideCopy(line)) {
        broadCopyLine = index + 1;
        continue;
      }

      if (broadCopyLine !== undefined && lineLooksInstall(line)) {
        offendingInstallLine = index + 1;
        break;
      }
    }

    if (!broadCopyLine || !offendingInstallLine) {
      continue;
    }

    const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    diagnostics.push({
      ruleId: "dockerfile-copies-all-before-deps",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileCopyOrderDocsPath,
      workflow: repository.primaryWorkflowPath ?? target.workflow,
      location: {
        path: dockerfileRelativePath,
        line: broadCopyLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} copies broad source context before running dependency installation at line ${offendingInstallLine}.`,
      why: "When a Dockerfile copies the whole source tree before installing dependencies, small code changes can invalidate the dependency layer and force package reinstall work on rebuilds.",
      suggestion:
        "Copy dependency manifests first, run the dependency install step, and only then copy the broader source tree so code-only changes can reuse cached dependency layers.",
      measurementHint:
        "Compare rebuild time after a small source-only change before and after reordering Dockerfile COPY and install instructions.",
      aiHandoff: `Review ${dockerfileRelativePath} and move broad \`COPY\` instructions after dependency manifest copy and install steps so code-only changes can reuse Docker dependency cache layers.`,
      score: 76,
    });
  }

  return diagnostics;
}

export async function collectDockerfileCopyLinkDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    const dockerfileData = await collectDockerfileData(context, target.dockerfilePath);
    if (!dockerfileData) {
      continue;
    }

    const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    const { instructions, fromInstructionIndexes, finalFromInstructionIndex } = dockerfileData;

    for (let index = 0; index < instructions.length; index += 1) {
      const instruction = instructions[index];
      if (!instruction) {
        continue;
      }

      const copyInstruction = parseDockerfileCopyInstruction(instruction);
      if (!copyInstruction?.linked) {
        continue;
      }

      const currentStageStart = fromInstructionIndexes
        .filter((fromIndex) => fromIndex <= index)
        .at(-1);
      const inFinalStage = currentStageStart === finalFromInstructionIndex;
      const allSourcesAreAllowedArtifacts =
        copyInstruction.sources.length > 0 &&
        copyInstruction.sources.every((source) => dockerfileSourceLooksAllowedArtifact(source));
      const copiedPathIsLaterMutated = instructions
        .slice(index + 1)
        .some((candidate) =>
          runInstructionModifiesPath(candidate.text, copyInstruction.destination),
        );

      const reasons: string[] = [];
      if (!inFinalStage) {
        reasons.push("it is used before the final Docker stage");
      }
      if (copyInstruction.sources.some((source) => dockerfileSourceLooksBroadOrVolatile(source))) {
        reasons.push("it copies broad or frequently-changing source paths");
      }
      if (
        copyInstruction.sources.every((source) => dockerfileSourceLooksSmall(source)) &&
        copyInstruction.sources.length > 0
      ) {
        reasons.push("it only copies small manifest-style files");
      }
      if (copiedPathIsLaterMutated) {
        reasons.push("a later RUN instruction modifies the copied destination");
      }
      if (inFinalStage && !allSourcesAreAllowedArtifacts) {
        reasons.push(
          "it is not limited to final-stage build artifacts such as dist/, build/, or public/",
        );
      }

      if (reasons.length === 0) {
        continue;
      }

      diagnostics.push({
        ruleId: "dockerfile-copy-link-without-cache-benefit",
        severity: "error",
        confidence: "medium",
        scope: "repository",
        docsPath: dockerfileCopyLinkWithoutCacheBenefitDocsPath,
        workflow: repository.primaryWorkflowPath ?? target.workflow,
        location: {
          path: dockerfileRelativePath,
          line: instruction.startLine,
          column: 1,
        },
        message: `Dockerfile ${dockerfileRelativePath} uses \`COPY --link\` where cache reuse is unlikely because ${reasons.join(" and ")}.`,
        why: "`COPY --link` pays extra build graph and layer-linking overhead. It is only likely to help when a relatively large, stable artifact copy can be reused independently, usually in the final image stage.",
        suggestion:
          "Remove --link from this COPY, or keep it only for final-stage copies of stable generated artifacts such as dist/, build/, or public/.",
        measurementHint:
          "Compare Docker build wall-clock time and cache-hit behavior before and after removing --link from cache-hostile COPY instructions.",
        aiHandoff: `Review ${dockerfileRelativePath} and remove \`--link\` from cache-hostile Dockerfile COPY instructions. Keep it only for final-stage artifact copies such as \`COPY --link dist/ ...\` when that artifact is large and stable enough to reuse.`,
        score: 90,
      });
    }
  }

  return diagnostics;
}
