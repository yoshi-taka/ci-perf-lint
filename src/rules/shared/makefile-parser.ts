export interface ParsedMakefile {
  targets: Map<string, string>;
  variables: Map<string, string>;
  includes: string[];
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
];

function detectToolInText(text: string): ToolMatch | null {
  for (const entry of INTERNAL_PARALLEL_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { tool: entry.tool, category: entry.category };
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
const TARGET_DEF = /^([-a-zA-Z0-9_./][-a-zA-Z0-9_./]*)\s*:/;

export function parseMakefile(source: string): ParsedMakefile {
  const targets = new Map<string, string>();
  const variables = new Map<string, string>();
  const includes: string[] = [];
  const lines = source.split("\n");

  let currentTarget: string | null = null;
  let recipeLines: string[] = [];
  let inRecipe = false;

  function flushRecipe() {
    if (inRecipe && currentTarget && recipeLines.length > 0) {
      targets.set(currentTarget, recipeLines.join("\n"));
    }
    inRecipe = false;
    currentTarget = null;
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
      currentTarget = targetMatch[1]!;
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

  return { targets, variables, includes };
}

export function extractMakeTarget(run: string): string | null {
  const parts = run.trim().split(/\s+/);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "-C" || part === "--directory") {
      i++;
      continue;
    }
    if (part.startsWith("-")) {
      continue;
    }
    if (part.startsWith("$")) {
      continue;
    }
    if (TARGET_CHAR.test(part)) {
      return part;
    }
    break;
  }
  return null;
}

const SUB_MAKE_RE = /(?:make|\$\(MAKE\))\s+(?:-C\s+\S+\s+)?([a-zA-Z0-9_./-]+)/g;

function walkTargetChain(
  target: string,
  targets: Map<string, string>,
  variables: Map<string, string>,
  visited: Set<string>,
  recipes: string[],
): void {
  if (visited.has(target)) {
    return;
  }
  visited.add(target);

  const recipe = targets.get(target);
  if (!recipe) {
    return;
  }

  recipes.push(recipe);

  let m: RegExpExecArray | null;
  while ((m = SUB_MAKE_RE.exec(recipe)) !== null) {
    walkTargetChain(m[1]!, targets, variables, visited, recipes);
  }

  const targetVarRe = /\bTARGET\s*=\s*"?(\w+)"?/g;
  while ((m = targetVarRe.exec(recipe)) !== null) {
    walkTargetChain(m[1]!, targets, variables, visited, recipes);
  }
}

export function collectRecipeChain(
  target: string,
  targets: Map<string, string>,
  variables: Map<string, string>,
): string[] {
  const recipes: string[] = [];
  walkTargetChain(target, targets, variables, new Set(), recipes);
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

  for (const [_name, value] of variables) {
    const expanded = expandExpression(value, variables);
    const m = detectToolInText(`${_name}=${expanded}`);
    if (m) {
      return m;
    }
  }

  return null;
}
