import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { collectMavenCommands, mavenConfiguresThreads } from "../rules/shared/maven-commands.ts";
import { workflowStepEnv } from "../rules/shared/workflow-command-context.ts";

const meta = {
  id: "maven-parallel-not-enabled",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/maven-parallel-not-enabled.md",
} satisfies RuleMeta;

const POM_FILE = /^pom\.xml$/;

async function rootPomHasModules(scanContext: RepositoryScanContext): Promise<boolean> {
  const text = await scanContext.readTextFileOrWarn(scanContext.resolve("pom.xml"));
  return Boolean(text && /<modules\b/.test(text));
}

async function countPomFiles(scanContext: RepositoryScanContext): Promise<number> {
  try {
    const entries = await scanContext.readDirectoryEntries(scanContext.repoRoot);
    let count = 0;
    const subdirs: string[] = [];
    for (const e of entries) {
      if (POM_FILE.test(e.name)) {
        count++;
      }
      if (
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "target" &&
        e.name !== "node_modules"
      ) {
        subdirs.push(e.name);
      }
    }
    for (const dir of subdirs) {
      const subEntries = await scanContext
        .readDirectoryEntries(path.join(scanContext.repoRoot, dir))
        .catch(() => undefined);
      if (subEntries) {
        for (const e of subEntries) {
          if (POM_FILE.test(e.name)) {
            count++;
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function collectMavenParallelNotEnabledDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (!context.repository.jvm.usesMaven) {
    return [];
  }

  const hasUntunedLifecycle = context.predicateIndex.allSteps.some(({ workflow, job, step }) =>
    collectMavenCommands(step.run ?? "", workflowStepEnv(workflow, job, step)).some(
      (command) =>
        command.lifecycle && !command.parallelConfigured && !command.opaque && !command.inactive,
    ),
  );
  if (!hasUntunedLifecycle) {
    return [];
  }

  const configPath = context.scanContext.resolve(".mvn", "maven.config");
  if (await context.scanContext.pathExists(configPath)) {
    const config = await context.scanContext.readTextFileOrWarn(configPath);
    if (config && mavenConfiguresThreads(config) !== false) {
      return [];
    }
  }

  const multiModule =
    (await rootPomHasModules(context.scanContext)) ||
    (await countPomFiles(context.scanContext)) >= 2;
  if (!multiModule) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: {
        path: "pom.xml",
        line: 1,
        column: 1,
      },
      message: "Maven parallel build is not enabled for a likely multi-module build.",
      why: "Maven runs modules serially by default. For multi-module builds, --threads lets independent modules build and test in parallel, which can substantially reduce CI wall-clock time.",
      suggestion:
        "Add --threads 1C (one thread per CPU core) to CI Maven commands. Check Maven's thread-safety warnings first: plugins whose goals are not marked @threadSafe may need to be replaced or kept serial.",
      measurementHint:
        "Compare total CI build duration before and after adding --threads on the same runner. Watch Maven's unthreaded-plugin warnings, and confirm test results are unchanged.",
      aiHandoff:
        "Add --threads 1C to the Maven command in CI. This lets Maven build independent modules concurrently. If Maven reports plugins that are not marked @threadSafe, resolve or isolate them before relying on parallel execution.",
      score: 55,
    }),
  ];
}
