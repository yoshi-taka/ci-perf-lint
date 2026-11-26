import { collectDockerfileInstructions } from "./dockerfile-parser.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-parser.ts";
export { collectDockerfileInstructions } from "./dockerfile-parser.ts";
export type { CollectedDockerfileInstruction } from "./dockerfile-parser.ts";
export {
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

const commentStripPattern = /\s+#.*$/;
const tokenSplitPattern = /"[^"]*"|'[^']*'|\S+/g;
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
const remoteUrlPattern = /^(?:(?:https?|git|ssh):\/\/|git@[^/:]+:)/i;
const archivePattern = /\.(?:tar|gz|bz2|xz|zst|tgz|tbz2?|txz|tzst)$/i;
const floatingTagPattern = /:latest$/i;
const runInstructionPattern = /^run\b/i;
const newlineSplitPattern = /\r?\n/;

export function lineLooksWideCopy(line: string): boolean {
  const normalized = stripDockerfileComment(line);
  return wideCopyPattern.test(normalized);
}

export function lineLooksInstall(line: string): boolean {
  const normalized = stripDockerfileComment(line);
  return installPattern.test(normalized);
}

interface DockerfileCopyInstruction {
  sources: string[];
  destination: string;
  linked: boolean;
}

interface DockerfileFromInstruction {
  image: string;
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
  // Inline file contents are not COPY source paths.
  if (instruction.argumentsContent?.includes("\n")) {
    return undefined;
  }
  const keyword =
    instruction.keyword ?? stripDockerfileComment(instruction.text).match(keywordPattern)?.[0];
  if (keyword?.toLowerCase() !== "copy") {
    return undefined;
  }

  if (instruction.argumentsContent || instruction.jsonStrings) {
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
  if (instruction.argumentsContent?.includes("\n")) {
    return undefined;
  }
  if (/^ONBUILD\s+ADD\b/i.test(instruction.text.trim())) {
    const add = collectDockerfileInstructions([
      instruction.text.trim().replace(/^ONBUILD\s+/i, ""),
    ])[0];
    return add ? parseDockerfileAddInstruction(add) : undefined;
  }
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
  if (remoteUrlPattern.test(normalized) || /[$`]/.test(normalized)) {
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

export interface DockerfileStage {
  readonly index: number;
  readonly alias?: string;
  readonly fromInstructionIndex: number;
  readonly startInstructionIndex: number;
  readonly endInstructionIndex: number;
  readonly parentStageIndex?: number;
  readonly referencedStageIndexes: readonly number[];
}

const fromAliasPattern = /\sas\s+(["']?)([A-Za-z0-9_.-]+)\1\s*$/i;
const copyFromPattern = /\bcopy\b[^\n]*--from=(["']?)([^\s"']+)\1/i;
const runMountFromPattern = /--mount=[^\n]*\bfrom=(["']?)([^,\s"']+)\1/i;

function fromAlias(instruction: CollectedDockerfileInstruction): string | undefined {
  return fromAliasPattern.exec(instruction.text)?.[2]?.toLowerCase();
}

function stageReference(
  instruction: CollectedDockerfileInstruction,
  aliases: ReadonlyMap<string, number>,
): number | undefined {
  const flagValue = instruction.flags?.find((flag) => flag.name.toLowerCase() === "from")?.value;
  const value =
    flagValue ??
    copyFromPattern.exec(instruction.text)?.[2] ??
    runMountFromPattern.exec(instruction.text)?.[2];
  if (!value || value.includes("$")) {
    return undefined;
  }
  return aliases.get(value.toLowerCase()) ?? (/^\d+$/.test(value) ? Number(value) : undefined);
}

/** Stage boundaries only; Dockerfile semantics beyond FROM/COPY --from are not modelled. */
export function collectDockerfileStages(
  instructions: CollectedDockerfileInstruction[],
): DockerfileStage[] | undefined {
  const stages: {
    index: number;
    alias?: string;
    fromInstructionIndex: number;
    startInstructionIndex: number;
    endInstructionIndex: number;
    parentStageIndex?: number;
  }[] = [];
  const aliases = new Map<string, number>();

  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index]!;
    const from = parseDockerfileFromInstruction(instruction);
    if (!from) {
      continue;
    }
    if (from.image.includes("$")) {
      return undefined;
    }
    const previous = stages.at(-1);
    if (previous) {
      previous.endInstructionIndex = index - 1;
    }
    const alias = fromAlias(instruction);
    if (alias !== undefined && aliases.has(alias)) {
      return undefined;
    }
    const parentStageIndex =
      aliases.get(from.image.toLowerCase()) ??
      (/^\d+$/.test(from.image) ? Number(from.image) : undefined);
    if (parentStageIndex !== undefined && parentStageIndex >= stages.length) {
      return undefined;
    }
    stages.push({
      index: stages.length,
      alias,
      fromInstructionIndex: index,
      startInstructionIndex: index,
      endInstructionIndex: instructions.length - 1,
      parentStageIndex,
    });
    if (alias !== undefined) {
      aliases.set(alias, stages.length - 1);
    }
  }
  if (stages.length === 0) {
    return undefined;
  }

  const references = new Map<number, Set<number>>();
  let currentStage = -1;
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index]!;
    const stage = stages.find((candidate) => candidate.fromInstructionIndex === index);
    if (stage) {
      currentStage = stage.index;
      continue;
    }
    if (currentStage < 0) {
      continue;
    }
    const referenced = stageReference(instruction, aliases);
    if (referenced === undefined || referenced >= stages.length) {
      continue;
    }
    const refs = references.get(currentStage) ?? new Set<number>();
    refs.add(referenced);
    references.set(currentStage, refs);
  }

  return stages.map((stage) => ({
    ...stage,
    referencedStageIndexes: [...(references.get(stage.index) ?? [])].sort((a, b) => a - b),
  }));
}

/**
 * Instruction indexes that a build of `targetStage` can execute. Returns undefined
 * when stage relationships cannot be resolved, so callers can fail open.
 */
export function collectReachableDockerfileInstructionIndexes(
  instructions: CollectedDockerfileInstruction[],
  targetStage?: string,
): Set<number> | undefined {
  const stages = collectDockerfileStages(instructions);
  if (!stages) {
    return undefined;
  }
  const aliases = new Map<string, number>();
  for (const stage of stages) {
    if (stage.alias !== undefined) {
      aliases.set(stage.alias, stage.index);
    }
  }
  let outputStage = stages.length - 1;
  if (targetStage !== undefined && targetStage !== "") {
    const resolved =
      aliases.get(targetStage.toLowerCase()) ??
      (/^\d+$/.test(targetStage) ? Number(targetStage) : undefined);
    if (resolved === undefined || resolved >= stages.length) {
      return undefined;
    }
    outputStage = resolved;
  }

  const reached = new Set<number>();
  const visit = (stageIndex: number): void => {
    if (reached.has(stageIndex)) {
      return;
    }
    reached.add(stageIndex);
    const stage = stages[stageIndex]!;
    if (stage.parentStageIndex !== undefined) {
      visit(stage.parentStageIndex);
    }
    for (const reference of stage.referencedStageIndexes) {
      visit(reference);
    }
  };
  visit(outputStage);

  const reachableInstructions = new Set<number>();
  for (const stage of stages) {
    if (!reached.has(stage.index)) {
      continue;
    }
    for (let index = stage.startInstructionIndex; index <= stage.endInstructionIndex; index++) {
      reachableInstructions.add(index);
    }
  }
  return reachableInstructions;
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
