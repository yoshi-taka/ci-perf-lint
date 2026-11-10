import type { Node } from "oxc-parser";
import { loadOxcParser } from "./oxc-parser.ts";

function propertyName(node: Node): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }
  return node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

export function legacyEslintWarningRules(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const config = value as Record<string, unknown>;
  if (
    config.extends ||
    config.overrides ||
    !config.rules ||
    typeof config.rules !== "object" ||
    Array.isArray(config.rules)
  ) {
    return [];
  }
  return Object.entries(config.rules)
    .filter(([, rule]) => {
      const severity: unknown = Array.isArray(rule) ? rule[0] : rule;
      return severity === "warn" || severity === 1;
    })
    .map(([name]) => name);
}

/** Literal configs only: never execute config. Spreads/extends clear earlier rules. */
export async function staticEslintWarningRules(
  filename: string,
  source: string,
  legacy = false,
): Promise<string[]> {
  const { parseSync } = await loadOxcParser();
  const parsed = parseSync(filename, source, { preserveParens: false });
  if (parsed.errors.length > 0) {
    return [];
  }
  if (legacy) {
    const config = findLegacyConfig(parsed.program.body);
    if (!config) {
      return [];
    }
    const rules = new Map<string, boolean>();
    return collectLegacy(config, rules)
      ? warningNames({ global: rules, scopedWarnings: new Set() })
      : [];
  }
  const config = findFlatConfig(parsed.program.body);
  if (!config) {
    return [];
  }
  const state: FlatRulesState = { global: new Map(), scopedWarnings: new Set() };
  collectFlat(config.config, state, config.declarations);
  return warningNames(state);
}

interface FlatRulesState {
  global: Map<string, boolean>;
  scopedWarnings: Set<string>;
}

function warningNames(state: FlatRulesState): string[] {
  const names = new Set<string>();
  for (const [name, warn] of state.global) {
    if (warn) {
      names.add(name);
    }
  }
  for (const name of state.scopedWarnings) {
    if (state.global.get(name) !== false) {
      names.add(name);
    }
  }
  return [...names];
}

function findLegacyConfig(statements: readonly Node[]): Node | undefined {
  let config: Node | undefined;
  for (const statement of statements) {
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      statement.expression.operator === "=" &&
      statement.expression.left.type === "MemberExpression" &&
      !statement.expression.left.computed &&
      statement.expression.left.object.type === "Identifier" &&
      statement.expression.left.object.name === "module" &&
      propertyName(statement.expression.left.property) === "exports" &&
      !config
    ) {
      config = statement.expression.right;
      continue;
    }
    return undefined;
  }
  return config;
}

interface FlatConfig {
  config: Node;
  declarations: Map<string, Node>;
}

function findFlatConfig(statements: readonly Node[]): FlatConfig | undefined {
  const declarations = new Map<string, Node>();
  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") {
      continue;
    }
    for (const declaration of statement.declarations) {
      if (declaration.id.type !== "Identifier" || !declaration.init) {
        continue;
      }
      if (declarations.has(declaration.id.name)) {
        declarations.delete(declaration.id.name);
      } else {
        declarations.set(declaration.id.name, declaration.init);
      }
    }
  }
  let config: Node | undefined;
  for (const statement of statements) {
    if (statement.type === "ImportDeclaration") {
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration" && !config) {
      config = statement.declaration;
      continue;
    }
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      statement.expression.operator === "=" &&
      statement.expression.left.type === "MemberExpression" &&
      !statement.expression.left.computed &&
      statement.expression.left.object.type === "Identifier" &&
      statement.expression.left.object.name === "module" &&
      propertyName(statement.expression.left.property) === "exports" &&
      !config
    ) {
      config = statement.expression.right;
      continue;
    }
    if (
      statement.type === "VariableDeclaration" ||
      statement.type === "FunctionDeclaration" ||
      statement.type === "ClassDeclaration"
    ) {
      continue;
    }
    // Unknown top-level statements (including throw) make the exported config
    // unsafe to infer.
    return undefined;
  }
  return config ? { config, declarations } : undefined;
}

function collectLegacy(node: Node, rules: Map<string, boolean>): boolean {
  if (node.type !== "ObjectExpression") {
    return false;
  }
  const names = new Set<string>();
  for (const property of node.properties) {
    if (
      property.type !== "Property" ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    ) {
      return false;
    }
    const name = propertyName(property.key);
    if (!name || names.has(name) || !["rules", "root"].includes(name)) {
      return false;
    }
    names.add(name);
    if (name === "root") {
      if (property.value.type !== "Literal" || typeof property.value.value !== "boolean") {
        return false;
      }
      continue;
    }
    if (property.value.type !== "ObjectExpression") {
      return false;
    }
    for (const rule of property.value.properties) {
      if (rule.type !== "Property" || rule.computed || rule.kind !== "init" || rule.method) {
        return false;
      }
      const ruleName = propertyName(rule.key);
      const severity = rule.value.type === "ArrayExpression" ? rule.value.elements[0] : rule.value;
      if (
        !ruleName ||
        severity?.type !== "Literal" ||
        ![0, 1, 2, "off", "warn", "error"].includes(severity.value as string | number)
      ) {
        return false;
      }
      rules.set(ruleName, severity.value === "warn" || severity.value === 1);
    }
  }
  return true;
}

function resolveLocal(
  node: Node,
  declarations: Map<string, Node>,
  seen: Set<string>,
): Node | undefined {
  if (node.type !== "Identifier") {
    return node;
  }
  if (seen.has(node.name)) {
    return undefined;
  }
  const initializer = declarations.get(node.name);
  if (!initializer) {
    return undefined;
  }
  seen.add(node.name);
  const resolved = resolveLocal(initializer, declarations, seen);
  seen.delete(node.name);
  return resolved;
}

function collectFlat(
  node: Node,
  state: FlatRulesState,
  declarations: Map<string, Node>,
  seen = new Set<string>(),
): void {
  const resolved = resolveLocal(node, declarations, seen);
  if (!resolved) {
    return;
  }
  if (resolved.type === "ArrayExpression") {
    for (const element of resolved.elements) {
      if (!element) {
        continue;
      }
      if (element.type === "SpreadElement") {
        state.global.clear();
        state.scopedWarnings.clear();
        continue;
      }
      collectFlat(element, state, declarations, seen);
    }
    return;
  }
  if (resolved.type === "CallExpression") {
    for (const argument of resolved.arguments) {
      collectFlat(argument, state, declarations, seen);
    }
    return;
  }
  if (resolved.type !== "ObjectExpression") {
    return;
  }
  const scoped = resolved.properties.some(
    (property) =>
      property.type === "Property" && !property.computed && propertyName(property.key) === "files",
  );
  const local = new Map<string, boolean>();
  const sink: RuleSink = scoped
    ? {
        set: (name, warn) => local.set(name, warn),
        clear: () => local.clear(),
        delete: (name) => local.delete(name),
      }
    : {
        set: (name, warn) => {
          state.global.set(name, warn);
          if (!warn) {
            state.scopedWarnings.delete(name);
          }
        },
        clear: () => {
          state.global.clear();
          state.scopedWarnings.clear();
        },
        delete: (name) => {
          state.global.delete(name);
          state.scopedWarnings.delete(name);
        },
      };
  for (const property of resolved.properties) {
    if (property.type === "SpreadElement") {
      sink.clear();
      continue;
    }
    if (property.computed || property.kind !== "init" || property.method) {
      sink.clear();
      continue;
    }
    const name = propertyName(property.key);
    if (name === "rules") {
      const value = resolveLocal(property.value, declarations, seen);
      if (value?.type !== "ObjectExpression") {
        sink.clear();
        continue;
      }
      collectFlatRules(value, sink);
    } else if (name === "extends") {
      sink.clear();
    }
    // files, ignores, languageOptions, plugins, settings, linterOptions,
    // processor and name do not change literal rule severities.
  }
  if (scoped) {
    for (const [name, warn] of local) {
      if (warn) {
        state.scopedWarnings.add(name);
      }
    }
  }
}

interface RuleSink {
  set(name: string, warn: boolean): void;
  clear(): void;
  delete(name: string): void;
}

function collectFlatRules(node: Node, sink: RuleSink): void {
  if (node.type !== "ObjectExpression") {
    sink.clear();
    return;
  }
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      sink.clear();
      continue;
    }
    if (property.computed || property.kind !== "init" || property.method) {
      sink.clear();
      continue;
    }
    const ruleName = propertyName(property.key);
    const severity =
      property.value.type === "ArrayExpression" ? property.value.elements[0] : property.value;
    if (
      !ruleName ||
      severity?.type !== "Literal" ||
      ![0, 1, 2, "off", "warn", "error"].includes(severity.value as string | number)
    ) {
      if (ruleName) {
        sink.delete(ruleName);
      }
      continue;
    }
    sink.set(ruleName, severity.value === "warn" || severity.value === 1);
  }
}
