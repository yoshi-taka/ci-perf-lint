import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import {
  instructionLooksBundleInstallWithoutCacheMount,
  instructionLooksCargoBuildReleaseWithoutCacheMount,
  instructionLooksGoBuildWithoutCacheMount,
  instructionLooksGoModDownloadWithoutCacheMount,
  instructionLooksGradleBuildWithoutCacheMount,
  instructionLooksGradleDependenciesWithoutCacheMount,
  instructionLooksMavenBuildWithoutCacheMount,
  instructionLooksMavenGoOfflineWithoutCacheMount,
} from "./dockerfile-instructions.ts";
import {
  dockerfileBundleInstallWithoutCacheMountDocsPath,
  dockerfileCargoBuildReleaseWithoutCacheMountDocsPath,
  dockerfileGoBuildWithoutCacheMountDocsPath,
  dockerfileGoModDownloadWithoutCacheMountDocsPath,
  dockerfileGradleBuildWithoutCacheMountDocsPath,
  dockerfileGradleDependenciesWithoutCacheMountDocsPath,
  dockerfileMavenBuildWithoutCacheMountDocsPath,
  dockerfileMavenGoOfflineWithoutCacheMountDocsPath,
} from "./docker-image-rule-catalog.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";

function buildRepositoryDockerDiagnostic(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instruction: CollectedDockerfileInstruction,
  details: Omit<Diagnostic, "severity" | "confidence" | "scope" | "workflow" | "location">,
): Diagnostic {
  return {
    ...details,
    severity: "warning",
    confidence: "medium",
    scope: "repository",
    workflow: repository.primaryWorkflowPath ?? workflowPath,
    location: {
      path: dockerfileRelativePath,
      line: instruction.startLine,
      column: 1,
    },
  };
}

export function collectDockerInstallCacheMountDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
  probes: DockerInstallContextProbes,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (probes.hasCargoManifest) {
    const cargoBuildInstruction = instructions.find((instruction) =>
      instructionLooksCargoBuildReleaseWithoutCacheMount(instruction.text),
    );

    if (cargoBuildInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          cargoBuildInstruction,
          {
            ruleId: "dockerfile-cargo-build-release-without-cache-mount",
            docsPath: dockerfileCargoBuildReleaseWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs \`cargo build --release\` without a visible BuildKit cache mount on that instruction.`,
            why: "Rust release builds are compilation-heavy. Without BuildKit cache mounts for Cargo registry, Git dependencies, or compiler artifacts, Docker rebuilds can repeatedly pay dependency download and compilation costs.",
            suggestion:
              "Add BuildKit cache mounts to the Dockerfile cargo release build step, at minimum for Cargo registry and Git caches. For larger projects, consider adding sccache and cargo-chef as separate follow-up optimizations.",
            measurementHint:
              "Compare Docker release build wall-clock time and cache reuse before and after adding Cargo BuildKit cache mounts.",
            aiHandoff: `Review ${dockerfileRelativePath} and add BuildKit cache mounts to the \`cargo build --release\` Docker instruction, such as Cargo registry and Git cache mounts with locked sharing.`,
            score: 78,
          },
        ),
      );
    }
  }

  if (probes.hasGoMod) {
    const goModDownloadInstruction = instructions.find((instruction) =>
      instructionLooksGoModDownloadWithoutCacheMount(instruction.text),
    );

    if (goModDownloadInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          goModDownloadInstruction,
          {
            ruleId: "dockerfile-go-mod-download-without-cache-mount",
            docsPath: dockerfileGoModDownloadWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs \`go mod download\` without a visible BuildKit cache mount on that instruction.`,
            why: "Go module downloads populate the module cache. Without a BuildKit cache mount such as `/go/pkg/mod`, Docker rebuilds can repeatedly download dependency modules.",
            suggestion:
              "Add a BuildKit cache mount for the Go module cache, such as `/go/pkg/mod`, to the Dockerfile `go mod download` step, and keep go.mod/go.sum copied before broader source files.",
            measurementHint:
              "Compare Docker dependency download duration and cache reuse before and after adding a Go module cache mount.",
            aiHandoff: `Review ${dockerfileRelativePath} and add a BuildKit cache mount such as \`--mount=type=cache,target=/go/pkg/mod\` to the \`go mod download\` Docker instruction.`,
            score: 77,
          },
        ),
      );
    }

    const goBuildInstruction = instructions.find((instruction) =>
      instructionLooksGoBuildWithoutCacheMount(instruction.text),
    );

    if (goBuildInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          goBuildInstruction,
          {
            ruleId: "dockerfile-go-build-without-cache-mount",
            docsPath: dockerfileGoBuildWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs \`go build\` without a visible BuildKit cache mount on that instruction.`,
            why: "Go builds can reuse both downloaded modules and compiled package artifacts. Without BuildKit cache mounts for `/go/pkg/mod` and `/root/.cache/go-build`, Docker rebuilds can repeatedly pay module and compile costs.",
            suggestion:
              "Add BuildKit cache mounts for the Go module cache and Go build cache, such as `/go/pkg/mod` and `/root/.cache/go-build`, to the Dockerfile `go build` step.",
            measurementHint:
              "Compare Docker Go build wall-clock time and cache reuse before and after adding Go module and build cache mounts.",
            aiHandoff: `Review ${dockerfileRelativePath} and add BuildKit cache mounts such as \`--mount=type=cache,target=/go/pkg/mod\` and \`--mount=type=cache,target=/root/.cache/go-build\` to the \`go build\` Docker instruction.`,
            score: 78,
          },
        ),
      );
    }
  }

  if (probes.hasMavenPom) {
    const mavenGoOfflineInstruction = instructions.find((instruction) =>
      instructionLooksMavenGoOfflineWithoutCacheMount(instruction.text),
    );

    if (mavenGoOfflineInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          mavenGoOfflineInstruction,
          {
            ruleId: "dockerfile-maven-go-offline-without-cache-mount",
            docsPath: dockerfileMavenGoOfflineWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs \`mvn dependency:go-offline\` without a visible BuildKit cache mount on that instruction.`,
            why: "Maven dependency resolution populates the local Maven repository. Without a BuildKit cache mount such as `/root/.m2`, Docker rebuilds can repeatedly download dependencies.",
            suggestion:
              "Add a BuildKit cache mount for the Maven local repository, such as `/root/.m2`, to the Dockerfile dependency resolution step.",
            measurementHint:
              "Compare Docker Maven dependency resolution time and cache reuse before and after adding a Maven cache mount.",
            aiHandoff: `Review ${dockerfileRelativePath} and add a BuildKit cache mount such as \`--mount=type=cache,target=/root/.m2\` to the Maven dependency resolution Docker instruction.`,
            score: 77,
          },
        ),
      );
    }

    const mavenBuildInstruction = instructions.find((instruction) =>
      instructionLooksMavenBuildWithoutCacheMount(instruction.text),
    );

    if (mavenBuildInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          mavenBuildInstruction,
          {
            ruleId: "dockerfile-maven-build-without-cache-mount",
            docsPath: dockerfileMavenBuildWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs a Maven build without a visible BuildKit cache mount on that instruction.`,
            why: "Maven builds reuse downloaded dependencies and plugin artifacts from the local repository. Without a BuildKit cache mount such as `/root/.m2`, Docker rebuilds can repeatedly pay dependency and plugin download costs.",
            suggestion:
              "Add a BuildKit cache mount for the Maven local repository, such as `/root/.m2`, to the Dockerfile Maven build step.",
            measurementHint:
              "Compare Docker Maven build wall-clock time and cache reuse before and after adding a Maven cache mount.",
            aiHandoff: `Review ${dockerfileRelativePath} and add a BuildKit cache mount such as \`--mount=type=cache,target=/root/.m2\` to the Maven build Docker instruction.`,
            score: 78,
          },
        ),
      );
    }
  }

  if (probes.hasGradleBuild) {
    const gradleDependenciesInstruction = instructions.find((instruction) =>
      instructionLooksGradleDependenciesWithoutCacheMount(instruction.text),
    );

    if (gradleDependenciesInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          gradleDependenciesInstruction,
          {
            ruleId: "dockerfile-gradle-dependencies-without-cache-mount",
            docsPath: dockerfileGradleDependenciesWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs Gradle dependency resolution without a visible BuildKit cache mount on that instruction.`,
            why: "Gradle dependency resolution populates the Gradle user home cache. Without a BuildKit cache mount such as `/cache/.gradle` or `/root/.gradle`, Docker rebuilds can repeatedly download dependencies and plugin artifacts.",
            suggestion:
              "Add a BuildKit cache mount for Gradle user home to the Dockerfile dependency resolution step, for example `/cache/.gradle` when GRADLE_USER_HOME points there.",
            measurementHint:
              "Compare Docker Gradle dependency resolution time and cache reuse before and after adding a Gradle cache mount.",
            aiHandoff: `Review ${dockerfileRelativePath} and add a BuildKit cache mount for Gradle user home, such as \`--mount=type=cache,target=/cache/.gradle\` or \`--mount=type=cache,target=/root/.gradle\`, to the Gradle dependency resolution Docker instruction.`,
            score: 77,
          },
        ),
      );
    }

    const gradleBuildInstruction = instructions.find((instruction) =>
      instructionLooksGradleBuildWithoutCacheMount(instruction.text),
    );

    if (gradleBuildInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          gradleBuildInstruction,
          {
            ruleId: "dockerfile-gradle-build-without-cache-mount",
            docsPath: dockerfileGradleBuildWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs a Gradle build without a visible BuildKit cache mount on that instruction.`,
            why: "Gradle builds reuse downloaded dependencies, plugin artifacts, and build cache data from Gradle user home. Without a BuildKit cache mount, Docker rebuilds can repeatedly pay those costs.",
            suggestion:
              "Add a BuildKit cache mount for Gradle user home to the Dockerfile Gradle build step, and keep `--build-cache` or `org.gradle.caching=true` enabled where appropriate.",
            measurementHint:
              "Compare Docker Gradle build wall-clock time and cache reuse before and after adding a Gradle cache mount.",
            aiHandoff: `Review ${dockerfileRelativePath} and add a BuildKit cache mount for Gradle user home, such as \`--mount=type=cache,target=/cache/.gradle\` or \`--mount=type=cache,target=/root/.gradle\`, to the Gradle build Docker instruction.`,
            score: 78,
          },
        ),
      );
    }
  }

  if (probes.hasGemfile) {
    const bundleInstallInstruction = instructions.find((instruction) =>
      instructionLooksBundleInstallWithoutCacheMount(instruction.text),
    );

    if (bundleInstallInstruction) {
      diagnostics.push(
        buildRepositoryDockerDiagnostic(
          repository,
          workflowPath,
          dockerfileRelativePath,
          bundleInstallInstruction,
          {
            ruleId: "dockerfile-bundle-install-without-cache-mount",
            docsPath: dockerfileBundleInstallWithoutCacheMountDocsPath,
            message: `Dockerfile ${dockerfileRelativePath} runs \`bundle install\` without a visible BuildKit cache mount on that instruction.`,
            why: "Bundler installs can download gems and compile native extensions. Without BuildKit cache mounts for Bundler caches, Docker rebuilds can repeatedly pay gem download and installation costs.",
            suggestion:
              "Add BuildKit cache mounts for Bundler caches, such as `/usr/local/bundle/cache` and optionally `/app/vendor/cache`, to the Dockerfile `bundle install` step.",
            measurementHint:
              "Compare Docker bundle install duration and cache reuse before and after adding Bundler cache mounts.",
            aiHandoff: `Review ${dockerfileRelativePath} and add BuildKit cache mounts such as \`--mount=type=cache,target=/usr/local/bundle/cache\` and optionally \`--mount=type=cache,target=/app/vendor/cache\` to the \`bundle install\` Docker instruction.`,
            score: 77,
          },
        ),
      );
    }
  }

  return diagnostics;
}
