import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";
import { type DockerBuildTarget, normalizeRelativePath } from "./docker-build-targets.ts";
import {
  type CollectedDockerfileInstruction,
  parseDockerfileFromInstruction,
} from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "java-production-image-uses-jdk-runtime",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/java-production-image-uses-jdk-runtime.md",
} satisfies RuleMeta;

const DEV_TEST_PATH_PATTERN =
  /\b(test|tests|ci|dev|debug|tool|tools|builder|build|benchmark|bench)\b/i;

const NON_PRODUCTION_ALIAS_PATTERN =
  /\b(build(?:er)?|test|ci|dev|debug|tool|tools|bench(?:mark)?)\b/i;

const JRE_EXCLUSION_PATTERN = /\b-jre\b|\bruntime\b|\bdistroless\b/i;

const JDK_TOOLS_PATTERN =
  /\b(javac|jar(?!\s+-\S)|jlink|jmod|jpackage|jshell|jcmd|jmap|jstack|jfr|jdeps|keytool)\b/i;

const JAVA_ENTRY_POINT_PATTERN = /\bjava\s+(?:-\w+\s+)*-(?:jar|cp)\b/i;

const SPRING_BOOT_LAUNCHER_TARGET = "org.springframework.boot.loader";

const PACKAGE_MANAGER_PATTERN = /\b(apt-get|apk|yum|dnf|apt)\b/i;

const JAVA_ARTIFACT_PATTERN = /(?:target\/\S+\.jar|build\/libs\/\S+\.jar)/i;

function extractStageAlias(instruction: CollectedDockerfileInstruction): string | undefined {
  const args = instruction.argumentsContent ?? instruction.text.replace(/^FROM\s+/i, "").trim();
  const asMatch = args.match(/\bAS\s+(\S+)\s*$/i);
  return asMatch?.[1]?.toLowerCase();
}

function isJdkImage(image: string): boolean {
  const lower = image.toLowerCase();
  const colonIndex = lower.indexOf(":");
  const name = colonIndex >= 0 ? lower.slice(0, colonIndex) : lower;
  const tag = colonIndex >= 0 ? lower.slice(colonIndex + 1) : "";

  if (JRE_EXCLUSION_PATTERN.test(tag)) {
    return false;
  }

  if (tag.length === 0 || tag === "latest") {
    if (name.includes("openjdk")) {
      return true;
    }
    if (name.includes("amazoncorretto")) {
      return true;
    }
    if (name.includes("zulu-openjdk")) {
      return true;
    }
    if (name.includes("libericaopenjdk")) {
      return true;
    }
    return false;
  }

  if (/\bopenjdk\b/.test(name)) {
    return true;
  }
  if (name.includes("amazoncorretto")) {
    return true;
  }
  if (name.includes("zulu-openjdk")) {
    return true;
  }
  if (name.includes("libericaopenjdk")) {
    return true;
  }
  if (name.includes("graalvm/jdk")) {
    return true;
  }

  if (/\b-jdk\b|[:/]jdk[-]/.test(tag)) {
    return true;
  }

  if (name.includes("liberica-runtime-container") && /\bjdk\b/.test(tag)) {
    return true;
  }
  if (name.includes("ibm-semeru-runtimes") && /\bjdk\b/.test(tag)) {
    return true;
  }

  return false;
}

function instructionRunsJava(instruction: CollectedDockerfileInstruction): boolean {
  const jsonArgs = instruction.jsonStrings?.join(" ") ?? "";
  const textArgs =
    instruction.argumentsContent ?? instruction.text.replace(/^(?:ENTRYPOINT|CMD)\s+/i, "").trim();

  if (jsonArgs.includes("java")) {
    return true;
  }
  if (jsonArgs.includes(SPRING_BOOT_LAUNCHER_TARGET)) {
    return true;
  }

  const lower = textArgs.toLowerCase();
  if (lower.startsWith('["java') || lower.startsWith("java ")) {
    return true;
  }
  if (JAVA_ENTRY_POINT_PATTERN.test(lower)) {
    return true;
  }
  if (lower.includes(SPRING_BOOT_LAUNCHER_TARGET.toLowerCase())) {
    return true;
  }

  return false;
}

function instructionNeedsJdkTools(instruction: CollectedDockerfileInstruction): boolean {
  const text = instruction.text;
  const args = instruction.argumentsContent ?? "";
  return JDK_TOOLS_PATTERN.test(text) || JDK_TOOLS_PATTERN.test(args);
}

function instructionCopiesJavaArtifact(instruction: CollectedDockerfileInstruction): boolean {
  const text = instruction.text;
  const args = instruction.argumentsContent ?? "";
  return JAVA_ARTIFACT_PATTERN.test(text) || JAVA_ARTIFACT_PATTERN.test(args);
}

function instructionIsPackageManagerInstall(instruction: CollectedDockerfileInstruction): boolean {
  return PACKAGE_MANAGER_PATTERN.test(instruction.text);
}

// eslint-disable-next-line max-params
export async function collectJavaProductionImageUsesJdkRuntimeDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
  featureIndex?: RepositoryFeatureIndex,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    if (DEV_TEST_PATH_PATTERN.test(target.dockerfilePath)) {
      continue;
    }

    const dockerfileData = featureIndex
      ? await featureIndex.getDockerfileData(target.dockerfilePath, context)
      : undefined;
    if (!dockerfileData) {
      continue;
    }

    const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);

    const { instructions, fromInstructionIndexes, finalFromInstructionIndex } = dockerfileData;

    const finalFromInstruction = instructions[finalFromInstructionIndex];
    if (!finalFromInstruction) {
      continue;
    }

    const fromParsed = parseDockerfileFromInstruction(finalFromInstruction);
    if (!fromParsed) {
      continue;
    }

    if (!isJdkImage(fromParsed.image)) {
      continue;
    }

    if (DEV_TEST_PATH_PATTERN.test(dockerfileRelativePath)) {
      continue;
    }

    const finalStageAlias = extractStageAlias(finalFromInstruction);
    if (finalStageAlias && NON_PRODUCTION_ALIAS_PATTERN.test(finalStageAlias)) {
      continue;
    }

    let hasJavaRun = false;
    let hasJdkTools = false;
    let hasJavaArtifactCopy = false;
    let hasPackageManagerInstall = false;
    let hasSpringBoot = false;
    const isMultiStage = fromInstructionIndexes.length > 1;

    for (let index = finalFromInstructionIndex; index < instructions.length; index++) {
      const instruction = instructions[index];
      if (!instruction) {
        continue;
      }

      const keyword =
        instruction.keyword?.toUpperCase() ?? instruction.text.match(/^\w+/)?.[0]?.toUpperCase();

      if (keyword === "ENTRYPOINT" || keyword === "CMD") {
        const runsJava = instructionRunsJava(instruction);
        if (runsJava) {
          hasJavaRun = true;
          if (instruction.text.includes(SPRING_BOOT_LAUNCHER_TARGET)) {
            hasSpringBoot = true;
          }
        }
      }

      if (keyword === "RUN") {
        if (instructionNeedsJdkTools(instruction)) {
          hasJdkTools = true;
          break;
        }
        if (instructionIsPackageManagerInstall(instruction)) {
          hasPackageManagerInstall = true;
        }
      }

      if (keyword === "COPY" || keyword === "ADD") {
        if (instructionCopiesJavaArtifact(instruction)) {
          hasJavaArtifactCopy = true;
        }
      }
    }

    if (hasJdkTools) {
      continue;
    }
    if (!hasJavaRun) {
      continue;
    }

    let score = 50;

    if (hasJavaArtifactCopy) {
      score += 10;
    }
    if (isMultiStage) {
      score += 5;
    }
    if (!hasPackageManagerInstall) {
      score += 5;
    }
    if (hasSpringBoot) {
      score += 5;
    }
    if (repository.frameworks.usesGradle) {
      score += 5;
    }
    const hasMavenPom = await context.pathExists(context.resolve("pom.xml"));
    if (hasMavenPom) {
      score += 5;
    }

    score = Math.min(Math.max(score, 40), 85);

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: dockerfileRelativePath,
          line: finalFromInstruction.startLine,
          column: 1,
        },
        message: `The final Docker image in ${dockerfileRelativePath} appears to use a full JDK even though it only runs a Java application.`,
        why:
          "A JDK includes development tools that are usually unnecessary in production runtime images. " +
          "Keeping them in the final image can increase image size, push/pull time, vulnerability scanner findings, and runtime attack surface.",
        suggestion:
          "Use a compatible JRE/runtime image, distroless Java image, or jlink-generated custom runtime for the final stage. " +
          "Keep the builder stage on a JDK if compilation or packaging is needed.",
        measurementHint:
          "Compare final image size, image push/pull time, vulnerability scanner findings, and deployment startup time " +
          "before and after switching the final stage from a JDK image to a runtime/JRE image.",
        aiHandoff:
          `Review the final stage of ${dockerfileRelativePath}. If it only runs a Java application, replace the final JDK base image ` +
          "with a compatible JRE/runtime image or custom jlink runtime. Keep compilation and packaging in an earlier JDK builder stage. " +
          "Measure image size, push/pull time, and vulnerability scan results before adopting the change.",
        score,
      }),
    );
  }

  return diagnostics;
}
