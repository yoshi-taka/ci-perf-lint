import { DockerfileParser } from "dockerfile-ast";
import type { Flag, JSONArgument } from "dockerfile-ast";
export {
  instructionLooksAptInstallWithoutCleanupOrCacheMount,
  instructionLooksAptInstallWithoutNoInstallRecommends,
  instructionLooksApkAddWithoutNoCacheOrCacheMount,
  instructionLooksBundleInstallWithoutCacheMount,
  instructionLooksBunInstallWithoutFrozenLockfile,
  instructionLooksCargoBuildReleaseWithoutCacheMount,
  instructionLooksCargoInstallWithoutLocked,
  instructionLooksGoBuildWithoutCacheMount,
  instructionLooksGoModDownloadWithoutCacheMount,
  instructionLooksGradleBuildWithoutCacheMount,
  instructionLooksGradleDependenciesWithoutCacheMount,
  instructionLooksMavenBuildWithoutCacheMount,
  instructionLooksMavenGoOfflineWithoutCacheMount,
  instructionLooksNpmInstallInsteadOfCi,
  instructionLooksPnpmInstallWithoutFrozenLockfile,
  instructionLooksUvProjectSyncWithoutFrozenLockfile,
  instructionLooksYarnInstallWithoutImmutableLockfile,
} from "./dockerfile-instruction-heuristics.ts";
import { instructionLooksBroadCompiledBuildWithoutBindMount } from "./dockerfile-instruction-heuristics.ts";

const commentStripPattern = /\s+#.*$/;
const tokenSplitPattern = /"[^"]*"|'[^']*'|\S+/g;
const continuationPattern = /\\\s*$/;
const keywordPattern = /^\S+/;
const flagOptionPattern = /^--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|\S+))?\s*/;
const linkFalsePattern = /^--link=false$/i;
const wideCopyPattern =
  /^(?:copy|add)\s+(?:--from=\S+\s+)?(?:--chown=\S+\s+)?(?:--chmod=\S+\s+)?(?:\.\/?|\.{1,2}\/?)\s+\S+/i;
const installPattern =
  /^run\b.*\b(npm\s+(?:ci|install)|pnpm\s+install|yarn\s+install|bun\s+install|pip\s+install|bundle\s+install|go\s+mod\s+download)\b/i;
const broadOrVolatileSourcePattern = /^(src|app|lib|pkg)(?:\/|$)/i;
const packageStarJsonPattern = /^package\*\.json$/i;
const allowedArtifactPattern = /^(dist|build|public)(?:\/|$)/i;
const singleSegmentPattern = /^[^/]+$/;
const smallFilePattern =
  /(?:^|\/)(go\.mod|go\.sum|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|uv\.lock|Cargo\.toml|Cargo\.lock|pom\.xml|Gemfile|Gemfile\.lock)$/i;
const remoteUrlPattern = /^(?:https?|git):\/\//i;
const archivePattern = /\.(?:tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|zip)$/i;
const floatingTagPattern = /:latest$/i;
const runInstructionPattern = /^run\b/i;
const fromStartPattern = /^\s*from\b/i;
const newlineSplitPattern = /\r?\n/;

export function lineLooksWideCopy(line: string): boolean {
  const normalized = stripDockerfileComment(line);
  return wideCopyPattern.test(normalized);
}

export function lineLooksInstall(line: string): boolean {
  const normalized = stripDockerfileComment(line);
  return installPattern.test(normalized);
}

export interface CollectedDockerfileInstruction {
  text: string;
  startLine: number;
  keyword?: string;
  argumentsContent?: string | null;
  flags?: {
    name: string;
    value: string | null;
  }[];
  jsonStrings?: string[];
}

interface DockerfileCopyInstruction {
  sources: string[];
  destination: string;
  linked: boolean;
}

interface DockerfileFromInstruction {
  image: string;
}

interface DockerfileBroadCopyBeforeCompiledBuild {
  copyInstruction: CollectedDockerfileInstruction;
  buildInstruction: CollectedDockerfileInstruction;
  language: "Go" | "Rust";
}

function collectDockerfileInstructionsWithFallback(
  lines: string[],
): CollectedDockerfileInstruction[] {
  const instructions: CollectedDockerfileInstruction[] = [];
  let currentText = "";
  let currentStartLine = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isContinuation = continuationPattern.test(line);
    const withoutContinuation = line.replace(continuationPattern, "");

    if (currentText.length === 0) {
      currentStartLine = index + 1;
      currentText = withoutContinuation;
    } else {
      currentText = `${currentText} ${withoutContinuation.trim()}`;
    }

    if (!isContinuation) {
      instructions.push({
        text: currentText,
        startLine: currentStartLine,
      });
      currentText = "";
    }
  }

  if (currentText.length > 0) {
    instructions.push({
      text: currentText,
      startLine: currentStartLine,
    });
  }

  return instructions;
}

export function collectDockerfileInstructions(lines: string[]): CollectedDockerfileInstruction[] {
  try {
    const dockerfile = DockerfileParser.parse(lines.join("\n"));
    return dockerfile.getInstructions().map((instruction) => {
      const flags =
        "getFlags" in instruction && typeof instruction.getFlags === "function"
          ? (instruction.getFlags() as Flag[]).map((flag) => ({
              name: flag.getName(),
              value: flag.getValue(),
            }))
          : undefined;
      const jsonStrings =
        "getJSONStrings" in instruction && typeof instruction.getJSONStrings === "function"
          ? (instruction.getJSONStrings() as JSONArgument[]).map((argument) =>
              argument.getJSONValue(),
            )
          : undefined;

      return {
        text: instruction.toString(),
        startLine: instruction.getRange().start.line + 1,
        keyword: instruction.getKeyword(),
        argumentsContent: instruction.getArgumentsContent(),
        flags,
        jsonStrings,
      };
    });
  } catch {
    return collectDockerfileInstructionsWithFallback(lines);
  }
}

function stripDockerfileComment(text: string): string {
  return text.replace(commentStripPattern, "").trim();
}

function normalizeDockerfilePathToken(token: string): string {
  return token.replace(/^['"]|['"]$/g, "").replace(/\\/g, "/");
}

export function parseDockerfileCopyInstruction(
  instruction: CollectedDockerfileInstruction,
): DockerfileCopyInstruction | undefined {
  const keyword =
    instruction.keyword ?? stripDockerfileComment(instruction.text).match(keywordPattern)?.[0];
  if (keyword?.toLowerCase() !== "copy") {
    return undefined;
  }

  if (instruction.flags || instruction.argumentsContent || instruction.jsonStrings) {
    const linked = (instruction.flags ?? []).some(
      (flag) => flag.name.toLowerCase() === "link" && flag.value?.toLowerCase() !== "false",
    );
    const tokens =
      instruction.jsonStrings && instruction.jsonStrings.length > 0
        ? instruction.jsonStrings.map((value) => normalizeDockerfilePathToken(value))
        : (instruction.argumentsContent
            ?.match(tokenSplitPattern)
            ?.map((token) => normalizeDockerfilePathToken(token)) ?? []);
    const destination = tokens.at(-1);

    if (!destination || tokens.length < 2) {
      return undefined;
    }

    return {
      sources: tokens.slice(0, -1),
      destination,
      linked,
    };
  }

  const normalized = stripDockerfileComment(instruction.text);
  const args = normalized.replace(/^copy\b/i, "").trim();
  let rest = args;
  let linked = false;

  while (rest.startsWith("--")) {
    const match = rest.match(flagOptionPattern);
    if (!match) {
      break;
    }
    const option = match[0].trim();
    if (option === "--link" || option.startsWith("--link=")) {
      linked = !linkFalsePattern.test(option);
    }
    rest = rest.slice(match[0].length).trimStart();
  }

  if (rest.startsWith("[")) {
    try {
      const values = JSON.parse(rest) as unknown;
      if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
        return undefined;
      }
      const tokens = values.map((value) => normalizeDockerfilePathToken(value as string));
      const destination = tokens.at(-1);
      if (!destination || tokens.length < 2) {
        return undefined;
      }
      return {
        sources: tokens.slice(0, -1),
        destination,
        linked,
      };
    } catch {
      return undefined;
    }
  }

  const tokens = rest.match(tokenSplitPattern)?.map((token) => normalizeDockerfilePathToken(token));
  const destination = tokens?.at(-1);
  if (!tokens || !destination || tokens.length < 2) {
    return undefined;
  }

  return {
    sources: tokens.slice(0, -1),
    destination,
    linked,
  };
}

export function parseDockerfileAddInstruction(
  instruction: CollectedDockerfileInstruction,
): DockerfileCopyInstruction | undefined {
  const keyword =
    instruction.keyword ?? stripDockerfileComment(instruction.text).match(keywordPattern)?.[0];
  if (keyword?.toLowerCase() !== "add") {
    return undefined;
  }

  if (instruction.argumentsContent || instruction.jsonStrings) {
    const tokens =
      instruction.jsonStrings && instruction.jsonStrings.length > 0
        ? instruction.jsonStrings.map((value) => normalizeDockerfilePathToken(value))
        : (instruction.argumentsContent
            ?.match(tokenSplitPattern)
            ?.map((token) => normalizeDockerfilePathToken(token)) ?? []);
    const destination = tokens.at(-1);

    if (!destination || tokens.length < 2) {
      return undefined;
    }

    return {
      sources: tokens.slice(0, -1),
      destination,
      linked: false,
    };
  }

  const normalized = stripDockerfileComment(instruction.text);
  const args = normalized.replace(/^add\b/i, "").trim();
  let rest = args;

  while (rest.startsWith("--")) {
    const match = rest.match(flagOptionPattern);
    if (!match) {
      break;
    }
    rest = rest.slice(match[0].length).trimStart();
  }

  if (rest.startsWith("[")) {
    try {
      const values = JSON.parse(rest) as unknown;
      if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
        return undefined;
      }
      const tokens = values.map((value) => normalizeDockerfilePathToken(value as string));
      const destination = tokens.at(-1);
      if (!destination || tokens.length < 2) {
        return undefined;
      }
      return {
        sources: tokens.slice(0, -1),
        destination,
        linked: false,
      };
    } catch {
      return undefined;
    }
  }

  const tokens = rest.match(tokenSplitPattern)?.map((token) => normalizeDockerfilePathToken(token));
  const destination = tokens?.at(-1);
  if (!tokens || !destination || tokens.length < 2) {
    return undefined;
  }

  return {
    sources: tokens.slice(0, -1),
    destination,
    linked: false,
  };
}

export function parseDockerfileFromInstruction(
  instruction: CollectedDockerfileInstruction,
): DockerfileFromInstruction | undefined {
  const keyword =
    instruction.keyword ?? stripDockerfileComment(instruction.text).match(keywordPattern)?.[0];
  if (keyword?.toLowerCase() !== "from") {
    return undefined;
  }

  const args =
    instruction.argumentsContent ??
    stripDockerfileComment(instruction.text)
      .replace(/^from\b/i, "")
      .trim();
  const tokens = args.match(tokenSplitPattern)?.map((token) => token.replace(/^['"]|['"]$/g, ""));
  const image = tokens?.find((token) => !token.startsWith("--"));
  if (!image) {
    return undefined;
  }

  return { image };
}

export function dockerfileSourceLooksBroadOrVolatile(source: string): boolean {
  const normalized = normalizeDockerfilePathToken(source).replace(/^\.\/+/, "");
  return (
    normalized === "." ||
    normalized === "./" ||
    normalized === "" ||
    broadOrVolatileSourcePattern.test(normalized) ||
    packageStarJsonPattern.test(normalized)
  );
}

export function dockerfileSourceLooksAllowedArtifact(source: string): boolean {
  const normalized = normalizeDockerfilePathToken(source).replace(/^\.\/+/, "");
  return allowedArtifactPattern.test(normalized);
}

export function dockerfileSourceLooksSmall(source: string): boolean {
  const normalized = normalizeDockerfilePathToken(source).replace(/^\.\/+/, "");
  if (
    dockerfileSourceLooksBroadOrVolatile(normalized) ||
    dockerfileSourceLooksAllowedArtifact(normalized)
  ) {
    return false;
  }

  return singleSegmentPattern.test(normalized) || smallFilePattern.test(normalized);
}

export function dockerfileSourceLooksWholeContext(source: string): boolean {
  const normalized = normalizeDockerfilePathToken(source).replace(/^\.\/+/, "");
  return normalized === "." || normalized === "./" || normalized === "";
}

export function dockerfileSourceLooksLocalAddWithoutClearNeed(source: string): boolean {
  const normalized = normalizeDockerfilePathToken(source);
  if (remoteUrlPattern.test(normalized)) {
    return false;
  }

  return !archivePattern.test(normalized);
}

export function collectDockerfileStageAliases(
  instructions: CollectedDockerfileInstruction[],
): Set<string> {
  const aliases = new Set<string>();

  for (const instruction of instructions) {
    const keyword =
      instruction.keyword ?? stripDockerfileComment(instruction.text).match(keywordPattern)?.[0];
    if (keyword?.toLowerCase() !== "from") {
      continue;
    }

    const args =
      instruction.argumentsContent ??
      stripDockerfileComment(instruction.text)
        .replace(/^from\b/i, "")
        .trim();
    const tokens = args.match(tokenSplitPattern)?.map((token) => token.replace(/^['"]|['"]$/g, ""));
    if (!tokens) {
      continue;
    }

    const asIndex = tokens.findIndex((token) => token.toUpperCase() === "AS");
    const aliasToken = asIndex !== -1 ? tokens[asIndex + 1] : undefined;
    if (aliasToken && asIndex + 1 < tokens.length) {
      aliases.add(aliasToken.toLowerCase());
    }
  }

  return aliases;
}

export function dockerfileFromUsesFloatingTag(image: string): boolean {
  if (
    image.toLowerCase() === "scratch" ||
    image.includes("@") ||
    image.includes("$") ||
    image.includes("{")
  ) {
    return false;
  }

  const imageWithoutRegistryPort = image.replace(/^[^/]+:\d+\//, "");
  const lastPathSegment = imageWithoutRegistryPort.split("/").at(-1) ?? imageWithoutRegistryPort;
  return !lastPathSegment.includes(":") || floatingTagPattern.test(lastPathSegment);
}

function normalizeDockerfileDestination(destination: string): string {
  const normalized = normalizeDockerfilePathToken(destination).replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

export function runInstructionModifiesPath(instruction: string, destination: string): boolean {
  const normalized = stripDockerfileComment(instruction);
  if (!runInstructionPattern.test(normalized)) {
    return false;
  }

  const target = normalizeDockerfileDestination(destination);
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`\b(?:chmod|chown|rm|mv|cp|touch|find|sed)\b[\s\S]*(?:^|\s)${escapedTarget}(?:\s|/|$)`,
    "i",
  ).test(normalized);
}

export function findBroadSourceCopyBeforeCompiledBuild(
  instructions: CollectedDockerfileInstruction[],
): DockerfileBroadCopyBeforeCompiledBuild | undefined {
  let broadSourceCopy: CollectedDockerfileInstruction | undefined;

  for (const instruction of instructions) {
    if (fromStartPattern.test(instruction.text)) {
      broadSourceCopy = undefined;
      continue;
    }

    const buildLanguage = instructionLooksBroadCompiledBuildWithoutBindMount(instruction.text);
    if (buildLanguage && broadSourceCopy) {
      return {
        copyInstruction: broadSourceCopy,
        buildInstruction: instruction,
        language: buildLanguage,
      };
    }

    const copyInstruction = parseDockerfileCopyInstruction(instruction);
    const copiesFromStage = (instruction.flags ?? []).some(
      (flag) => flag.name.toLowerCase() === "from",
    );
    if (
      copyInstruction &&
      !copiesFromStage &&
      copyInstruction.sources.some((source) => dockerfileSourceLooksWholeContext(source))
    ) {
      broadSourceCopy = instruction;
    }
  }

  return undefined;
}

function dockerignorePatternCoversRoot(pattern: string, rootName: string): boolean {
  const normalized = pattern.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("#") || normalized.startsWith("!")) {
    return false;
  }

  return (
    normalized === "*" ||
    normalized === "**" ||
    normalized === ".*" ||
    normalized === rootName ||
    normalized === `${rootName}/**` ||
    normalized === `**/${rootName}` ||
    normalized === `**/${rootName}/**`
  );
}

export function dockerignoreCoversRoot(dockerignoreText: string, rootName: string): boolean {
  const patterns = dockerignoreText.split(newlineSplitPattern);
  let ignored = false;

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("!")) {
      const negatedPattern = trimmed.slice(1);
      if (dockerignorePatternCoversRoot(negatedPattern, rootName)) {
        ignored = false;
      }
      continue;
    }

    if (dockerignorePatternCoversRoot(trimmed, rootName)) {
      ignored = true;
    }
  }

  return ignored;
}
