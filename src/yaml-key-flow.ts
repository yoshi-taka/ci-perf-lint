import { Alias, Pair, Scalar, YAMLMap, YAMLSeq, isNode, type Node } from "./yaml-ast.ts";
import { scalarKeyText, type KeyScalarContext } from "./yaml-key-scalars.ts";

// Independently derived from the supplied observable serialization contracts.
export function coreFlowKeyText(node: Node, anchors: Iterable<Node>): string | undefined {
  const available = new Set<string>();
  for (const item of anchors) {
    if (item.anchor) {
      available.add(item.anchor);
    }
  }
  const invalid = Symbol();
  const comment = (text: string, indent: string) =>
    text.replace(
      /(^|[\n\r\u2028\u2029])([^\n\r\u2028\u2029]*)/g,
      (_, br, line) => br + (line ? (br ? indent : "") + (line === " " ? "#" : `#${line}`) : ""),
    );
  const trailingComment = (text: string, indent: string) =>
    text.includes("\n")
      ? text === "\n"
        ? "\n"
        : `\n${indent}${comment(text, indent)}`
      : ` ${comment(text, "")}`;
  const collection = (n: unknown): n is YAMLMap | YAMLSeq =>
    n instanceof YAMLMap || n instanceof YAMLSeq;
  const validName = (name: string) =>
    !!name &&
    !/[\s,[\]{}]/.test(name) &&
    !Array.from(name).some((character) => character.codePointAt(0)! <= 31);

  function render(
    value: unknown,
    indent: string,
    implicitKey = false,
    start?: number,
    root = false,
  ): string {
    const n = isNode(value) ? value : new Scalar(value);
    if ((n.tag && !root) || (collection(n) && n.collectionType)) {
      throw invalid;
    }
    let prefix = "";
    if (!root && n.anchor && !(n instanceof Alias)) {
      if (!validName(n.anchor)) {
        throw invalid;
      }
      available.add(n.anchor);
      prefix = `&${n.anchor} `;
    }
    if (n instanceof Alias) {
      if (!validName(n.source) || !available.has(n.source)) {
        throw invalid;
      }
      return `*${n.source}${implicitKey ? " " : ""}`;
    }
    if (n instanceof Scalar) {
      const context: KeyScalarContext = {
        indent,
        implicitKey,
        indentAtStart: start === undefined ? undefined : start + prefix.length,
      };
      const text = scalarKeyText(n, context);
      if (text === undefined) {
        throw invalid;
      }
      return prefix + text;
    }
    const open = n instanceof YAMLMap ? "{" : "[";
    const close = n instanceof YAMLMap ? "}" : "]";
    if (!n.items.length) {
      return prefix + open + close;
    }
    const entryIndent = `${indent}  `;
    const inheritedStart = prefix ? (start ?? 0) + prefix.length : start;
    const allNull =
      n instanceof YAMLMap &&
      n.items.every((item) => item.value === null || item.value === undefined);
    let multiline = false;
    const entries: {
      text: string;
      before?: string | null;
      blank?: boolean;
      after?: string | null;
    }[] = [];
    for (const item of n.items) {
      if (n instanceof YAMLMap) {
        if (!(item instanceof Pair)) {
          throw invalid;
        }
        const key = item.key;
        const val = item.value;
        const kn = isNode(key) ? key : undefined;
        const vn = isNode(val) ? val : undefined;
        const explicit =
          collection(key) ||
          (kn instanceof Scalar && (kn.type === "BLOCK_LITERAL" || kn.type === "BLOCK_FOLDED"));
        let text = render(
          key,
          entryIndent + (explicit || allNull ? "  " : ""),
          !explicit && !allNull,
        );
        if (explicit) {
          text = `? ${text}`;
        }
        if (val !== null && val !== undefined) {
          const vi = `${entryIndent}  `;
          const valueText = render(
            val,
            vi,
            false,
            collection(val)
              ? inheritedStart
              : kn?.comment
                ? undefined
                : explicit
                  ? 2
                  : text.length + 2,
          );
          if (explicit) {
            if (kn?.comment) {
              text += trailingComment(kn.comment, vi);
            }
            text += `\n${entryIndent}:`;
          } else {
            text += ":";
          }
          if (!explicit && kn?.comment) {
            text += trailingComment(kn.comment, vi);
          }
          if (
            kn?.comment ||
            vn?.commentBefore ||
            vn?.spaceBefore ||
            (!explicit && collection(val) && valueText.includes("\n"))
          ) {
            text += "\n";
            if (vn?.spaceBefore) {
              text += "\n";
            }
            if (vn?.commentBefore) {
              text += vn.commentBefore === "\n" ? "\n" : `${vi}${comment(vn.commentBefore, vi)}\n`;
            }
            text += vi + valueText;
          } else {
            text += valueText.startsWith("\n") ? valueText : ` ${valueText}`;
          }
        }
        entries.push({
          text,
          before: kn?.commentBefore,
          blank: kn?.spaceBefore,
          after: val === null || val === undefined ? kn?.comment : vn?.comment,
        });
      } else {
        const child = isNode(item) ? item : undefined;
        entries.push({
          text: render(item, `${entryIndent}  `, false, inheritedStart),
          before: child?.commentBefore,
          blank: child?.spaceBefore,
          after: child?.comment,
        });
      }
    }
    const inline = `${prefix + open} ${entries.map((e) => e.text).join(", ")} ${close}`;
    multiline ||=
      entries.some((e) => e.text.includes("\n") || !!e.before || !!e.after || e.blank) ||
      inline.length - prefix.length + entries.length - 1 > 80;
    if (!multiline) {
      return inline;
    }
    let result = prefix + open;
    entries.forEach((e, i) => {
      result += "\n";
      if (e.blank) {
        result += "\n";
      }
      if (e.before) {
        result += e.before === "\n" ? "\n" : `${entryIndent}${comment(e.before, indent)}\n`;
      }
      result += entryIndent + e.text;
      if (i < entries.length - 1) {
        result += ",";
      }
      if (e.after) {
        result += trailingComment(e.after, n instanceof YAMLMap ? entryIndent : `${entryIndent}  `);
      }
    });
    return `${result}\n${indent}${close}`;
  }
  try {
    return render(node, "", false, undefined, true);
  } catch {
    return undefined;
  }
}
