import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import {
  collectDockerfileStageAliases,
  dockerfileFromUsesFloatingTag,
  dockerfileSourceLooksLocalAddWithoutClearNeed,
  parseDockerfileAddInstruction,
  parseDockerfileFromInstruction,
} from "./dockerfile-instructions.ts";
import {
  dockerfileAddWithoutClearNeedDocsPath,
  dockerfileApkAddWithoutNoCacheOrCacheMountDocsPath,
  dockerfileAptInstallWithoutNoInstallRecommendsDocsPath,
  dockerfileBaseImageUsesFloatingTagDocsPath,
} from "./docker-image-rule-catalog.ts";
import { instructionInstallsAptWithRecommends } from "./docker-apt-recommends-helpers.ts";
import { instructionInstallsApkWithoutCacheControl } from "./docker-apk-cache-helpers.ts";

export function collectSingleInstructionImageSizeDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const previousStageAliases = new Set<string>();
  const floatingFromInstruction = instructions.find((instruction) => {
    const fromInstruction = parseDockerfileFromInstruction(instruction);
    if (!fromInstruction) {
      return false;
    }
    const floating =
      !previousStageAliases.has(fromInstruction.image.toLowerCase()) &&
      dockerfileFromUsesFloatingTag(fromInstruction.image);
    for (const alias of collectDockerfileStageAliases([instruction])) {
      previousStageAliases.add(alias);
    }
    return floating;
  });
  if (floatingFromInstruction) {
    diagnostics.push({
      ruleId: "dockerfile-base-image-uses-floating-tag",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileBaseImageUsesFloatingTagDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: floatingFromInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} uses a base image reference that can float to new content.`,
      why: "Floating base image tags can change independently of the repository. That makes CI rebuilds less predictable and can invalidate Docker cache layers even when the application code did not change.",
      suggestion:
        "Pin the base image to a stable version tag, or use a digest when rebuild reproducibility is more important than automatically receiving base image updates.",
      measurementHint:
        "Compare Docker cache hits across repeated CI builds before and after pinning the base image reference.",
      aiHandoff: `Review ${dockerfileRelativePath} and replace floating Docker base image references such as untagged images or \`:latest\` with stable version tags or digests where appropriate.`,
      score: 66,
    });
  }

  const aptNoRecommendsInstruction = instructions.find(instructionInstallsAptWithRecommends);
  if (aptNoRecommendsInstruction) {
    diagnostics.push({
      ruleId: "dockerfile-apt-install-without-no-install-recommends",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileAptInstallWithoutNoInstallRecommendsDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: aptNoRecommendsInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} installs apt packages without \`--no-install-recommends\`.`,
      why: "Recommended apt packages often pull in extra files that are not needed at runtime. Larger image layers take longer to build, push, pull, and scan in CI.",
      suggestion:
        "Add `--no-install-recommends` to apt install commands unless the recommended packages are intentionally required.",
      measurementHint:
        "Compare final image size and package install time before and after adding --no-install-recommends.",
      aiHandoff: `Review ${dockerfileRelativePath} and add \`--no-install-recommends\` to apt install commands unless the recommended dependencies are explicitly needed.`,
      score: 72,
    });
  }

  const apkInstruction = instructions.find(instructionInstallsApkWithoutCacheControl);
  if (apkInstruction) {
    diagnostics.push({
      ruleId: "dockerfile-apk-add-without-no-cache-or-cache-mount",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileApkAddWithoutNoCacheOrCacheMountDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: apkInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} runs \`apk add\` without \`--no-cache\` or a visible BuildKit apk cache mount.`,
      why: "apk package indexes and cache data can increase image layer size. When cache reuse is useful, a BuildKit cache mount keeps that data out of the image while preserving rebuild speed.",
      suggestion:
        "Use `apk add --no-cache` for simple runtime installs, or add a BuildKit cache mount such as `--mount=type=cache,target=/var/cache/apk` when package cache reuse matters.",
      measurementHint:
        "Compare image layer size and Docker rebuild time before and after using --no-cache or an apk cache mount.",
      aiHandoff: `Review ${dockerfileRelativePath} and update the apk package install to use \`--no-cache\`, or add \`--mount=type=cache,target=/var/cache/apk\` when cache reuse is intentional.`,
      score: 72,
    });
  }

  const addInstruction = instructions.find((instruction) =>
    parseDockerfileAddInstruction(instruction)?.sources.some((source) =>
      dockerfileSourceLooksLocalAddWithoutClearNeed(source),
    ),
  );
  if (addInstruction) {
    diagnostics.push({
      ruleId: "dockerfile-add-without-clear-need",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileAddWithoutClearNeedDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: addInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} uses \`ADD\` for local files where \`COPY\` is likely enough.`,
      why: "`ADD` has extra behavior for remote URLs and archive extraction. For ordinary local files, `COPY` is more explicit and avoids accidentally expanding the amount of data or work included in an image layer.",
      suggestion:
        "Use `COPY` for local files and directories. Keep `ADD` only when archive extraction or remote fetch semantics are intentional.",
      measurementHint:
        "Compare build context behavior and final image layers after replacing local ADD instructions with COPY.",
      aiHandoff: `Review ${dockerfileRelativePath} and replace local-file \`ADD\` instructions with \`COPY\` unless archive extraction or remote fetching is intentional.`,
      score: 64,
    });
  }

  return diagnostics;
}
