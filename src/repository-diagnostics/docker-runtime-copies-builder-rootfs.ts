import type { Diagnostic, RuleMeta } from "../types.ts";
import path from "node:path";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { normalizeRelativePath } from "./docker-build-targets.ts";
import { findDockerRuntimeRootfsCopies } from "./docker-runtime-rootfs-evidence.ts";
import { parseDockerfileCopyInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "dockerfile-runtime-copies-builder-rootfs",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-runtime-copies-builder-rootfs.md",
} satisfies RuleMeta;
const nonRuntimePathPattern =
  /(?:^|[/._-])(?:dev|development|tests?|ci|debug|tools?|toolchain|bench(?:mark)?)(?:$|[/._-])/i;

export async function collectDockerRuntimeCopiesBuilderRootfsDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const findings = new Map<string, Diagnostic>();
  for (const target of targets) {
    const file = normalizeRelativePath(repoRoot, target.dockerfilePath);
    if (findings.has(file) || nonRuntimePathPattern.test(file)) {
      continue;
    }
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }
    if (
      !data.instructions.some(
        (instruction) =>
          instruction.flags?.some((flag) => flag.name.toLowerCase() === "from") &&
          parseDockerfileCopyInstruction(instruction)?.sources.some(
            (source) => !/[$*?]/.test(source) && path.posix.normalize(source) === "/",
          ),
      )
    ) {
      continue;
    }
    let goMainModule: string | undefined;
    const moduleFile = path.join(target.contextPath, "go.mod");
    if (await scanContext.pathExists(moduleFile)) {
      const moduleText = await scanContext.readTextFileOrWarn(moduleFile);
      const module = /^\s*module\s+([^\s]+)\s*$/m.exec(moduleText ?? "")?.[1];
      if (module) {
        const files = await scanContext.readDirectoryEntries(target.contextPath);
        for (const entry of files
          .filter(
            (candidate) =>
              candidate.isFile() &&
              candidate.name.endsWith(".go") &&
              !candidate.name.endsWith("_test.go"),
          )
          .slice(0, 32)) {
          const source = await scanContext.readTextFileOrWarn(
            path.join(target.contextPath, entry.name),
          );
          const declaration = (source ?? "")
            .replace(/^\uFEFF/, "")
            .replace(/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
          if (/^package\s+main\b/.test(declaration)) {
            goMainModule = module;
            break;
          }
        }
      }
    }
    const evidence = findDockerRuntimeRootfsCopies(
      data.instructions,
      target.targetStage,
      goMainModule,
    );
    const first = evidence[0];
    if (!first) {
      continue;
    }
    findings.set(
      file,
      buildRepositoryDiagnostic({ ...repository, primaryWorkflowPath: target.workflow }, meta, {
        location: { path: file, line: first.copy.startLine, column: 1 },
        message: `The output image in ${file} copies the entire ${first.compiler} builder filesystem from stage ${first.source} at line ${first.copy.startLine}, then executes ${first.artifact.path}, compiled at line ${first.artifact.line}.`,
        why: "Copying a compiler builder's entire merged filesystem carries compiler binaries, source and other surviving build-only files into the output image. Targeted artifact copies can reduce snapshot, export, push, pull and extraction work.",
        suggestion:
          "Copy only the executable and required runtime assets from the builder into a compatible runtime base. Preserve dynamic libraries, certificates, timezone data, ownership and runtime behavior; verify whether a full rootfs is intentional.",
        measurementHint:
          "Compare output image bytes and export, push, cold pull and extraction time. Verify startup, ABI compatibility and application behavior; do not assume that copying / inherits the source stage's historical layers or image configuration.",
        aiHandoff: `Review the rootfs COPY at line ${first.copy.startLine} in ${file}. ${first.artifact.path} is compiled at line ${first.artifact.line} in ${first.source}. Replace the full-root transfer with explicit artifact and necessary runtime-asset copies only after checking rootfs assembly intent, ABI, permissions and application behavior.`,
        score: 70,
      }),
    );
  }
  return [...findings.values()];
}
