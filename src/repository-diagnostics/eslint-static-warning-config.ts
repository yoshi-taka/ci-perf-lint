import { parseSync, type Node } from "oxc-parser";

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

/** Literal configs only: never execute config or guess imported presets. */
export function staticEslintWarningRules(
  filename: string,
  source: string,
  legacy = false,
): string[] {
  const parsed = parseSync(filename, source, { preserveParens: false });
  if (parsed.errors.length > 0) {
    return [];
  }
  let config: Node | undefined;
  let defineConfig: string | undefined;
  for (const statement of parsed.program.body) {
    if (statement.type === "ImportDeclaration") {
      if (legacy) {
        return [];
      }
      if (statement.source.value !== "eslint/config") {
        return [];
      }
      for (const specifier of statement.specifiers) {
        if (
          specifier.type !== "ImportSpecifier" ||
          propertyName(specifier.imported) !== "defineConfig"
        ) {
          return [];
        }
        defineConfig = specifier.local.name;
      }
    } else if (statement.type === "ExportDefaultDeclaration" && !config) {
      if (legacy) {
        return [];
      }
      config = statement.declaration;
    } else if (
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
    } else {
      return [];
    }
  }
  if (!config) {
    return [];
  }
  const rules = new Map<string, boolean>();
  function collect(node: Node): boolean {
    if (node.type === "ArrayExpression") {
      return !legacy && node.elements.every((element) => !!element && collect(element));
    }
    if (
      node.type === "CallExpression" &&
      defineConfig &&
      node.callee.type === "Identifier" &&
      node.callee.name === defineConfig
    ) {
      return node.arguments.every(collect);
    }
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
      // Scoped/extended/plugin configs require effective-config evaluation, which is out of scope.
      if (
        !name ||
        names.has(name) ||
        !(legacy ? ["rules", "root"] : ["rules", "name", "ignores"]).includes(name)
      ) {
        return false;
      }
      names.add(name);
      if (name !== "rules") {
        if (
          name === "root" &&
          (property.value.type !== "Literal" || typeof property.value.value !== "boolean")
        ) {
          return false;
        }
        if (
          name === "name" &&
          (property.value.type !== "Literal" || typeof property.value.value !== "string")
        ) {
          return false;
        }
        if (
          name === "ignores" &&
          (property.value.type !== "ArrayExpression" ||
            !property.value.elements.every(
              (element) => element?.type === "Literal" && typeof element.value === "string",
            ))
        ) {
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
        const severity =
          rule.value.type === "ArrayExpression" ? rule.value.elements[0] : rule.value;
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
  return collect(config) ? [...rules].filter(([, warn]) => warn).map(([name]) => name) : [];
}
