import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { type CollectedDockerfileData, normalizeRelativePath } from "./docker-build-targets.ts";
import { parseDockerfileFromInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "dockerfile-runtime-image-uses-heavy-base",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-runtime-image-uses-heavy-base.md",
} satisfies RuleMeta;

const nonRuntimePattern =
  /(?:^|[/.\s_-])(?:build(?:er)?|dev|development|test|tests|ci|debug|tools?|bench(?:mark)?)(?:$|[/.\s_-])/i;
const fullTagPattern = /^(?:latest|\d+(?:\.\d+)*(?:-(?:buster|bullseye|bookworm|trixie))?)$/;
const buildToolsPattern =
  /\b(?:gcc|clang|make|cmake|build-essential|cargo\s+(?:build|install)|go\s+(?:build|install)|dotnet\s+(?:build|publish)|rustc)\b|\bg\+\+(?:\s|$)/;

function lightweightAlternative(image: string): string | undefined {
  const reference = image.split("@")[0] ?? "";
  if (reference.includes("$")) {
    return undefined;
  }
  if (image.includes("@") && !reference.includes(":")) {
    return undefined;
  }
  const normalized = reference.replace(/^(?:docker\.io\/|index\.docker\.io\/)?(?:library\/)?/, "");
  const match = normalized.match(/^(node|python|ruby|golang|rust)(?::([^/]+))?$/);
  if (match) {
    const name = match[1];
    const tag = match[2] ?? "latest";
    if (!fullTagPattern.test(tag)) {
      return undefined;
    }
    if (name === "golang" || name === "rust") {
      return "a compatible distroless runtime or minimal OS image; scratch only for a verified statically linked binary with its required runtime assets";
    }
    const slimTag = tag === "latest" ? "slim" : `${tag}-slim`;
    return `${name}:${slimTag}; Alpine only after musl compatibility checks, or a compatible distroless runtime when shell/package-manager access is unnecessary`;
  }
  if (
    /^mcr\.microsoft\.com\/dotnet\/sdk:\d+(?:\.\d+)*(?:-(?:bookworm|bullseye|trixie|jammy|noble)(?:-slim)?)?$/.test(
      reference,
    )
  ) {
    return "a matching .NET runtime image (aspnet for ASP.NET applications), or runtime-deps for a compatible self-contained deployment";
  }
  return undefined;
}

function resolveFinalBaseImage(data: CollectedDockerfileData): string | undefined {
  const bases = new Map<string, string>();
  for (const index of data.fromInstructionIndexes) {
    const instruction = data.instructions[index];
    if (!instruction) {
      continue;
    }
    const parsed = parseDockerfileFromInstruction(instruction);
    if (!parsed) {
      continue;
    }
    const image = bases.get(parsed.image.toLowerCase()) ?? parsed.image;
    if (index === data.finalFromInstructionIndex) {
      return image;
    }
    const alias = instruction.text.match(/\bAS\s+(\S+)\s*$/i)?.[1];
    if (alias) {
      bases.set(alias.toLowerCase(), image);
    }
  }
  return undefined;
}

export async function collectDockerRuntimeBaseImageDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.dockerfilePath)) {
      continue;
    }
    seen.add(target.dockerfilePath);
    const relativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    if (nonRuntimePattern.test(relativePath)) {
      continue;
    }
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }
    const from = data.instructions[data.finalFromInstructionIndex];
    if (!from) {
      continue;
    }
    const image = resolveFinalBaseImage(data);
    if (!image) {
      continue;
    }
    const alias = from.text.match(/\bAS\s+(\S+)\s*$/i)?.[1];
    if (alias && nonRuntimePattern.test(alias)) {
      continue;
    }
    const alternative = lightweightAlternative(image);
    if (!alternative) {
      continue;
    }
    const stage = data.instructions.slice(data.finalFromInstructionIndex + 1);
    if (!stage.some((instruction) => /^(?:CMD|ENTRYPOINT)\b/i.test(instruction.text))) {
      continue;
    }
    if (
      stage.some(
        (instruction) =>
          /^(?:RUN|CMD|ENTRYPOINT)\b/i.test(instruction.text) &&
          (buildToolsPattern.test(instruction.text) ||
            buildToolsPattern.test(instruction.jsonStrings?.join(" ") ?? "")),
      )
    ) {
      continue;
    }
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: { path: relativePath, line: from.startLine, column: 1 },
        message: `The final runtime stage in ${relativePath} uses the development-heavy base image ${image}.`,
        why: "Full language and SDK images include development tools and system packages that may be unnecessary at runtime, increasing image transfer, extraction, and storage costs.",
        suggestion:
          "Consider a compatible lightweight runtime base: slim, Alpine, distroless, or a language-specific runtime image. Preserve the runtime version and OS family where possible; use scratch only for verified static binaries.",
        measurementHint:
          "Compare final image size and cold pull, extraction, and push times; run application and native-library compatibility tests. Smaller images do not guarantee faster execution or rebuilds.",
        aiHandoff: `Review the final stage of ${relativePath}, currently based on ${image}. Consider ${alternative}. Preserve the runtime version and Debian/OS generation where possible, verify required shared libraries, certificates and runtime assets, and keep compilation in a builder stage. If the final stage inherits a builder, create a separate runtime stage and copy the required artifacts and production dependencies.`,
        score: 45,
      }),
    );
  }
  return diagnostics;
}
