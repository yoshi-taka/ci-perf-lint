import { parseSync, visitorKeys, type Node } from "oxc-parser";

function children(node: Node): Node[] {
  const record = node as unknown as Record<string, unknown>;
  return (visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = record[key];
    return (Array.isArray(value) ? value : [value]).filter(
      (child): child is Node => !!child && typeof child === "object" && "type" in child,
    );
  });
}

function names(pattern: Node): string[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "AssignmentPattern":
      return names(pattern.left);
    case "RestElement":
      return names(pattern.argument);
    case "ObjectPattern":
      return pattern.properties.flatMap((p) =>
        names(p.type === "RestElement" ? p.argument : p.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((p) => (p ? names(p) : []));
    default:
      return [];
  }
}

function member(node: Node, name: string): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    !node.optional &&
    node.property.type === "Identifier" &&
    node.property.name === name
  );
}

function awaitedStatement(node: Node): Node | undefined {
  let expression: Node | undefined;
  if (node.type === "ExpressionStatement") {
    expression = node.expression;
  }
  if (node.type === "VariableDeclaration" && node.declarations.length === 1) {
    expression = node.declarations[0]?.init ?? undefined;
  }
  return expression?.type === "AwaitExpression" ? expression.argument : undefined;
}

/** Direct constructor chains only. Ambiguous file-wide bindings conservatively abstain. */
export function findTestcontainersNodeSleeps(
  filename: string,
  source: string,
): { offset: number; millis: number }[] {
  const parsed = parseSync(filename, source, { preserveParens: false });
  if (parsed.errors.length) {
    return [];
  }
  const nodes: Node[] = [];
  const declarations = new Map<string, number>();
  const writes = new Set<string>();
  const constructors = new Set<string>();
  const timers = new Set<string>();
  const declare = (pattern: Node) => {
    for (const name of names(pattern)) {
      declarations.set(name, (declarations.get(name) ?? 0) + 1);
    }
  };
  function walk(node: Node) {
    nodes.push(node);
    if (node.type === "VariableDeclarator") {
      declare(node.id);
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      if (node.type !== "ArrowFunctionExpression" && node.id) {
        declare(node.id);
      }
      for (const param of node.params) {
        declare(param.type === "TSParameterProperty" ? param.parameter : param);
      }
    }
    if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id) {
      declare(node.id);
    }
    if (node.type === "CatchClause" && node.param) {
      declare(node.param);
    }
    if (
      node.type === "AssignmentExpression" ||
      node.type === "UpdateExpression" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement"
    ) {
      const target = node.type === "UpdateExpression" ? node.argument : node.left;
      for (const name of names(target)) {
        writes.add(name);
      }
      // Mutated constructor/timer members are not reliable provenance either.
      if (target.type === "MemberExpression" && target.object.type === "Identifier") {
        writes.add(target.object.name);
      }
    }
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        declare(specifier.local);
        if (
          node.importKind === "type" ||
          specifier.type !== "ImportSpecifier" ||
          specifier.importKind === "type" ||
          specifier.imported.type !== "Identifier"
        ) {
          continue;
        }
        const imported = specifier.imported.name;
        if (
          (node.source.value === "testcontainers" && imported === "GenericContainer") ||
          (/^@testcontainers\/[a-z0-9-]+$/.test(node.source.value) &&
            /^[A-Z]\w*Container$/.test(imported))
        ) {
          constructors.add(specifier.local.name);
        }
        if (
          ["node:timers/promises", "timers/promises"].includes(node.source.value) &&
          imported === "setTimeout"
        ) {
          timers.add(specifier.local.name);
        }
      }
    }
    for (const child of children(node)) {
      walk(child);
    }
  }
  walk(parsed.program);
  const reliable = (name: string, count = 1) =>
    (declarations.get(name) ?? 0) === count && !writes.has(name);
  function constructorChain(node: Node): boolean {
    if (node.type === "NewExpression") {
      return (
        node.callee.type === "Identifier" &&
        constructors.has(node.callee.name) &&
        reliable(node.callee.name)
      );
    }
    return (
      node.type === "CallExpression" &&
      !node.optional &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      !node.callee.optional &&
      node.callee.property.type === "Identifier" &&
      /^with[A-Z]/.test(node.callee.property.name) &&
      constructorChain(node.callee.object)
    );
  }
  function startsContainer(node: Node): boolean {
    return (
      node.type === "CallExpression" &&
      !node.optional &&
      node.arguments.length === 0 &&
      node.callee.type === "MemberExpression" &&
      member(node.callee, "start") &&
      constructorChain(node.callee.object)
    );
  }
  function duration(node: Node | undefined): number | undefined {
    return node?.type === "Literal" &&
      typeof node.value === "number" &&
      Number.isSafeInteger(node.value) &&
      node.value > 0
      ? node.value
      : undefined;
  }
  function sleep(node: Node): number | undefined {
    if (
      node.type === "CallExpression" &&
      !node.optional &&
      node.callee.type === "Identifier" &&
      timers.has(node.callee.name) &&
      reliable(node.callee.name) &&
      node.arguments.length === 1
    ) {
      return duration(node.arguments[0]);
    }
    if (
      node.type !== "NewExpression" ||
      node.callee.type !== "Identifier" ||
      node.callee.name !== "Promise" ||
      !reliable("Promise", 0) ||
      !reliable("setTimeout", 0) ||
      node.arguments.length !== 1
    ) {
      return undefined;
    }
    const callback = node.arguments[0];
    if (
      callback?.type !== "ArrowFunctionExpression" ||
      callback.async ||
      callback.params.length !== 1 ||
      callback.params[0]?.type !== "Identifier"
    ) {
      return undefined;
    }
    let call: Node = callback.body;
    if (call.type === "BlockStatement") {
      if (call.body.length !== 1 || call.body[0]?.type !== "ExpressionStatement") {
        return undefined;
      }
      call = call.body[0].expression;
    }
    const resolve = callback.params[0].name;
    if (
      resolve === "setTimeout" ||
      call.type !== "CallExpression" ||
      call.optional ||
      call.callee.type !== "Identifier" ||
      call.callee.name !== "setTimeout" ||
      call.arguments.length !== 2 ||
      call.arguments[0]?.type !== "Identifier" ||
      call.arguments[0].name !== resolve
    ) {
      return undefined;
    }
    return duration(call.arguments[1]);
  }
  const hits: { offset: number; millis: number }[] = [];
  for (const node of nodes) {
    if (node.type !== "BlockStatement" && node.type !== "Program") {
      continue;
    }
    for (let index = 1; index < node.body.length; index++) {
      const previous = awaitedStatement(node.body[index - 1]!);
      const statement = node.body[index]!;
      if (!previous || !startsContainer(previous) || statement.type !== "ExpressionStatement") {
        continue;
      }
      const next = awaitedStatement(statement);
      const millis = next && sleep(next);
      if (millis) {
        hits.push({ offset: statement.start, millis });
      }
    }
  }
  return hits.sort((a, b) => a.offset - b.offset);
}
