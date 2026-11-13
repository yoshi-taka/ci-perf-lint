import type { Node, Program } from "oxc-parser";
import { exceedsSourceLimit, MAX_INLINE_SNAPSHOT_LINES } from "./source-size-policy.ts";

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, false | "expect" | "namespace">;
  writes: Set<string>;
  aliasStarts: Map<string, number>;
  declarations: Set<string>;
}

/** Framework imports are hoisted; ordinary instance declarations stay in a lexical child frame. */
export function findComponentSnapshots(
  module: Program | undefined,
  instance: Program,
  visitorKeys: Record<string, string[]>,
  suppressed: (offset: number) => boolean,
) {
  const hoisted = instance.body.filter((node) => node.type === "ImportDeclaration");
  const body = instance.body.filter((node) => node.type !== "ImportDeclaration");
  const frame = {
    type: "ExpressionStatement",
    start: 0,
    end: 0,
    expression: {
      type: "ArrowFunctionExpression",
      start: 0,
      end: 0,
      async: false,
      expression: false,
      params: [],
      body: { type: "BlockStatement", start: 0, end: 0, body },
    },
  } as unknown as Program["body"][number];
  const combined = { ...(module ?? instance), body: [...(module?.body ?? []), ...hoisted, frame] };
  return findInlineSnapshots(combined, visitorKeys, suppressed);
}

function bindingNames(node: Node): string[] {
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "AssignmentPattern":
      return bindingNames(node.left);
    case "RestElement":
      return bindingNames(node.argument);
    case "ObjectPattern":
      return node.properties.flatMap((property) =>
        bindingNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return node.elements.flatMap((element) => (element ? bindingNames(element) : []));
    default:
      return [];
  }
}

function bindingScope(scope: Scope, name: string): Scope | undefined {
  return scope.bindings.has(name)
    ? scope
    : scope.parent
      ? bindingScope(scope.parent, name)
      : undefined;
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

/** Global/named/namespace Jest expect; local bindings and writes win. */
export function findInlineSnapshots(
  program: Program,
  visitorKeys: Record<string, string[]>,
  suppressed: (offset: number) => boolean,
): { offset: number; lineCount: number }[] {
  const root: Scope = {
    functionScope: true,
    bindings: new Map([["expect", "expect"]]),
    writes: new Set(),
    aliasStarts: new Map(),
    declarations: new Set(),
  };
  const nodes: { node: Node; scope: Scope }[] = [];
  const scopes = new WeakMap<Node, Scope>();
  const aliases: {
    name: string;
    init: Node;
    scope: Scope;
    start: number;
    namespace: boolean;
    hoisted?: boolean;
  }[] = [];
  function declare(node: Node, scope: Scope) {
    for (const name of bindingNames(node)) {
      if (scope.declarations.has(name)) {
        scope.writes.add(name);
      }
      scope.declarations.add(name);
      scope.bindings.set(name, false);
    }
  }
  function walk(node: Node, outer: Scope) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      declare(node.id, outer);
      if (node.type === "FunctionDeclaration") {
        aliases.push({
          name: node.id.name,
          init: node,
          scope: outer,
          start: node.start,
          namespace: false,
          hoisted: true,
        });
      }
    }
    const isFunction =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    const scope: Scope =
      isFunction ||
      [
        "BlockStatement",
        "CatchClause",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
        "ClassDeclaration",
        "ClassExpression",
      ].includes(node.type)
        ? {
            parent: outer,
            functionScope: isFunction,
            bindings: new Map(),
            writes: new Set(),
            aliasStarts: new Map(),
            declarations: new Set(),
          }
        : outer;
    nodes.push({ node, scope });
    scopes.set(node, scope);
    if (isFunction) {
      if (node.type !== "ArrowFunctionExpression" && node.id) {
        declare(node.id, scope);
      }
      for (const parameter of node.params) {
        declare(parameter.type === "TSParameterProperty" ? parameter.parameter : parameter, scope);
      }
    }
    if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id) {
      declare(node.id, scope);
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
        declare(declaration.id, target);
        if (declaration.init) {
          if (declaration.id.type === "Identifier") {
            aliases.push({
              name: declaration.id.name,
              init: declaration.init,
              scope: target,
              start: declaration.start,
              namespace: false,
            });
          } else if (declaration.id.type === "ObjectPattern") {
            for (const property of declaration.id.properties) {
              if (
                property.type === "Property" &&
                !property.computed &&
                property.value.type === "Identifier" &&
                ((property.key.type === "Identifier" && property.key.name === "expect") ||
                  (property.key.type === "Literal" && property.key.value === "expect"))
              ) {
                aliases.push({
                  name: property.value.name,
                  init: declaration.init,
                  scope: target,
                  start: declaration.start,
                  namespace: true,
                });
              }
            }
          }
        }
      }
    }
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") {
          continue;
        }
        declare(specifier.local, scope);
        scope.bindings.set(
          specifier.local.name,
          scope.writes.has(specifier.local.name) || node.source.value !== "@jest/globals"
            ? false
            : specifier.type === "ImportNamespaceSpecifier"
              ? "namespace"
              : specifier.type === "ImportSpecifier" &&
                  (specifier.imported.type === "Identifier"
                    ? specifier.imported.name
                    : specifier.imported.value) === "expect"
                ? "expect"
                : false,
        );
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of visitorKeys[node.type] ?? []) {
      const value = record[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object" && "type" in child) {
          walk(child as Node, scope);
        }
      }
    }
  }
  walk(program, root);
  // Conservative: any write invalidates the binding, even in a nested closure.
  for (const { node, scope } of nodes) {
    if (
      node.type === "AssignmentExpression" ||
      node.type === "UpdateExpression" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement"
    ) {
      const target = node.type === "UpdateExpression" ? node.argument : node.left;
      for (const name of bindingNames(target)) {
        const owner = bindingScope(scope, name);
        owner?.bindings.set(name, false);
        owner?.writes.add(name);
      }
      if (target.type === "MemberExpression" && target.object.type === "Identifier") {
        const name = target.object.name;
        const owner = bindingScope(scope, name);
        if (owner?.bindings.get(name) === "namespace") {
          owner.bindings.set(name, false);
        }
      }
    }
  }
  function identifiedExpect(node: Node, scope: Scope, offset: number): boolean {
    if (node.type === "Identifier") {
      const owner = bindingScope(scope, node.name);
      return (
        owner?.bindings.get(node.name) === "expect" &&
        (owner.aliasStarts.get(node.name) ?? -1) < offset
      );
    }
    return (
      node.type === "MemberExpression" &&
      memberName(node) === "expect" &&
      node.object.type === "Identifier" &&
      bindingScope(scope, node.object.name)?.bindings.get(node.object.name) === "namespace"
    );
  }
  function transparentWrapper(node: Node, offset: number): boolean {
    if (
      node.type !== "ArrowFunctionExpression" &&
      node.type !== "FunctionExpression" &&
      node.type !== "FunctionDeclaration"
    ) {
      return false;
    }
    if (
      node.async ||
      node.generator ||
      node.params.length !== 1 ||
      node.params[0]?.type !== "Identifier" ||
      !node.body
    ) {
      return false;
    }
    const body =
      node.body.type === "BlockStatement"
        ? node.body.body.length === 1 && node.body.body[0]?.type === "ReturnStatement"
          ? node.body.body[0].argument
          : undefined
        : node.body;
    const scope = scopes.get(node);
    return Boolean(
      scope &&
      body?.type === "CallExpression" &&
      body.arguments.length === 1 &&
      body.arguments[0]?.type === "Identifier" &&
      body.arguments[0].name === node.params[0].name &&
      identifiedExpect(body.callee, scope, offset),
    );
  }
  // Resolve only lexically prior const identities; never evaluate wrappers or calls.
  // Writes are recorded first so propagation cannot resurrect invalid provenance.
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (const alias of aliases) {
      if (alias.scope.writes.has(alias.name) || alias.scope.bindings.get(alias.name)) {
        continue;
      }
      const identified = alias.namespace
        ? alias.init.type === "Identifier" &&
          bindingScope(alias.scope, alias.init.name)?.bindings.get(alias.init.name) === "namespace"
        : identifiedExpect(alias.init, alias.scope, alias.start) ||
          transparentWrapper(alias.init, alias.start);
      if (identified) {
        alias.scope.bindings.set(alias.name, "expect");
        alias.scope.aliasStarts.set(alias.name, alias.hoisted ? -1 : alias.start);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  const snapshots: { offset: number; lineCount: number }[] = [];
  for (const { node, scope } of nodes) {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "MemberExpression" ||
      suppressed(node.start)
    ) {
      continue;
    }
    const method = memberName(node.callee);
    if (method !== "toMatchInlineSnapshot" && method !== "toThrowErrorMatchingInlineSnapshot") {
      continue;
    }
    if (
      node.arguments.length < 1 ||
      node.arguments.length > (method === "toMatchInlineSnapshot" ? 2 : 1)
    ) {
      continue;
    }
    let receiver: Node = node.callee.object;
    while (
      receiver.type === "MemberExpression" &&
      ["not", "resolves", "rejects"].includes(memberName(receiver) ?? "")
    ) {
      receiver = receiver.object;
    }
    if (receiver.type !== "CallExpression") {
      continue;
    }
    if (!identifiedExpect(receiver.callee, scope, node.start)) {
      continue;
    }
    const argument = node.arguments.at(-1)!;
    const text =
      argument.type === "Literal" && typeof argument.value === "string"
        ? argument.value
        : argument.type === "TemplateLiteral" && argument.expressions.length === 0
          ? argument.quasis[0]?.value.cooked
          : undefined;
    if (text === undefined || text === null) {
      continue;
    }
    const lineCount = text.split(/\r\n|\r|\n/).length;
    if (exceedsSourceLimit(lineCount, MAX_INLINE_SNAPSHOT_LINES)) {
      snapshots.push({ offset: node.start, lineCount });
    }
  }
  return snapshots;
}
