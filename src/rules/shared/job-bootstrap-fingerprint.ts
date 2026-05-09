import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { detectInstallCommand } from "./tools.ts";
import { jobHasTimeout } from "./workflow-jobs.ts";

export interface JobBootstrapProfile {
  hasCheckout: boolean;
  hasInstall: boolean;
  hasLint: boolean;
  hasTest: boolean;
  hasBuild: boolean;
  hasCache: boolean;
  hasTimeout: boolean;
  installManager?: string;
}

function detectCacheStep(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  return uses.startsWith("actions/cache@") || uses.startsWith("ashleytaylor/cache-action@");
}

function detectTestStep(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  const name = step.name ?? "";
  const text = `${name} ${run}`.toLowerCase();
  return /\b(test|tests|spec|jest|vitest|pytest|mocha|rspec|cargo test|go test|npm test|pnpm test|bun test)\b/.test(
    text,
  );
}

function detectBuildStep(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  const name = step.name ?? "";
  const text = `${name} ${run}`.toLowerCase();
  return /\b(npm run build|pnpm build|yarn build|bun run build|vite build|next build|turbo run build|nx build|gradle build|mvn build|cargo build|go build|dotnet build|webpack|rollup|esbuild)\b/.test(
    text,
  );
}

export function buildJobBootstrapProfile(job: WorkflowJob): JobBootstrapProfile {
  let hasCheckout = false;
  let hasLint = false;
  let hasTest = false;
  let hasBuild = false;
  let hasCache = false;
  let installManager: string | undefined;

  for (const step of job.steps) {
    hasCheckout ||= step.uses?.toLowerCase().startsWith("actions/checkout@") ?? false;
    hasCache ||= detectCacheStep(step);

    const run = step.run ?? "";
    const name = step.name ?? "";

    hasLint ||=
      /\b(eslint|oxlint|prettier|actionlint|shellcheck|ruff|markdownlint|biome|yamllint|stylelint)\b/.test(
        `${name} ${run}`.toLowerCase(),
      );
    hasTest ||= detectTestStep(step);
    hasBuild ||= detectBuildStep(step);

    const manager = detectInstallCommand(step);
    if (manager && !installManager) {
      installManager = manager;
    }
  }

  return {
    hasCheckout,
    hasLint,
    hasTest,
    hasBuild,
    hasCache,
    hasTimeout: jobHasTimeout(job),
    installManager,
    hasInstall: Boolean(installManager),
  };
}

export function jobBootstrapFingerprint(profile: JobBootstrapProfile): string {
  const parts: string[] = [
    profile.hasCheckout ? "C" : "_",
    profile.hasInstall ? `I${profile.installManager ?? "?"}` : "_",
    profile.hasLint ? "L" : "_",
    profile.hasTest ? "T" : "_",
    profile.hasBuild ? "B" : "_",
    profile.hasCache ? "K" : "_",
  ];
  return parts.join("");
}
