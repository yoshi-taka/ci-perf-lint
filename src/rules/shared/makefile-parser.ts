import {
  parseBootstrapInvocation,
  shellCommandSegments,
  shellCommands,
} from "./command-patterns.ts";

export interface ParsedMakefile {
  targets: Map<string, string>;
  variables: Map<string, string>;
  includes: string[];
  /** Target prerequisites, even for pure alias targets that carry no recipe. */
  prereqs: Map<string, string[]>;
}

interface ToolMatch {
  tool: string;
  category: string;
}

const INTERNAL_PARALLEL_PATTERNS: { pattern: RegExp; tool: string; category: string }[] = [
  { pattern: /\bgo\s+test\b/, tool: "go test", category: "Go" },
  { pattern: /\bgo\s+build\b/, tool: "go build", category: "Go" },
  { pattern: /\bcargo\s+(?:test|build|check|clippy)\b/, tool: "cargo", category: "Rust" },
  { pattern: /\bpytest\s+-n\b/, tool: "pytest -n", category: "Python" },
  { pattern: /\bvitest\b/, tool: "vitest", category: "JavaScript" },
  { pattern: /\bjest\b/, tool: "jest", category: "JavaScript" },
  { pattern: /\bturbo\s+run\b/, tool: "turbo", category: "JavaScript" },
  { pattern: /\bnx\s+run-many\b/, tool: "nx", category: "JavaScript" },
  { pattern: /\bpnpm\s+-r\b/, tool: "pnpm -r", category: "JavaScript" },
  { pattern: /\bgradle\s+(?:test|build|check)\b/, tool: "gradle", category: "JVM" },
  { pattern: /\bmvn\s+-T\b/, tool: "mvn -T", category: "JVM" },
  { pattern: /\bsbt\s+(?:test|compile)\b/, tool: "sbt", category: "JVM" },
  // Crystal's compiler parallelizes codegen across cores by default, so a make
  // target wrapping `crystal build` gains nothing from make -j.
  { pattern: /\bcrystal\s+build\b/, tool: "crystal build", category: "Crystal" },
];

function detectToolInText(text: string): ToolMatch | null {
  for (const segment of shellCommandSegments(text)) {
    const command = segment
      .trim()
      .replace(/^[@+-]+/, "")
      // Drop leading make variable groups ($(EXPORTS) …) so the real
      // executable behind wrapper prefixes is visible to tokenization.
      .replace(/^(?:\$\$?[{(][^)}]*[)}]\s*)+/, "");
    const tokens = shellCommands(parseBootstrapInvocation(command)?.command ?? command)[0] ?? [];
    if (tokens[0] === "env" || tokens[0] === "export") {
      tokens.shift();
    }
    while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? "") || /^\$\{?\(/.test(tokens[0] ?? "")) {
      tokens.shift();
    }
    if (
      (["pnpm", "yarn"].includes(tokens[0] ?? "") && tokens[1] === "exec") ||
      (tokens[0] === "npm" && ["exec", "x"].includes(tokens[1] ?? ""))
    ) {
      tokens.splice(0, 2);
      if (tokens[0] === "--") {
        tokens.shift();
      }
    }
    const executable = tokens[0]?.split(/[\\/]/).at(-1);
    const normalized = [executable, ...tokens.slice(1)].join(" ");
    for (const entry of INTERNAL_PARALLEL_PATTERNS) {
      const expected = entry.tool.split(" ", 1)[0];
      if (executable === expected && entry.pattern.test(normalized)) {
        return { tool: entry.tool, category: entry.category };
      }
    }
  }
  return null;
}

function expandExpression(expr: string, variables: Map<string, string>, maxPasses = 5): string {
  let result = expr;
  for (let pass = 0; pass < maxPasses; pass++) {
    const expanded = result.replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_, p1, p2) => {
      const name: string = p1 ?? p2;
      return variables.get(name) ?? `$(${name})`;
    });
    if (expanded === result) {
      break;
    }
    result = expanded;
  }
  return result;
}

const TARGET_CHAR = /^[-a-zA-Z0-9_./]+$/;
// Target names may carry make expressions ($(O)/$(BIN)); keys stay raw and are
// aliased to their expanded form after parsing.
const TARGET_DEF = /^([^:=#\s][^:=#]*?)\s*:/;

export function parseMakefile(source: string): ParsedMakefile {
  const targets = new Map<string, string>();
  const variables = new Map<string, string>();
  const includes: string[] = [];
  const prereqs = new Map<string, string[]>();
  const lines = source.split("\n");

  let currentTarget: string | null = null;
  let currentPrereqs: string[] = [];
  let recipeLines: string[] = [];
  let inRecipe = false;

  function flushRecipe() {
    if (currentTarget) {
      prereqs.set(currentTarget, currentPrereqs);
    }
    if (inRecipe && currentTarget && recipeLines.length > 0) {
      targets.set(currentTarget, recipeLines.join("\n"));
    }
    inRecipe = false;
    currentTarget = null;
    currentPrereqs = [];
    recipeLines = [];
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      flushRecipe();
      continue;
    }

    const includeMatch = trimmed.match(/^include\s+(\S+)/);
    if (includeMatch) {
      includes.push(includeMatch[1]!);
      flushRecipe();
      continue;
    }

    const varMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:::|:=|[?]?=)\s*(.*)$/);
    if (varMatch && !rawLine.startsWith("\t")) {
      flushRecipe();
      variables.set(varMatch[1]!, varMatch[2]!.trim());
      continue;
    }

    const targetMatch = trimmed.match(TARGET_DEF);
    if (targetMatch && !rawLine.startsWith("\t")) {
      flushRecipe();
      // Windows makefiles use backslash separators; normalize structural
      // names so chain lookups stay separator-agnostic (recipes are untouched).
      currentTarget = targetMatch[1]!.replace(/\\/g, "/");
      const rest = trimmed
        .slice(targetMatch[0].length)
        .replace(/\s*#.*$/, "")
        .trim()
        .replace(/\\/g, "/");
      currentPrereqs = rest.length > 0 ? rest.split(/\s+/) : [];
      inRecipe = true;
      recipeLines = [];
      continue;
    }

    if (rawLine.startsWith("\t") && inRecipe) {
      recipeLines.push(rawLine);
      continue;
    }

    flushRecipe();
  }

  flushRecipe();

  // Alias expression keys to their expanded form so chain lookups like
  // ".build/crystal" reach targets declared as $(O)/$(CRYSTAL_BIN).
  for (const [name, recipe] of [...targets]) {
    if (name.includes("$")) {
      const expanded = expandExpression(name, variables).trim();
      if (expanded !== name && TARGET_CHAR.test(expanded) && !targets.has(expanded)) {
        targets.set(expanded, recipe);
      }
    }
  }

  return { targets, variables, includes, prereqs };
}

const SUB_MAKE_RE = /(?:make|\$\(MAKE\))\s+(?:-C\s+\S+\s+)?([a-zA-Z0-9_./-]+)/g;

interface ChainContext {
  targets: Map<string, string>;
  variables: Map<string, string>;
  prereqs?: Map<string, string[]>;
}

function walkTargetEdges(
  target: string,
  ctx: ChainContext,
  visited: Set<string>,
  recipes: string[],
): void {
  const edges = ctx.prereqs?.get(target);
  if (!edges) {
    return;
  }
  for (const edge of edges.slice(0, 64)) {
    const expanded = expandExpression(edge, ctx.variables).trim();
    for (const token of expanded.split(/\s+/).slice(0, 64)) {
      if (token && TARGET_CHAR.test(token)) {
        walkTargetChain(token, ctx, visited, recipes);
      }
    }
  }
}

function walkTargetChain(
  target: string,
  ctx: ChainContext,
  visited: Set<string>,
  recipes: string[],
): void {
  if (visited.has(target)) {
    return;
  }
  visited.add(target);

  const recipe = ctx.targets.get(target);
  if (!recipe) {
    // A pure alias target carries no recipe; follow its prerequisites so a
    // thin `make alias` still reveals the recipes it really runs.
    walkTargetEdges(target, ctx, visited, recipes);
    return;
  }

  recipes.push(recipe);

  // Prerequisites are built before the recipe runs; a heavy prereq build is
  // part of what `make <target>` executes.
  walkTargetEdges(target, ctx, visited, recipes);

  let m: RegExpExecArray | null;
  while ((m = SUB_MAKE_RE.exec(recipe)) !== null) {
    walkTargetChain(m[1]!, ctx, visited, recipes);
  }

  const targetVarRe = /\bTARGET\s*=\s*"?(\w+)"?/g;
  while ((m = targetVarRe.exec(recipe)) !== null) {
    walkTargetChain(m[1]!, ctx, visited, recipes);
  }
}

export function collectRecipeChain(
  target: string,
  parsed: Pick<ParsedMakefile, "targets" | "variables" | "prereqs">,
): string[] {
  const recipes: string[] = [];
  walkTargetChain(target, parsed, new Set(), recipes);
  return recipes;
}

export function detectInternalParallelTool(
  recipes: string[],
  variables: Map<string, string>,
): ToolMatch | null {
  for (const recipe of recipes) {
    const m = detectToolInText(recipe);
    if (m) {
      return m;
    }
    const expandedRecipe = expandExpression(recipe, variables);
    if (expandedRecipe !== recipe) {
      const m2 = detectToolInText(expandedRecipe);
      if (m2) {
        return m2;
      }
    }
  }

  return null;
}
