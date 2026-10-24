import { parseSync, visitorKeys, type Node, type Expression } from "oxc-parser";

type Kind = "test" | "page" | "context";
interface Binding {
  kind?: Kind;
  value?: Expression;
  scope: Scope;
  written?: boolean;
}
interface Scope {
  parent?: Scope;
  bindings: Map<string, Binding>;
  functionScope: boolean;
}

function children(node: Node): Node[] {
  const record = node as unknown as Record<string, unknown>;
  return (visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = record[key];
    return (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node => !!child && typeof child === "object" && "type" in child,
    );
  });
}

function bindingNames(pattern: Node): string[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "AssignmentPattern":
      return bindingNames(pattern.left);
    case "RestElement":
      return bindingNames(pattern.argument);
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        bindingNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => (element ? bindingNames(element) : []));
    default:
      return [];
  }
}

function lookup(scope: Scope, name: string): Binding | undefined {
  return scope.bindings.get(name) ?? (scope.parent ? lookup(scope.parent, name) : undefined);
}

function memberName(node: Node): string | undefined {
  if (node.type !== "MemberExpression") {
    return undefined;
  }
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return undefined;
}

function expressionKind(node: Node, scope: Scope, seen = new Set<Binding>()): Kind | undefined {
  if (node.type === "Identifier") {
    const binding = lookup(scope, node.name);
    if (!binding || binding.written || seen.has(binding)) {
      return undefined;
    }
    if (binding.kind) {
      return binding.kind;
    }
    seen.add(binding);
    return binding.value ? expressionKind(binding.value, binding.scope, seen) : undefined;
  }
  if (
    node.type === "AwaitExpression" ||
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression"
  ) {
    return expressionKind(
      node.type === "AwaitExpression" ? node.argument : node.expression,
      scope,
      seen,
    );
  }
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const receiver = expressionKind(node.callee.object, scope, seen);
    const name = memberName(node.callee);
    if (receiver === "test" && name === "extend") {
      return "test";
    }
    if (receiver === "page" && name === "context") {
      return "context";
    }
    if (receiver === "context" && name === "newPage") {
      return "page";
    }
  }
  return undefined;
}

const fixtureMethods = new Set([
  "only",
  "skip",
  "fixme",
  "fail",
  "beforeEach",
  "beforeAll",
  "afterEach",
  "afterAll",
]);

/** Same-file lexical provenance only; no type guesses or cross-file fixture resolution. */
export function findPlaywrightRoutes(filename: string, source: string): number[] {
  const parsed = parseSync(filename, source, { preserveParens: false });
  if (parsed.errors.length > 0) {
    return [];
  }
  const scopes = new WeakMap<Node, Scope>();
  const parents = new WeakMap<Node, Node>();
  const nodes: Node[] = [];
  const root: Scope = { bindings: new Map(), functionScope: true };

  function declare(pattern: Node, scope: Scope, value?: Expression) {
    for (const name of bindingNames(pattern)) {
      scope.bindings.set(name, { scope, value, written: scope.bindings.has(name) });
    }
  }

  function walk(node: Node, outer: Scope, parent?: Node) {
    if (parent) {
      parents.set(node, parent);
    }
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      declare(node.id, outer);
    }
    const isFunction =
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration";
    const createsScope =
      isFunction ||
      [
        "BlockStatement",
        "CatchClause",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
        "ClassExpression",
        "ClassDeclaration",
      ].includes(node.type);
    const scope = createsScope
      ? { parent: outer, bindings: new Map<string, Binding>(), functionScope: isFunction }
      : outer;
    scopes.set(node, scope);
    nodes.push(node);
    if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id) {
      declare(node.id, scope);
    }
    if (isFunction) {
      if (node.type !== "ArrowFunctionExpression" && node.id) {
        declare(node.id, scope);
      }
      for (const param of node.params) {
        declare(param.type === "TSParameterProperty" ? param.parameter : param, scope);
      }
    }
    if (node.type === "CatchClause" && node.param) {
      declare(node.param, scope);
    }
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var") {
        while (!target.functionScope && target.parent) {
          target = target.parent;
        }
      }
      for (const declaration of node.declarations) {
        declare(
          declaration.id,
          target,
          node.kind === "const" && declaration.id.type === "Identifier"
            ? (declaration.init ?? undefined)
            : undefined,
        );
      }
    }
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        const isTest =
          node.importKind !== "type" &&
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === "test" &&
          ["@playwright/test", "playwright/test"].includes(node.source.value);
        scope.bindings.set(specifier.local.name, { scope, kind: isTest ? "test" : undefined });
      }
    }
    for (const child of children(node)) {
      walk(child, scope, node);
    }
  }
  walk(parsed.program, root);

  // Invalidate reassigned bindings conservatively, including writes in nested functions.
  for (const node of nodes) {
    if (
      node.type !== "AssignmentExpression" &&
      node.type !== "UpdateExpression" &&
      node.type !== "ForOfStatement" &&
      node.type !== "ForInStatement"
    ) {
      continue;
    }
    const target = node.type === "UpdateExpression" ? node.argument : node.left;
    const scope = scopes.get(node)!;
    if (target.type === "Identifier") {
      const binding = lookup(scope, target.name);
      if (binding) {
        binding.written = true;
      }
    } else if (target.type === "ObjectPattern" || target.type === "ArrayPattern") {
      for (const name of bindingNames(target)) {
        const binding = lookup(scope, name);
        if (binding) {
          binding.written = true;
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") {
      continue;
    }
    const scope = scopes.get(node)!;
    const parent = parents.get(node);
    let call = parent;
    let fixture = false;
    if (parent?.type === "Property") {
      const object = parents.get(parent);
      call = object && parents.get(object);
      fixture =
        object?.type === "ObjectExpression" &&
        call?.type === "CallExpression" &&
        call.arguments[0] === object &&
        memberName(call.callee) === "extend";
    }
    if (call?.type !== "CallExpression") {
      continue;
    }
    const callScope = scopes.get(call)!;
    const callee = call.callee;
    const valid =
      expressionKind(callee, callScope) === "test" ||
      (callee.type === "MemberExpression" &&
        expressionKind(callee.object, callScope) === "test" &&
        (fixture ? memberName(callee) === "extend" : fixtureMethods.has(memberName(callee) ?? "")));
    if (!valid) {
      continue;
    }
    const param = node.params[0];
    if (param?.type !== "ObjectPattern") {
      continue;
    }
    for (const property of param.properties) {
      if (property.type !== "Property" || property.computed || property.key.type !== "Identifier") {
        continue;
      }
      const kind = property.key.name;
      if (kind !== "page" && kind !== "context") {
        continue;
      }
      if (property.value.type !== "Identifier") {
        continue;
      }
      const binding = scope.bindings.get(property.value.name);
      if (binding) {
        binding.kind = kind;
      }
    }
  }

  return nodes.flatMap((node) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "MemberExpression" ||
      memberName(node.callee) !== "route" ||
      node.arguments.length < 2
    ) {
      return [];
    }
    const kind = expressionKind(node.callee.object, scopes.get(node)!);
    return kind === "page" || kind === "context" ? [node.callee.start] : [];
  });
}
