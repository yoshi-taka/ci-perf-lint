import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { collectCommandEntries } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { toolInvocations } from "./shared/tool-command-evidence.ts";
import { repositoryCommandHead } from "./shared/repository-command-evidence.ts";
import { workflowHasUnmodeledShell } from "./shared/workflow-command-context.ts";

const meta = {
  id: "prefer-mise-over-nvm-in-ci",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-mise-over-nvm-in-ci.md",
  scope: "all",
  precheck: (doc) => (/\bnvm\b/.test(doc.source ?? "") ? 1 : 0),
} satisfies RuleMeta;

function runsNvm(text: string, depth = 0): boolean {
  if (depth >= 4) {
    return false;
  }
  return toolInvocations(text).some((words) => {
    if (
      ["bash", "sh", "/bin/bash", "/bin/sh"].includes(words[0] ?? "") &&
      /^-[a-z]*c[a-z]*$/.test(words[1] ?? "")
    ) {
      return runsNvm(words[2] ?? "", depth + 1);
    }
    const [tool, task] = repositoryCommandHead(words);
    if (tool !== "nvm" || !["install", "use", "exec", "run"].includes(task ?? "")) {
      return false;
    }
    const argumentsStart = words.indexOf(task!, 1) + 1;
    for (const argument of words.slice(argumentsStart)) {
      // Flags for the nested Node command are not nvm help/version requests.
      if ((task === "exec" || task === "run") && !argument.startsWith("-")) {
        break;
      }
      if (["--help", "-h", "--version", "-V"].includes(argument)) {
        return false;
      }
    }
    return true;
  });
}

export const preferMiseOverNvmInCiRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const unsupportedNodes = new Set(
      doc.kind === "github-actions"
        ? doc.jobs.flatMap((job) =>
            job.steps
              .filter((step) => workflowHasUnmodeledShell(doc, job, step))
              .map((step) => step.runNode),
          )
        : [],
    );
    return collectCommandEntries(doc).flatMap((entry) => {
      if (unsupportedNodes.has(entry.node) || !runsNvm(entry.text)) {
        return [];
      }
      return [
        buildDiagnostic(doc, meta, entry.node, {
          message: `Job "${entry.jobName}" uses nvm to install, select, or execute Node.js in CI.`,
          why: "nvm shell initialization and Node setup add CI bootstrap work. GitHub Actions measurements on Ubuntu x64 and arm64 found mise faster for fresh setup and installed-tool cache reuse. This reduces environment setup overhead, not the execution time of Node.js itself.",
          suggestion:
            "Replace CI nvm setup with mise, using jdx/mise-action on GitHub Actions or mise install plus mise exec on other CI platforms. Preserve the selected Node version, matrix coverage, npm configuration, and required global packages; cache the installed tools rather than unnecessary download archives.",
          measurementHint:
            "Compare setup duration with both an empty cache and a cache hit, including manager installation and cache restore time. Confirm the same Node/npm versions and passing builds and tests.",
          aiHandoff: `Replace nvm setup in ${doc.relativePath} job "${entry.jobName}" step "${entry.stepName}" with mise. Keep the same resolved Node version and matrix entries. Translate .nvmrc aliases explicitly or enable and verify mise's Node idiomatic-version-file support; do not assume .nvmrc is read by default. Preserve npm settings and required global packages, export the tool PATH for later steps, and verify cold/cache-hit setup time and test results.`,
          score: 45,
        }),
      ];
    });
  },
};
