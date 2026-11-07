import { Alias, Scalar, type Node } from "./yaml-ast.ts";
import { coreFlowKeyText } from "./yaml-key-flow.ts";
import { schemaFlowKeyText, type SchemaKeyFormatting } from "./yaml-key-schema.ts";

export type KeyFormatting = SchemaKeyFormatting;

function invalidAnchor(value: string): boolean {
  if (/[\s,[\]{}]/.test(value)) {
    return true;
  }
  for (const char of value) {
    if (char.codePointAt(0)! <= 25) {
      return true;
    }
  }
  return false;
}

export function formatComplexKey(
  node: Node,
  anchors: Iterable<Node>,
  formatting: KeyFormatting = {},
): string {
  // Root toString() omits its own anchor/tag. Aliases never expand here.
  if (node instanceof Alias && !invalidAnchor(node.source)) {
    return `*${node.source}`;
  }
  if (node instanceof Scalar && (node.value instanceof Date || node.value instanceof Uint8Array)) {
    return node.value.toString();
  }
  const knownAnchors = [...anchors];
  const text =
    !formatting.schema || formatting.schema === "core"
      ? coreFlowKeyText(node, knownAnchors)
      : undefined;
  if (text !== undefined) {
    return text;
  }
  return schemaFlowKeyText(node, knownAnchors, formatting);
}
