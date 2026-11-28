import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { parseDocument } from "../yaml.ts";

const meta = {
  id: "buildkite-docker-compose-run-without-prebuild",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/buildkite-docker-compose-run-without-prebuild.md",
  scope: "buildkite",
} satisfies RuleMeta;

const DEFAULT_COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
] as const;
const MAX_COMPOSE_FILES = 8;

interface ComposePluginInfo {
  readonly runs: Set<string>;
  readonly builds: Set<string>;
  readonly pushes: Set<string>;
  readonly configPaths: string[];
  usesRunImage: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDockerComposePlugin(identifier: string): boolean {
  const withoutVersion = identifier.split("#")[0] ?? "";
  const segments = withoutVersion.split("/");
  return (segments[segments.length - 1] ?? "") === "docker-compose";
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (isRecord(value)) {
    return Object.keys(value);
  }
  return [];
}

/** `push` accepts `svc` and `svc:registry/repo:tag`; `build` accepts
 * `svc` and `svc:target`. Both name the same compose service. */
function serviceNames(value: unknown): string[] {
  return stringList(value)
    .map((item) => item.split(":")[0]?.trim() ?? "")
    .filter(Boolean);
}

function composePluginInfo(step: PipelineStep): ComposePluginInfo {
  const info: ComposePluginInfo = {
    runs: new Set(),
    builds: new Set(),
    pushes: new Set(),
    configPaths: [],
    usesRunImage: false,
  };
  for (const plugin of step.plugins ?? []) {
    for (const [identifier, rawConfig] of Object.entries(plugin)) {
      if (!isDockerComposePlugin(identifier)) {
        continue;
      }
      const config = isRecord(rawConfig) ? rawConfig : {};
      for (const service of serviceNames(config.run)) {
        info.runs.add(service);
      }
      for (const service of serviceNames(config.build)) {
        info.builds.add(service);
      }
      for (const service of serviceNames(config.push)) {
        info.pushes.add(service);
      }
      info.configPaths.push(...stringList(config.config));
      if (typeof config["run-image"] === "string" && config["run-image"].trim()) {
        info.usesRunImage = true;
      }
      if (typeof config.run_image === "string" && config.run_image.trim()) {
        info.usesRunImage = true;
      }
    }
  }
  return info;
}

function matrixCombinationCount(raw: Record<string, unknown>): number {
  const matrix = raw.matrix;
  if (!isRecord(matrix)) {
    return 1;
  }
  const setup = matrix.setup;
  let combinations = 1;
  if (Array.isArray(setup)) {
    combinations = Math.max(1, setup.length);
  } else if (isRecord(setup)) {
    for (const values of Object.values(setup)) {
      if (Array.isArray(values)) {
        combinations *= Math.max(1, values.length);
      }
    }
  }
  const adjustments = matrix.adjustments;
  if (Array.isArray(adjustments)) {
    combinations += adjustments.filter(
      (item) => isRecord(item) && isRecord(item.with) && item.skip === undefined,
    ).length;
  }
  return Math.max(1, Math.min(combinations, 10_000));
}

function stepExecutionCount(step: PipelineStep): number {
  const raw = step.node.toJSON();
  const parallelism =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).parallelism
      : undefined;
  const parallel = typeof parallelism === "number" && parallelism > 0 ? parallelism : 1;
  const matrixRaw = isRecord(raw) ? raw : {};
  return Math.max(1, Math.min(Math.floor(parallel) * matrixCombinationCount(matrixRaw), 100_000));
}

function envComposeFiles(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[:\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return stringList(value);
}

function composeCandidates(
  pipeline: PipelineDocument,
  step: PipelineStep,
  info: ComposePluginInfo,
): string[] {
  const candidates = [...info.configPaths, ...envComposeFiles(step.env?.COMPOSE_FILE)];
  if (candidates.length === 0) {
    candidates.push(...envComposeFiles(pipeline.env?.COMPOSE_FILE));
  }
  if (candidates.length === 0) {
    candidates.push(...DEFAULT_COMPOSE_FILES);
  }
  return [...new Set(candidates)].slice(0, MAX_COMPOSE_FILES);
}

async function composeServiceHasBuild(
  relativePath: string,
  service: string,
  context: RuleContext,
): Promise<boolean> {
  const scan = context.scanContext;
  if (scan) {
    const fullPath = scan.resolve(relativePath);
    if (!(await scan.pathExists(fullPath))) {
      return false;
    }
    const text = await scan.readTextFileOrWarn(fullPath);
    return text !== undefined && composeDeclaresBuild(text, service);
  }
  const index = context.fileIndex;
  if (!index || !(await index.fileExists(relativePath))) {
    return false;
  }
  const text = await index.readTextFile(relativePath);
  return text !== undefined && composeDeclaresBuild(text, service);
}

function composeDeclaresBuild(text: string, service: string): boolean {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return false;
  }
  const value = document.toJS();
  if (!isRecord(value) || !isRecord(value.services)) {
    return false;
  }
  const definition = value.services[service];
  return isRecord(definition) && Object.hasOwn(definition, "build");
}

export const buildkiteDockerComposeRunWithoutPrebuildRule = {
  meta,
  async check(pipeline: PipelineDocument, context: RuleContext): Promise<Diagnostic[]> {
    const stepInfos = pipeline.steps.map((step) => composePluginInfo(step));
    const prebuilt = new Set<string>();
    for (const info of stepInfos) {
      for (const service of info.builds) {
        if (info.pushes.has(service)) {
          prebuilt.add(service);
        }
      }
    }

    const runSteps = new Map<string, { step: PipelineStep; info: ComposePluginInfo }[]>();
    const runImageServices = new Set<string>();
    for (let index = 0; index < pipeline.steps.length; index++) {
      const step = pipeline.steps[index];
      const info = stepInfos[index];
      if (!step || !info) {
        continue;
      }
      if (step.skip === true || step.skip === "true") {
        continue;
      }
      for (const service of info.runs) {
        if (info.usesRunImage) {
          runImageServices.add(service);
        }
        const steps = runSteps.get(service) ?? [];
        steps.push({ step, info });
        runSteps.set(service, steps);
      }
    }

    const findings: Diagnostic[] = [];
    for (const [service, steps] of runSteps) {
      if (prebuilt.has(service) || runImageServices.has(service)) {
        continue;
      }
      const executions = steps.reduce((total, entry) => total + stepExecutionCount(entry.step), 0);
      if (executions < 2) {
        continue;
      }
      const first = steps[0];
      if (!first) {
        continue;
      }
      const resolved = composeCandidates(pipeline, first.step, first.info);
      let hasBuild = false;
      for (const candidate of resolved) {
        if (await composeServiceHasBuild(candidate, service, context)) {
          hasBuild = true;
          break;
        }
      }
      if (!hasBuild) {
        continue;
      }

      const labels = steps.map((entry) => entry.step.label ?? entry.step.key ?? "unnamed");
      findings.push(
        buildDiagnostic(
          pipeline,
          meta,
          first.step.commandNode ?? first.step.labelNode ?? first.step.node,
          {
            message: `Service "${service}" is built by docker-compose run in ${executions} step executions (${labels.join(", ")}) and no step prebuilds and pushes it.`,
            why: `Each docker-compose run step executes on its own agent, so the image for "${service}" is rebuilt locally on every agent instead of being pulled once from a registry. Buildkite agents do not share a Docker layer cache.`,
            suggestion: `Add one step with build: ${service} and push: ${service}:<registry>/<repo>:<tag> (and the registry login plugin the pipeline already uses), put wait or depends_on before the run steps, and keep run: ${service} in those steps; the plugin reads the pushed image from build metadata.`,
            measurementHint: `Compare the docker-compose build time inside each run step and total build time before and after adding the prebuild step.`,
            aiHandoff: `Review ${pipeline.relativePath}: prebuild and push "${service}" once, then let the ${executions} run steps pull the published image.`,
            score: 50,
          },
        ),
      );
    }
    return findings;
  },
};
