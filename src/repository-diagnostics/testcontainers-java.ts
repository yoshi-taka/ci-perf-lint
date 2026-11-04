import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";

const sleepMeta = {
  id: "testcontainers-fixed-sleep-after-start",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/testcontainers-fixed-sleep-after-start.md",
} satisfies RuleMeta;
const lifecycleMeta = {
  id: "consider-testcontainers-shared-lifecycle",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-testcontainers-shared-lifecycle.md",
} satisfies RuleMeta;

// Mask non-code while preserving UTF-16 offsets and line breaks. This is a
// narrow source-pattern detector, not a Java parser or a symbol resolver.
function maskJavaNonCode(text: string): string {
  const chars = text.split("");
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index++) {
      if (chars[index] !== "\n" && chars[index] !== "\r") {
        chars[index] = " ";
      }
    }
  };
  let index = 0;
  while (index < text.length) {
    const start = index;
    if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index + 2);
      index = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
    } else if (text[index] === '"' || text[index] === "'") {
      const delimiter = text.startsWith('"""', index) ? '"""' : text[index]!;
      index += delimiter.length;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
        } else if (text.startsWith(delimiter, index)) {
          index += delimiter.length;
          break;
        } else {
          index++;
        }
      }
    } else {
      index++;
      continue;
    }
    blank(start, Math.min(index, text.length));
  }
  return chars.join("");
}

function importedContainerTypes(code: string): string[] {
  return [
    ...code.matchAll(/\bimport\s+org\.testcontainers\.(?:\w+\.)+([A-Za-z_]\w*Container)\s*;/g),
  ].map((match) => match[1]!);
}

function initializedContainers(code: string, types: string[]) {
  if (types.length === 0) {
    return [];
  }
  const typePattern = types.join("|");
  const pattern = new RegExp(
    `\\b(${typePattern})\\s*(?:<[^;={}()]*>)?\\s+([A-Za-z_]\\w*)\\s*=\\s*new\\s+\\1\\s*(?:<[^;={}()]*>)?\\s*\\(`,
    "g",
  );
  return [...code.matchAll(pattern)].filter((match) => {
    const name = match[2]!;
    // Ambiguous declarations, parameters, and reassignment are not proof of
    // which object start() refers to. False negatives are preferable here.
    const declarations =
      code.match(new RegExp(`\\b[A-Za-z_]\\w*\\s*(?:<[^;={}()]*>)?\\s+${name}\\b`, "g")) ?? [];
    const assignments = code.match(new RegExp(`\\b${name}\\s*=`, "g")) ?? [];
    return declarations.length === 1 && assignments.length === 1;
  });
}

interface JavaTestSource {
  file: string;
  code: string;
  types: string[];
}
const sourceLoads = new WeakMap<
  RepositoryDiagnosticContext["scanContext"],
  Promise<JavaTestSource[]>
>();

function javaTestSources(context: RepositoryDiagnosticContext): Promise<JavaTestSource[]> {
  const existing = sourceLoads.get(context.scanContext);
  if (existing) {
    return existing;
  }
  const load = (async () => {
    const files = await context.scanContext.walkFiles(".", {
      cacheKey: "testcontainers-java-test-sources",
      include: (file) => /(?:^|\/)src\/(?:test|integrationTest)\/java\/.*\.java$/.test(file),
    });
    const sources: JavaTestSource[] = [];
    for (const file of files.sort().slice(0, 200)) {
      const text = await context.scanContext.readTextFileOrWarn(context.scanContext.resolve(file));
      if (!text || text.length > 500_000 || !text.includes("org.testcontainers.")) {
        continue;
      }
      const code = maskJavaNonCode(text);
      const types = importedContainerTypes(code);
      if (types.length > 0) {
        sources.push({ file, code, types });
      }
    }
    return sources;
  })();
  sourceLoads.set(context.scanContext, load);
  return load;
}

export async function collectTestcontainersFixedSleepDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  for (const { file, code, types } of await javaTestSources(context)) {
    if (
      /\b(?:class|interface|enum|record)\s+Thread\b|\bimport\s+(?!java\.lang\.Thread\s*;)[\w.]+\.Thread\s*;|\b[A-Za-z_]\w*\s+Thread\s*[=;,(]/.test(
        code,
      )
    ) {
      continue;
    }
    for (const container of initializedContainers(code, types)) {
      const name = container[2]!;
      const pattern = new RegExp(
        `(?:^|[;{}])\\s*(?:this\\s*\\.\\s*)?${name}\\s*\\.\\s*start\\s*\\(\\s*\\)\\s*;\\s*(Thread\\s*\\.\\s*sleep\\s*\\(\\s*([0-9][0-9_]*)(?:[lL])?\\s*\\)\\s*;)`,
        "g",
      );
      for (const match of code.matchAll(pattern)) {
        const millis = Number(match[2]!.replaceAll("_", ""));
        if (!Number.isSafeInteger(millis) || millis <= 0) {
          continue;
        }
        const index = match.index + match[0].indexOf(match[1]!);
        findings.push(
          buildRepositoryDiagnostic(context.repository, sleepMeta, {
            location: { path: file, ...lineColumnForIndex(code, index) },
            message: `${file} sleeps ${millis} ms immediately after Testcontainers ${name}.start().`,
            why: "Testcontainers start() already applies its configured startup/readiness checks. An adjacent fixed sleep always adds its full duration and can still be too short on a slow runner. A listening port may not prove application readiness; an explicit readiness or stabilization condition can avoid unnecessary delay without deleting required synchronization.",
            suggestion:
              "Replace startup-padding sleeps with a bounded Testcontainers HTTP, healthcheck, log, or application-specific wait condition. If elapsed time itself is required by the test, retain that semantic and document it. Do not simply delete synchronization, shorten startup timeouts, enable cross-run reuse, or disable cleanup.",
            measurementHint:
              "Compare startup-to-ready and complete suite duration over repeated cold and slow-runner executions. Preserve test assertions and verify that readiness, stabilization, timeout, and cleanup behavior remain correct; a single passing fast run is insufficient.",
            aiHandoff: `Review ${file} at the Thread.sleep following ${name}.start(). Determine whether the delay is readiness padding, stabilization, or a deliberate elapsed-time assertion. Replace only padding with a bounded readiness condition appropriate to the actual service, preserving assertions, timeouts, isolation, and cleanup.`,
            score: 50,
          }),
        );
      }
    }
  }
  return findings;
}

export async function collectTestcontainersSharedLifecycleDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  for (const { file, code, types } of await javaTestSources(context)) {
    if (
      !/\bimport\s+org\.testcontainers\.junit\.jupiter\.Container\s*;/.test(code) ||
      !/\bimport\s+org\.testcontainers\.junit\.jupiter\.Testcontainers\s*;/.test(code) ||
      !/\bimport\s+org\.junit\.jupiter\.api\.Test\s*;/.test(code) ||
      !/@Testcontainers\b/.test(code) ||
      (code.match(/\b(?:class|interface|enum|record)\s+\w+/g) ?? []).length !== 1 ||
      (code.match(/@Test\b/g) ?? []).length < 2 ||
      /\bwithReuse\s*\(|@Execution\b/.test(code)
    ) {
      continue;
    }
    for (const container of initializedContainers(code, types)) {
      const name = container[2]!;
      const prefix = code.slice(0, container.index);
      if (
        !/@Container\s+(?:(?:public|private|protected|final|transient|volatile)\s+)*$/.test(prefix)
      ) {
        continue;
      }
      findings.push(
        buildRepositoryDiagnostic(context.repository, lifecycleMeta, {
          location: { path: file, ...lineColumnForIndex(code, container.index) },
          message: `${file} declares instance @Container ${name} in a JUnit 5 class with multiple @Test methods.`,
          why: "The Testcontainers JUnit 5 extension starts and stops instance @Container fields for every test method. A static field is shared within the class and can avoid repeated setup, but changes state isolation. The detector does not prove a shared lifecycle is safe, how many methods run in CI, or a measured startup cost.",
          suggestion:
            "If every test can start from equivalent clean state, benchmark a class-scoped static @Container with an explicit database/queue/application reset between tests. Keep per-test containers when fresh-process isolation or restart behavior is required. Do not enable experimental cross-run reuse or disable Ryuk/cleanup for CI.",
          measurementHint:
            "Measure actual container start count, reset cost, image-pull cost, peak memory, and total suite duration. Run tests individually, in changed order, and under the existing execution policy to detect state leakage; retain per-test lifecycle if isolation cannot be preserved.",
          aiHandoff: `Review instance @Container ${name} in ${file}. Check fresh-process, persistence, restart, and concurrency assumptions before considering a static class-scoped container. Supply a deterministic state reset and preserve cleanup; compare total cost including reset, and keep the original lifecycle if test isolation changes. Do not recommend withReuse(true) for CI.`,
          score: 35,
        }),
      );
    }
  }
  return findings;
}
