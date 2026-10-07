import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "prefer-frozen-lockfile",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-frozen-lockfile.md",
  scope: "all",
} satisfies RuleMeta;

function booleanFlag(words: string[], name: string): boolean | undefined {
  let value: boolean | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === `--no-${name}` || word === `--${name}=false`) {
      value = false;
    } else if (word === `--${name}=true`) {
      value = true;
    } else if (word === `--${name}`) {
      value = words[i + 1] !== "false";
    }
  }
  return value;
}

function disabled(value: unknown): boolean {
  return value === false || value === "false" || value === "0";
}

function npmrcFrozen(text: string | undefined): boolean | undefined {
  const setting = [...(text ?? "").matchAll(/^\s*frozen-lockfile\s*=\s*(true|false)\s*$/gm)].at(
    -1,
  )?.[1];
  return setting === undefined ? undefined : setting === "true";
}

export const preferFrozenLockfileRule = {
  meta,
  async check(doc: CIDocument, context: RuleContext): Promise<Diagnostic[]> {
    const findings: Diagnostic[] = [];
    for (const step of extractSemanticSteps(doc)) {
      let env: Record<string, unknown> = {};
      let cwd = step.workingDirectory ?? ".";
      if (doc.kind === "github-actions") {
        const job = doc.jobs.find((candidate) => candidate.id === step.jobName);
        const original = job?.steps.find((candidate) => candidate.runNode === step.node);
        if (job && original) {
          env = workflowStepEnv(doc, job, original);
          cwd = workflowWorkingDirectory(doc, job, original);
        }
      }
      if (cwd.includes("${{")) {
        continue;
      }
      for (const command of shellCommandSegments(step.text)) {
        const words = staticShellWords(command);
        if (!words) {
          continue;
        }
        const commandEnv = { ...env };
        while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
          const assignment = words.shift()!;
          const equal = assignment.indexOf("=");
          commandEnv[assignment.slice(0, equal)] = assignment.slice(equal + 1);
        }
        const manager = words[0];
        if (
          !manager ||
          !["pnpm", "yarn", "bun"].includes(manager) ||
          !["install", "i"].includes(words[1] ?? "")
        ) {
          continue;
        }
        const frozen = booleanFlag(words, "frozen-lockfile");
        const immutable = manager === "yarn" ? booleanFlag(words, "immutable") : undefined;
        if (frozen === true || immutable === true) {
          continue;
        }
        const ciEnabled = ![false, "false", "0", ""].includes(commandEnv.CI as string | boolean);
        const scan = context.scanContext;
        if (
          manager === "pnpm" &&
          frozen === undefined &&
          ciEnabled &&
          !disabled(commandEnv.npm_config_frozen_lockfile) &&
          scan
        ) {
          const npmrc = (await scan.pathExists(scan.resolve(cwd, ".npmrc")))
            ? await scan.readTextFileOrWarn(scan.resolve(cwd, ".npmrc"))
            : undefined;
          const rootNpmrc =
            cwd === "."
              ? npmrc
              : (await scan.pathExists(scan.resolve(".npmrc")))
                ? await scan.readTextFileOrWarn(scan.resolve(".npmrc"))
                : undefined;
          const hasLock =
            (await scan.pathExists(scan.resolve(cwd, "pnpm-lock.yaml"))) ||
            ((await scan.pathExists(scan.resolve("pnpm-workspace.yaml"))) &&
              (await scan.pathExists(scan.resolve("pnpm-lock.yaml"))));
          const configured = npmrcFrozen(npmrc) ?? npmrcFrozen(rootNpmrc);
          if (configured !== false && hasLock) {
            continue;
          }
        }
        if (manager === "yarn" && frozen === undefined && immutable === undefined) {
          const pkg = scan
            ? (await scan.loadPackageJson(scan.resolve(cwd, "package.json"))).value
            : undefined;
          const spec =
            pkg && typeof pkg === "object" && "packageManager" in pkg
              ? pkg.packageManager
              : undefined;
          const major = typeof spec === "string" ? /^yarn@(\d+)/.exec(spec)?.[1] : undefined;
          const yarnrc =
            scan && (await scan.pathExists(scan.resolve(cwd, ".yarnrc.yml")))
              ? await scan.readTextFileOrWarn(scan.resolve(cwd, ".yarnrc.yml"))
              : undefined;
          const immutableDisabled =
            disabled(commandEnv.YARN_ENABLE_IMMUTABLE_INSTALLS) ||
            /^\s*enableImmutableInstalls:\s*false\s*$/m.test(yarnrc ?? "");
          if (!immutableDisabled && ciEnabled && (Number(major) >= 2 || yarnrc !== undefined)) {
            continue;
          }
          // Unknown Yarn version may be modern and immutable by default.
          if (major === undefined && !immutableDisabled) {
            continue;
          }
        }
        findings.push(
          buildDiagnostic(doc, meta, step.node, {
            message: `Job "${step.jobName}" uses ${manager} without an effective frozen lockfile setting.`,
            why: `This ${manager} install does not show an enabled frozen lockfile flag or applicable CI default, so dependency resolution may change the committed lockfile.`,
            suggestion: `Commit a current lockfile and use ${manager === "pnpm" ? "pnpm install --frozen-lockfile" : manager === "yarn" ? "yarn install --immutable (modern) or --frozen-lockfile (classic)" : "bun ci or bun install --frozen-lockfile"}.`,
            measurementHint:
              "Compare install step duration before and after enabling frozen lockfile behavior.",
            aiHandoff: `Review ${doc.relativePath} job "${step.jobName}" and enable frozen lockfile behavior for ${manager} while preserving intentional dependency-update workflows.`,
            score: 55,
          }),
        );
      }
    }
    return findings;
  },
};
