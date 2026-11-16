import { parseSync } from "oxc-parser";
import { mutateRegexPattern } from "./regex-mutator.ts";

export type MutatorName =
  | "ArithmeticOperator"
  | "ArrayDeclaration"
  | "ArrowFunction"
  | "AssignmentOperator"
  | "BlockStatement"
  | "BooleanLiteral"
  | "CallExpression"
  | "ConditionalExpression"
  | "EqualityOperator"
  | "LogicalOperator"
  | "MethodExpression"
  | "ObjectLiteral"
  | "OptionalChaining"
  | "Regex"
  | "StringLiteral"
  | "UnaryOperator"
  | "UpdateOperator";

export interface Mutant {
  file: string;
  mutator: MutatorName;
  start: number;
  end: number;
  replacement: string;
}

interface MutantSite {
  mutator: MutatorName;
  start: number;
  end: number;
  replacement: string;
  nodeStart: number;
  nodeEnd: number;
}

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const arithmeticReplacements: Record<string, string> = {
  "+": "-",
  "-": "+",
  "*": "/",
  "/": "*",
  "%": "*",
};
const assignmentReplacements: Record<string, string> = {
  "+=": "-=",
  "-=": "+=",
  "*=": "/=",
  "/=": "*=",
  "%=": "*=",
  "<<=": ">>=",
  ">>=": "<<=",
  "&=": "|=",
  "|=": "&=",
  "&&=": "||=",
  "||=": "&&=",
  "??=": "&&=",
};
const equalityReplacements: Record<string, string[]> = {
  "<": ["<=", ">="],
  "<=": ["<", ">"],
  ">": [">=", "<="],
  ">=": [">", "<"],
  "==": ["!="],
  "!=": ["=="],
  "===": ["!=="],
  "!==": ["==="],
};
const logicalReplacements: Record<string, string> = { "&&": "||", "||": "&&", "??": "&&" };
const unaryReplacements: Record<string, string> = { "+": "-", "-": "+", "~": "" };
const updateReplacements: Record<string, string> = { "++": "--", "--": "++" };
const booleanOperators = new Set(["!=", "!==", "&&", "<", "<=", "==", "===", ">", ">=", "||"]);
const stringLiteralSkipParents = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSExternalModuleReference",
  "JSXAttribute",
  "ExpressionStatement",
  "TSLiteralType",
  "TSImportEqualsDeclaration",
  "ImportExpression",
]);
const skipNodeTypes = new Set([
  "TSAsExpression",
  "TSInterfaceDeclaration",
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSDeclareFunction",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
  "ImportDeclaration",
  "Decorator",
]);
const typeOnlyKeys = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "returnType",
  "implements",
  "superTypeArguments",
]);
const methodReplacements = new Map<string, string | null>([
  ["charAt", null],
  ["endsWith", "startsWith"],
  ["every", "some"],
  ["filter", null],
  ["reverse", null],
  ["slice", null],
  ["sort", null],
  ["substr", null],
  ["substring", null],
  ["toLocaleLowerCase", "toLocaleUpperCase"],
  ["toLowerCase", "toUpperCase"],
  ["trim", null],
  ["trimEnd", "trimStart"],
  ["min", "max"],
  ["setDate", "setTime"],
  ["setFullYear", "setMonth"],
  ["setHours", "setMinutes"],
  ["setSeconds", "setMilliseconds"],
  ["setUTCDate", "setTime"],
  ["setUTCFullYear", "setUTCMonth"],
  ["setUTCHours", "setUTCMinutes"],
  ["setUTCSeconds", "setUTCMilliseconds"],
]);
for (const [key, value] of [...methodReplacements]) {
  if (value && !["getUTCDate", "setUTCDate"].includes(key)) {
    methodReplacements.set(value, key);
  }
}

export interface GenerateResult {
  mutants: Mutant[];
  regexSites: number;
  unsupportedSites: string[];
}

export function generateMutants(file: string, source: string): GenerateResult {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse ${file}: ${parsed.errors[0]?.message ?? "unknown error"}`);
  }

  const sites: MutantSite[] = [];
  const unsupportedSites: string[] = [];
  let regexSites = 0;

  const text = (node: Node): string => source.slice(node.start, node.end);

  function findToken(from: number, to: number, token: string): [number, number] {
    const index = source.indexOf(token, from);
    if (index < 0 || index + token.length > to) {
      throw new Error(`Cannot locate operator ${JSON.stringify(token)} in ${file} at ${from}`);
    }
    return [index, index + token.length];
  }

  function splice(node: Node, start: number, end: number, replacement: string): string {
    const raw = text(node);
    const offset = start - node.start;
    return raw.slice(0, offset) + replacement + raw.slice(offset + (end - start));
  }

  function addSite(
    node: Node,
    mutator: MutatorName,
    start: number,
    end: number,
    replacement: string,
  ): void {
    sites.push({
      mutator,
      start,
      end,
      replacement,
      nodeStart: node.start,
      nodeEnd: node.end,
    });
  }

  function addWholeNode(node: Node, mutator: MutatorName, replacement: string): void {
    addSite(node, mutator, node.start, node.end, replacement);
  }

  function applyEdits(node: Node, edits: [number, number, string][]): string {
    let raw = text(node);
    for (const [start, end, replacement] of [...edits].sort((a, b) => b[0] - a[0])) {
      const from = start - node.start;
      const to = end - node.start;
      raw = raw.slice(0, from) + replacement + raw.slice(to);
    }
    return raw;
  }

  function addLogicalMutation(
    node: Node,
    left: Node,
    right: Node,
    operator: string,
    replacement: string,
  ): void {
    const [opStart, opEnd] = findToken(left.end, right.start, operator);
    const edits: [number, number, string][] = [[opStart, opEnd, replacement]];
    const needsParens = (child: Node): boolean => {
      if (child.type !== "LogicalExpression") {
        return false;
      }
      const childOperator = child.operator as string;
      return replacement === "&&"
        ? childOperator === "||" || childOperator === "??"
        : childOperator === "??";
    };
    if (needsParens(left)) {
      edits.push([left.start, left.end, `(${text(left)})`]);
    }
    if (needsParens(right)) {
      edits.push([right.start, right.end, `(${text(right)})`]);
    }
    addWholeNode(node, "LogicalOperator", applyEdits(node, edits));
  }

  function addOperatorMutation(
    node: Node,
    mutator: MutatorName,
    operands: { left: Node; right: Node; operator: string; replacement: string },
  ): void {
    const [opStart, opEnd] = findToken(operands.left.end, operands.right.start, operands.operator);
    addWholeNode(node, mutator, splice(node, opStart, opEnd, operands.replacement));
  }

  function isStringLike(node: unknown): boolean {
    if (!node || typeof node !== "object") {
      return false;
    }
    const candidate = node as Node & { value?: unknown };
    return (
      candidate.type === "TemplateLiteral" ||
      (candidate.type === "Literal" && typeof candidate.value === "string")
    );
  }

  function mutate(node: Node, parent: Node | null): void {
    if (node.type === "ParenthesizedExpression") {
      // Parentheses are grouping only: Babel strips them and the parent
      // context (for example `a || (b && c)`) must stay visible.
      visit(node.expression, parent);
      return;
    }
    if (skipNodeTypes.has(node.type)) {
      return;
    }
    switch (node.type) {
      case "BinaryExpression": {
        const operator = node.operator as string;
        const left = node.left as Node;
        const right = node.right as Node;
        const arithmetic = arithmeticReplacements[operator];
        if (arithmetic) {
          const leftOperand = left.type === "BinaryExpression" ? (left.right as Node) : left;
          if (!isStringLike(right) && !isStringLike(leftOperand)) {
            addOperatorMutation(node, "ArithmeticOperator", {
              left,
              right,
              operator,
              replacement: arithmetic,
            });
          }
        }
        const equalities = equalityReplacements[operator];
        if (equalities) {
          for (const replacement of equalities) {
            addOperatorMutation(node, "EqualityOperator", {
              left,
              right,
              operator,
              replacement,
            });
          }
        }
        if (booleanOperators.has(operator)) {
          mutateBooleanExpression(node, parent);
        }
        break;
      }
      case "LogicalExpression": {
        const operator = node.operator as string;
        const replacement = logicalReplacements[operator];
        if (replacement) {
          addLogicalMutation(node, node.left as Node, node.right as Node, operator, replacement);
        }
        if (booleanOperators.has(operator)) {
          mutateBooleanExpression(node, parent);
        }
        break;
      }
      case "AssignmentExpression": {
        const operator = node.operator as string;
        const replacement = assignmentReplacements[operator];
        if (replacement && !(isStringLike(node.right) && !operator.endsWith("="))) {
          addOperatorMutation(node, "AssignmentOperator", {
            left: node.left as Node,
            right: node.right as Node,
            operator,
            replacement,
          });
        }
        break;
      }
      case "UnaryExpression": {
        const operator = node.operator as string;
        if (operator === "!" && node.prefix === true) {
          addWholeNode(node, "BooleanLiteral", text(node.argument as Node));
        }
        const replacement = unaryReplacements[operator];
        if (replacement !== undefined && node.prefix === true) {
          const [opStart, opEnd] = findToken(node.start, (node.argument as Node).start, operator);
          addWholeNode(node, "UnaryOperator", splice(node, opStart, opEnd, replacement));
        }
        break;
      }
      case "UpdateExpression": {
        const operator = node.operator as string;
        const replacement = updateReplacements[operator];
        if (replacement) {
          const argument = node.argument as Node;
          const [opStart, opEnd] =
            node.prefix === true
              ? findToken(node.start, argument.start, operator)
              : findToken(argument.end, node.end, operator);
          addWholeNode(node, "UpdateOperator", splice(node, opStart, opEnd, replacement));
        }
        break;
      }
      case "Literal": {
        const literal = node as Node & {
          raw?: string;
          regex?: { pattern: string; flags: string };
          value?: unknown;
        };
        if (literal.regex) {
          regexSites += 1;
          const { pattern, flags } = literal.regex;
          if (pattern.length > 0) {
            for (const replacement of mutateRegexPattern(pattern, flags)) {
              addWholeNode(node, "Regex", `/${replacement}/${flags}`);
            }
          }
          break;
        }
        if (typeof literal.value === "boolean") {
          addWholeNode(node, "BooleanLiteral", String(!literal.value));
        } else if (typeof literal.value === "string" && isMutableStringLiteral(node, parent)) {
          addWholeNode(
            node,
            "StringLiteral",
            literal.value.length === 0 ? '"Stryker was here!"' : '""',
          );
        }
        break;
      }
      case "TemplateLiteral": {
        const raw = text(node);
        const replacement = raw === "``" ? "`Stryker was here!`" : "``";
        addWholeNode(node, "StringLiteral", replacement);
        break;
      }
      case "ArrayExpression": {
        const elements = node.elements as unknown[];
        addWholeNode(node, "ArrayDeclaration", elements.length > 0 ? "[]" : '["Stryker was here"]');
        break;
      }
      case "ObjectExpression": {
        const properties = node.properties as unknown[];
        if (properties.length > 0) {
          addWholeNode(node, "ObjectLiteral", "{}");
        }
        break;
      }
      case "BlockStatement": {
        if ((node.body as unknown[]).length > 0) {
          addWholeNode(node, "BlockStatement", "{}");
        }
        break;
      }
      case "ArrowFunctionExpression": {
        const body = node.body as Node;
        if (
          body.type !== "BlockStatement" &&
          !(body.type === "Identifier" && body.name === "undefined")
        ) {
          addWholeNode(node, "ArrowFunction", "() => undefined");
        }
        break;
      }
      case "MemberExpression": {
        if (node.optional === true) {
          const object = node.object as Node;
          const property = node.property as Node;
          const [opStart, opEnd] = findToken(object.end, property.start, "?.");
          addWholeNode(
            node,
            "OptionalChaining",
            splice(node, opStart, opEnd, node.computed === true ? "" : "."),
          );
        }
        break;
      }
      case "CallExpression": {
        mutateCall(node, parent);
        break;
      }
      case "ExpressionStatement": {
        const expression = node.expression as Node;
        if (expression.type === "CallExpression") {
          addSite(node, "CallExpression", node.start, node.end, ";");
        }
        break;
      }
      case "NewExpression": {
        mutateArrayCall(node, parent);
        break;
      }
      case "IfStatement": {
        const test = node.test as Node;
        addSite(test, "ConditionalExpression", test.start, test.end, "true");
        addSite(test, "ConditionalExpression", test.start, test.end, "false");
        break;
      }
      case "WhileStatement":
      case "DoWhileStatement": {
        const test = node.test as Node;
        addSite(test, "ConditionalExpression", test.start, test.end, "false");
        break;
      }
      case "ForStatement": {
        const test = node.test as Node | null;
        if (test) {
          addSite(test, "ConditionalExpression", test.start, test.end, "false");
        } else {
          const headerStart = source.indexOf("(", node.start) + 1;
          const initEnd = (node.init as Node | null)?.end ?? headerStart;
          const firstSemicolon = source.indexOf(";", initEnd);
          const secondSemicolon = source.indexOf(";", firstSemicolon + 1);
          if (
            firstSemicolon < 0 ||
            secondSemicolon < 0 ||
            firstSemicolon > node.end ||
            secondSemicolon > node.end
          ) {
            unsupportedSites.push(`${file}:${node.start} for-without-test`);
            break;
          }
          addWholeNode(
            node,
            "ConditionalExpression",
            applyEdits(node, [[firstSemicolon + 1, secondSemicolon, "false"]]),
          );
        }
        break;
      }
      case "SwitchCase": {
        const consequent = node.consequent as Node[];
        if (consequent.length > 0) {
          const first = consequent[0]!;
          const last = consequent[consequent.length - 1]!;
          addWholeNode(
            node,
            "ConditionalExpression",
            applyEdits(node, [[first.start, last.end, ""]]),
          );
        }
        break;
      }
      case "ThrowStatement": {
        const argument = node.argument as Node;
        if (argument.type === "NewExpression") {
          addSite(node, "CallExpression", node.start, node.end, ";");
        }
        break;
      }
      default:
        break;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "type" || key === "start" || key === "end" || typeOnlyKeys.has(key)) {
        continue;
      }
      visit(value, node);
    }
  }

  function visit(value: unknown, parent: Node | null): void {
    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child, parent);
      }
    } else if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      mutate(value as Node, parent);
    }
  }

  function mutateBooleanExpression(node: Node, parent: Node | null): void {
    if (parent?.type === "IfStatement" && parent.test === node) {
      return;
    }
    if (
      (parent?.type === "ForStatement" ||
        parent?.type === "WhileStatement" ||
        parent?.type === "DoWhileStatement") &&
      parent.test === node
    ) {
      return;
    }
    if (parent?.type === "LogicalExpression") {
      if (parent.operator === "||") {
        addWholeNode(node, "ConditionalExpression", "false");
        return;
      }
      if (parent.operator === "&&") {
        addWholeNode(node, "ConditionalExpression", "true");
        return;
      }
    }
    addWholeNode(node, "ConditionalExpression", "true");
    addWholeNode(node, "ConditionalExpression", "false");
  }

  function mutateCall(node: Node, parent: Node | null): void {
    const callee = node.callee as Node;
    if (node.optional === true) {
      const start = callee.end;
      const args = node.arguments as Node[];
      const limit = args[0]?.start ?? node.end;
      const [opStart, opEnd] = findToken(start, limit, "?.");
      addWholeNode(node, "OptionalChaining", splice(node, opStart, opEnd, ""));
    }
    if (callee.type === "MemberExpression") {
      const property = callee.property as Node;
      if (property.type === "Identifier") {
        const name = property.name as string;
        if (methodReplacements.has(name)) {
          const replacement = methodReplacements.get(name);
          if (replacement === null) {
            addWholeNode(node, "MethodExpression", text(callee.object as Node));
          } else if (replacement) {
            addWholeNode(
              node,
              "MethodExpression",
              splice(node, property.start, property.end, replacement),
            );
          }
        }
      }
    }
    if (callee.type === "Identifier" && callee.name === "Array") {
      mutateArrayCall(node, parent);
    }
    void parent;
  }

  function mutateArrayCall(node: Node, parent: Node | null): void {
    void parent;
    const callee = node.callee as Node;
    if (callee.type !== "Identifier" || callee.name !== "Array") {
      return;
    }
    if (node.type === "CallExpression" && node.optional === true) {
      return;
    }
    const args = node.arguments as Node[];
    const argsStart = args[0]?.start;
    const argsEnd = args[args.length - 1]?.end;
    if (args.length > 0 && argsStart !== undefined && argsEnd !== undefined) {
      addSite(node, "ArrayDeclaration", argsStart, argsEnd, "");
    } else {
      const [openStart] = findToken(callee.end, node.end, "(");
      addSite(node, "ArrayDeclaration", openStart + 1, openStart + 1, "[]");
    }
  }

  function isMutableStringLiteral(node: Node, parent: Node | null): boolean {
    if (!parent) {
      return true;
    }
    if (stringLiteralSkipParents.has(parent.type)) {
      return false;
    }
    if (
      (parent.type === "Property" ||
        parent.type === "PropertyDefinition" ||
        parent.type === "MethodDefinition") &&
      parent.key === node
    ) {
      return false;
    }
    if (parent.type === "CallExpression") {
      const callee = parent.callee as Node;
      if (
        callee.type === "Identifier" &&
        ["require", "Symbol", "import"].includes(callee.name as string)
      ) {
        return false;
      }
    }
    return true;
  }

  mutate(parsed.program as unknown as Node, null);

  // Stryker's empty-expression mutator is only kept when no other mutant exists
  // inside the same node.
  const filtered = new Set<MutantSite>();
  for (const candidate of sites) {
    if (candidate.mutator !== "CallExpression") {
      continue;
    }
    const hasSibling = sites.some(
      (other) =>
        other !== candidate && other.start >= candidate.start && other.end <= candidate.end,
    );
    if (hasSibling) {
      filtered.add(candidate);
    }
  }

  const mutants = sites
    .filter((site) => !filtered.has(site))
    .map((site) => ({
      file,
      mutator: site.mutator,
      start: site.start,
      end: site.end,
      replacement: site.replacement,
    }));

  return { mutants, regexSites, unsupportedSites };
}
