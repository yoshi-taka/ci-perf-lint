import path from "node:path";
import { parseDocument } from "../yaml.ts";
import type { AnalysisWarning } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { shellInvocations } from "../rules/shared/shell-invocations.ts";
import { invocationOperands, invocationOptions } from "../rules/shared/tool-command-evidence.ts";
import { workflowWorkingDirectory } from "../rules/shared/workflow-command-context.ts";
import type { AnyWorkflowDocument } from "../ci-types.ts";
import {
  collectPersistentCacheDockerTargets,
  parseDockerBuildCommand,
} from "./docker-persistent-cache-targets.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  collectDockerfileInstructions,
  type CollectedDockerfileInstruction,
} from "./dockerfile-instructions.ts";

export interface DockerBuildTarget {
  workflow: string;
  jobId: string;
  contextPath: string;
  dockerfilePath: string;
  targetStage?: string;
  cacheMountPersistence?: "depot" | "blacksmith" | "buildkite-docker-state";
}

export interface CollectedDockerfileData {
  text: string;
  lines: string[];
  instructions: CollectedDockerfileInstruction[];
  fromInstructionIndexes: number[];
  finalFromInstructionIndex: number;
}

const dockerBuildTargetsCache = new WeakMap<
  RepositoryScanContext,
  Map<string, Promise<DockerBuildTarget[]>>
>();
const composeServicesCache = new WeakMap<
  RepositoryScanContext,
  Map<string, Promise<Record<string, unknown> | undefined>>
>();
const dockerfileDataCache = new WeakMap<
  RepositoryScanContext,
  Map<string, Promise<CollectedDockerfileData | undefined>>
>();

function getContextCache<K, V>(
  cache: WeakMap<RepositoryScanContext, Map<K, Promise<V>>>,
  context: RepositoryScanContext,
): Map<K, Promise<V>> {
  const existingCache = cache.get(context);
  if (existingCache) {
    return existingCache;
  }

  const nextCache = new Map<K, Promise<V>>();
  cache.set(context, nextCache);
  return nextCache;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

function normalizeContextValue(value: string | undefined): string | undefined {
  if (!value) {
    return ".";
  }

  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.startsWith("${{")) {
    return undefined;
  }

  return trimmed;
}

function normalizeDockerfileValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.startsWith("${{")) {
    return undefined;
  }

  return trimmed;
}

function extractFromBuildPushStep(
  repoRoot: string,
  workflow: WorkflowDocument,
): DockerBuildTarget[] {
  const targets: DockerBuildTarget[] = [];

  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const uses = step.uses?.toLowerCase() ?? "";
      if (!uses.startsWith("docker/build-push-action@")) {
        continue;
      }

      const contextValue = normalizeContextValue(
        typeof step.with?.context === "string" ? step.with.context : undefined,
      );
      const dockerfileValue = normalizeDockerfileValue(
        typeof step.with?.file === "string" ? step.with.file : undefined,
      );
      if (!contextValue) {
        continue;
      }

      const contextPath = path.resolve(repoRoot, contextValue);
      const dockerfilePath = dockerfileValue
        ? path.resolve(repoRoot, dockerfileValue)
        : path.join(contextPath, "Dockerfile");
      targets.push({
        workflow: workflow.relativePath,
        jobId: job.id,
        contextPath,
        dockerfilePath,
        targetStage: typeof step.with?.target === "string" ? step.with.target : undefined,
      });
    }
  }

  return targets;
}

function extractFromRunStep(repoRoot: string, workflow: WorkflowDocument): DockerBuildTarget[] {
  const targets: DockerBuildTarget[] = [];

  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      for (const words of shellInvocations(step.run ?? "")) {
        const build = parseDockerBuildCommand(words);
        if (
          !build ||
          build.depot ||
          /[$`]|__shell_substitution__/.test(`${build.context} ${build.file ?? ""}`)
        ) {
          continue;
        }
        const directory = workflowWorkingDirectory(workflow, job, step);
        if (/[$`]/.test(directory)) {
          continue;
        }
        const contextPath = path.resolve(repoRoot, directory, build.context);
        const dockerfilePath = build.file
          ? path.resolve(repoRoot, directory, build.file)
          : path.join(contextPath, "Dockerfile");
        targets.push({
          workflow: workflow.relativePath,
          jobId: job.id,
          contextPath,
          dockerfilePath,
          targetStage: build.targetStage,
        });
      }
    }
  }

  return targets;
}

function parseComposeCommand(words: string[]):
  | {
      composeFile?: string;
      services: string[];
    }
  | undefined {
  if (words[0] !== "docker" || words[1] !== "compose") {
    return undefined;
  }
  const command = words.slice(1);
  const values = [
    "-f",
    "--file",
    "-p",
    "--project-name",
    "--project-directory",
    "--env-file",
    "--profile",
    "--parallel",
    "--ansi",
    "--progress",
    "--build-arg",
    "--builder",
    "--ssh",
    ">",
    "<",
  ];
  const operands = invocationOperands(command, values);
  if (
    invocationOptions(command, values).some(({ name }) =>
      ["--help", "-h", "--version"].includes(name),
    )
  ) {
    return undefined;
  }
  if (operands[0] !== "build") {
    return undefined;
  }
  const file = invocationOptions(command, values).find(
    ({ name }) => name === "-f" || name === "--file",
  )?.value;
  if (file && /[$`]|__shell_substitution__/.test(file)) {
    return undefined;
  }
  return { composeFile: file, services: operands.slice(1) };
}

async function resolveComposeTargets(
  context: RepositoryScanContext,
  repoRoot: string,
  workflow: WorkflowDocument,
): Promise<DockerBuildTarget[]> {
  const targets: DockerBuildTarget[] = [];

  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      for (const words of shellInvocations(step.run ?? "")) {
        const composeCommand = parseComposeCommand(words);
        if (!composeCommand) {
          continue;
        }

        const composeFileCandidates = composeCommand.composeFile
          ? [path.resolve(repoRoot, composeCommand.composeFile)]
          : [
              path.resolve(repoRoot, "compose.yaml"),
              path.resolve(repoRoot, "compose.yml"),
              path.resolve(repoRoot, "docker-compose.yml"),
              path.resolve(repoRoot, "docker-compose.yaml"),
            ];
        const fallbackComposeFilePath = composeFileCandidates[0];
        if (!fallbackComposeFilePath) {
          continue;
        }
        const resolvedComposeFilePath = (
          await Promise.allSettled(
            composeFileCandidates.map(async (candidate) =>
              (await context.pathExists(candidate)) ? candidate : undefined,
            ),
          )
        )
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value)
          .find((candidate): candidate is string => candidate !== undefined);
        const composeFilePath = resolvedComposeFilePath ?? fallbackComposeFilePath;

        if (!(await context.pathExists(composeFilePath))) {
          continue;
        }

        const servicesRecord = await loadComposeServices(context, composeFilePath);
        if (!servicesRecord) {
          continue;
        }

        const serviceNames =
          composeCommand.services.length > 0
            ? composeCommand.services.filter((name) => name in servicesRecord)
            : Object.keys(servicesRecord);

        for (const serviceName of serviceNames) {
          const serviceRecord = asRecord(servicesRecord[serviceName]);
          const buildValue = serviceRecord?.build;
          let contextValue: string | undefined;
          let dockerfileValue: string | undefined;
          let targetStage: string | undefined;

          if (typeof buildValue === "string") {
            contextValue = normalizeContextValue(buildValue);
          } else {
            const buildRecord = asRecord(buildValue);
            targetStage = typeof buildRecord?.target === "string" ? buildRecord.target : undefined;
            contextValue = normalizeContextValue(
              typeof buildRecord?.context === "string" ? buildRecord.context : undefined,
            );
            dockerfileValue = normalizeDockerfileValue(
              typeof buildRecord?.dockerfile === "string" ? buildRecord.dockerfile : undefined,
            );
          }

          if (!contextValue) {
            continue;
          }

          const composeDir = path.dirname(composeFilePath);
          const contextPath = path.resolve(composeDir, contextValue);
          const dockerfilePath = dockerfileValue
            ? path.resolve(composeDir, dockerfileValue)
            : path.join(contextPath, "Dockerfile");
          targets.push({
            workflow: workflow.relativePath,
            jobId: job.id,
            contextPath,
            dockerfilePath,
            targetStage,
          });
        }
      }
    }
  }

  return targets;
}

async function loadComposeServices(
  context: RepositoryScanContext,
  composeFilePath: string,
): Promise<Record<string, unknown> | undefined> {
  const cache = getContextCache(composeServicesCache, context);
  const existingLoad = cache.get(composeFilePath);
  if (existingLoad) {
    return existingLoad;
  }

  const composeServicesLoad = (async () => {
    const composeText = await context.readTextFileOrWarn(composeFilePath);
    if (!composeText) {
      return undefined;
    }

    try {
      const parsed = parseDocument(composeText).toJSON();
      const composeValue = asRecord(parsed);
      return asRecord(composeValue?.services);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      context.warn(
        composeFilePath,
        `Failed to parse compose file while collecting Docker build targets: ${detail}`,
      );
      return undefined;
    }
  })();
  cache.set(composeFilePath, composeServicesLoad);

  return composeServicesLoad;
}

export async function collectDockerBuildTargets(
  repoRoot: string,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
  additionalDocuments: readonly AnyWorkflowDocument[] = [],
): Promise<DockerBuildTarget[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const cache = getContextCache(dockerBuildTargetsCache, context);
  const cacheKey = [...workflows, ...additionalDocuments]
    .map((workflow) => workflow.relativePath)
    .join("\n");
  const existingLoad = cache.get(cacheKey);
  if (existingLoad) {
    return existingLoad;
  }

  const targetLoad = (async () => {
    const perWorkflowTargets = await Promise.allSettled(
      workflows.map(async (workflow) => [
        ...extractFromBuildPushStep(repoRoot, workflow),
        ...extractFromRunStep(repoRoot, workflow),
        ...(await resolveComposeTargets(context, repoRoot, workflow)),
      ]),
    );
    const allTargets = perWorkflowTargets
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .flat();
    allTargets.push(
      ...collectPersistentCacheDockerTargets(repoRoot, [
        ...workflows,
        ...additionalDocuments.filter((doc) => doc.kind !== "github-actions"),
      ]),
    );

    const uniqueTargets = new Map<string, DockerBuildTarget>();
    for (const target of allTargets) {
      const key = `${target.contextPath}::${target.dockerfilePath}::${target.targetStage ?? ""}`;
      if (
        !uniqueTargets.has(key) ||
        (!uniqueTargets.get(key)?.cacheMountPersistence && target.cacheMountPersistence)
      ) {
        uniqueTargets.set(key, target);
      }
    }

    return [...uniqueTargets.values()];
  })();
  cache.set(cacheKey, targetLoad);

  return targetLoad;
}

export async function collectDockerfileData(
  context: RepositoryScanContext,
  dockerfilePath: string,
): Promise<CollectedDockerfileData | undefined> {
  const cache = getContextCache(dockerfileDataCache, context);
  const existingLoad = cache.get(dockerfilePath);
  if (existingLoad) {
    return existingLoad;
  }

  const dockerfileDataLoad = (async () => {
    if (!(await context.pathExists(dockerfilePath))) {
      return undefined;
    }

    const text = await context.readTextFileOrWarn(dockerfilePath);
    if (!text) {
      return undefined;
    }

    const lines = text.split(/\r?\n/);
    const instructions = collectDockerfileInstructions(lines);
    const fromInstructionIndexes = instructions
      .map((instruction, index) => (/^\s*from\b/i.test(instruction.text) ? index : -1))
      .filter((index) => index >= 0);

    return {
      text,
      lines,
      instructions,
      fromInstructionIndexes,
      finalFromInstructionIndex: fromInstructionIndexes.at(-1) ?? 0,
    };
  })();
  cache.set(dockerfilePath, dockerfileDataLoad);

  return dockerfileDataLoad;
}
