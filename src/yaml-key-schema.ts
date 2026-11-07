import { Alias, Pair, Scalar, YAMLMap, YAMLSeq, isNode, type Node } from "./yaml-ast.ts";
import { scalarKeyText, type KeyScalarContext } from "./yaml-key-scalars.ts";

export interface SchemaKeyFormatting {
  schema?: string;
  tagPrefixes?: Record<string, string>;
  schemaTags?: readonly { tag: string; default?: boolean | "key"; format?: string }[];
}

const yamlPrefix = "tag:yaml.org,2002:";
const collection = (node: unknown): node is YAMLMap | YAMLSeq =>
  node instanceof YAMLMap || node instanceof YAMLSeq;

function timestampText(value: Date | null | undefined): string {
  const text = value?.toISOString();
  return text?.replace(/(?:T00:00:00)?\.000Z$/, "") ?? "";
}

// Independently derived from observable AST and serialization contracts.
export function schemaFlowKeyText(
  node: Node,
  anchors: Iterable<Node>,
  formatting: SchemaKeyFormatting = {},
): string {
  if (node instanceof Scalar) {
    return String(node.value);
  }
  const legacy = formatting.schema === "yaml-1.1";
  const available = new Set<string>();
  for (const item of anchors) {
    if (item.anchor) {
      available.add(item.anchor);
    }
  }
  const activeTag = (tag: string) =>
    formatting.schemaTags
      ? formatting.schemaTags.some((record) => record.tag === tag)
      : legacy ||
        ["str", "null", "bool", "int", "float", "map", "seq"].some(
          (name) => tag === `${yamlPrefix}${name}`,
        );
  const tagText = (tag: string): string => {
    for (const [handle, prefix] of Object.entries(formatting.tagPrefixes ?? { "!!": yamlPrefix })) {
      if (tag.startsWith(prefix)) {
        return `${handle}${tag.slice(prefix.length).replace(/[!,[\]{}]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
      }
    }
    return tag.startsWith("!") ? tag : `!<${tag}>`;
  };
  const comment = (text: string, indent: string) =>
    text.replace(
      /(^|[\n\r\u2028\u2029])([^\n\r\u2028\u2029]*)/g,
      (_, br, line) =>
        `${br}${line ? `${br ? indent : ""}${line === " " ? "#" : `#${line}`}` : ""}`,
    );
  const trailingComment = (text: string, indent: string) =>
    text.includes("\n")
      ? text === "\n"
        ? "\n"
        : `\n${indent}${comment(text, indent)}`
      : ` ${comment(text, "")}`;
  const validName = (name: string) =>
    !!name &&
    !/[\s,[\]{}]/.test(name) &&
    !Array.from(name).some((character) => character.codePointAt(0)! <= 31);

  function scalarText(n: Scalar, context: KeyScalarContext): string {
    const copy = Object.assign(new Scalar(n.value), n, { tag: undefined, mergeKey: undefined });
    const value = n.value;
    if (n.tag && activeTag(n.tag)) {
      if (n.tag === `${yamlPrefix}null`) {
        return n.source !== undefined && /^(?:~|null|Null|NULL)?$/.test(n.source)
          ? n.source
          : "null";
      }
      if (n.tag === `${yamlPrefix}bool` && typeof value !== "boolean") {
        return String(Boolean(value));
      }
      if (
        (n.tag === `${yamlPrefix}int` || n.tag === `${yamlPrefix}float`) &&
        typeof value === "string"
      ) {
        const number = Number(value);
        return Number.isFinite(number)
          ? JSON.stringify(value)
          : Number.isNaN(number)
            ? ".nan"
            : number < 0
              ? "-.inf"
              : ".inf";
      }
      if (n.tag === `${yamlPrefix}timestamp`) {
        return timestampText(value as Date | null | undefined);
      }
      if (n.tag === `${yamlPrefix}merge`) {
        return "<<";
      }
      if (["map", "seq", "set", "omap", "pairs"].some((name) => n.tag === `${yamlPrefix}${name}`)) {
        context = { ...context, skipResolution: true };
      }
    }
    if (n.mergeKey || typeof value === "symbol") {
      return (value as symbol).description ?? "";
    }
    if (value instanceof Date) {
      return timestampText(value);
    }
    if (value instanceof Uint8Array) {
      copy.value = Buffer.from(value).toString("base64");
      if (n.type === "QUOTE_DOUBLE") {
        return scalarKeyText(copy, context) ?? "";
      }
      // Keys use the pair's value indentation for binary chunk sizing.
      // Ordinary scalar folding subsequently handles the inserted spaces.
      const width = Math.max(20, 80 - context.indent.length - (context.implicitKey ? 2 : 0));
      const chunks: string[] = [];
      for (let offset = 0; offset < (copy.value as string).length; offset += width) {
        chunks.push((copy.value as string).slice(offset, offset + width));
      }
      copy.value = chunks.join(" ");
      copy.type = n.type === "QUOTE_SINGLE" ? "QUOTE_SINGLE" : "PLAIN";
      if (!copy.value) {
        return n.type === "QUOTE_SINGLE" ? "''" : "";
      }
      return scalarKeyText(copy, { ...context, skipResolution: true }) ?? "";
    }
    if (
      legacy &&
      typeof value === "boolean" &&
      n.source &&
      /^(?:y|yes|true|on|n|no|false|off)$/i.test(n.source)
    ) {
      return n.source;
    }
    if (legacy && (typeof value === "number" || typeof value === "bigint")) {
      const radix =
        n.format === "BIN" ? 2 : n.format === "OCT" ? 8 : n.format === "HEX" ? 16 : undefined;
      if (radix && (typeof value === "bigint" || Number.isInteger(value))) {
        const negative = value < 0;
        const magnitude = negative ? -value : value;
        return `${negative ? "-" : ""}${radix === 2 ? "0b" : radix === 8 ? "0" : "0x"}${magnitude.toString(radix)}`;
      }
      if (n.format === "TIME" && typeof value === "number" && Number.isFinite(value)) {
        const magnitude = Math.abs(value);
        const hours = Math.floor(magnitude / 3600);
        const minutes = Math.floor(magnitude / 60) % 60;
        const seconds = magnitude % 60;
        const secondsText = String(seconds)
          .replace(/000000\d*$/, "")
          .padStart(2, "0");
        return `${value < 0 ? "-" : ""}${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${secondsText}`;
      }
    }
    if (legacy && typeof value === "string" && !context.skipResolution) {
      const keyword =
        /^(?:~|null|Null|NULL|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|true|True|TRUE|false|False|FALSE|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/.test(
          value,
        );
      const numeric =
        /^[-+]?(?:0b[01_]+|0x[\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d+)?|\.[\d_]+(?:[eE][-+]?\d+)?|\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?)$/.test(
          value,
        );
      const timestamp =
        /^\d{4}-\d\d?-\d\d?(?:(?:[Tt]|[ \t]+)\d\d?:\d\d?:\d\d?(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d?)?))?)?$/.test(
          value,
        );
      if ((!n.type || n.type === "PLAIN") && (keyword || numeric || timestamp)) {
        copy.type = "QUOTE_DOUBLE";
      }
      context = { ...context, skipResolution: true };
    }
    return scalarKeyText(copy, context) ?? String(value);
  }

  function render(
    value: unknown,
    indent: string,
    implicitKey = false,
    start?: number,
    root = false,
  ): string {
    const n = isNode(value) ? value : new Scalar(value);
    let prefix = "";
    if (!root && n.anchor && !(n instanceof Alias)) {
      if (!validName(n.anchor)) {
        throw new Error(`Invalid anchor name: ${n.anchor}`);
      }
      available.add(n.anchor);
      prefix = `&${n.anchor} `;
    }
    if (!root && n.tag) {
      prefix += `${tagText(n.tag)} `;
    }
    if (n instanceof Alias) {
      if (!available.has(n.source)) {
        throw new Error(`Unresolved alias (the anchor must be set before the alias): ${n.source}`);
      }
      return `*${n.source}${implicitKey ? " " : ""}`;
    }
    if (n instanceof Scalar) {
      const context: KeyScalarContext = {
        indent,
        implicitKey,
        indentAtStart: prefix ? (start ?? 0) + prefix.length : start,
      };
      return `${prefix}${scalarText(n, context)}`;
    }
    if (!root && n.tag && activeTag(n.tag)) {
      const name = n.tag.slice(yamlPrefix.length);
      const malformed: Record<string, string> = {
        str: "undefined",
        bool: "false",
        null: "null",
        int: ".nan",
        float: ".nan",
        timestamp: "",
        binary: "",
        merge: "<<",
      };
      if (n.tag.startsWith(yamlPrefix) && name in malformed) {
        return `${prefix.trimEnd()}\n${indent}${malformed[name]}`;
      }
    }
    if (
      n instanceof YAMLMap &&
      n.collectionType === "set" &&
      n.items.some(
        (item) =>
          item.value !== null &&
          item.value !== undefined &&
          !(
            item.value instanceof Scalar &&
            item.value.value === null &&
            !item.value.commentBefore &&
            !item.value.comment &&
            !item.value.tag
          ),
      )
    ) {
      throw new Error("Set items must all have null values");
    }
    const open = n instanceof YAMLMap ? "{" : "[";
    const close = n instanceof YAMLMap ? "}" : "]";
    if (!n.items.length) {
      return `${prefix}${open}${close}`;
    }
    const entryIndent = `${indent}  `;
    let inheritedStart = prefix ? (start ?? 0) + prefix.length : start;
    const allNull =
      n instanceof YAMLMap &&
      (n.collectionType === "set" ||
        n.items.every((item) => item.value === null || item.value === undefined));
    const entries: {
      text: string;
      before?: string | null;
      blank?: boolean;
      after?: string | null;
    }[] = [];
    for (const item of n.items) {
      if (item instanceof Pair) {
        const pairIndent = n instanceof YAMLSeq ? `${entryIndent}  ` : entryIndent;
        const key = item.key;
        const val = allNull ? null : item.value;
        const kn = isNode(key) ? key : undefined;
        const vn = isNode(val) ? val : undefined;
        const explicit =
          collection(key) ||
          (n instanceof YAMLMap && n.collectionType === "set" && kn instanceof Alias) ||
          (kn instanceof Scalar && (kn.type === "BLOCK_LITERAL" || kn.type === "BLOCK_FOLDED"));
        let text = render(
          key,
          `${pairIndent}${explicit || allNull ? "  " : ""}`,
          !explicit && !allNull,
        );
        if (explicit) {
          text = `? ${text}`;
        }
        if (val !== null && val !== undefined) {
          const vi = `${pairIndent}  `;
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
            text += `\n${pairIndent}:`;
          } else {
            text += ":";
          }
          if (!explicit && kn?.comment) {
            text += trailingComment(kn.comment, vi);
          }
          const scalarTag =
            collection(val) &&
            val.tag &&
            activeTag(val.tag) &&
            ["str", "bool", "null", "int", "float", "timestamp", "binary", "merge"].some(
              (name) => val.tag === `${yamlPrefix}${name}`,
            );
          if (
            kn?.comment ||
            vn?.commentBefore ||
            vn?.spaceBefore ||
            (!explicit && collection(val) && !scalarTag && valueText.includes("\n"))
          ) {
            text += "\n";
            if (vn?.spaceBefore) {
              text += "\n";
            }
            if (vn?.commentBefore) {
              text += vn.commentBefore === "\n" ? "\n" : `${vi}${comment(vn.commentBefore, vi)}\n`;
            }
            text += `${vi}${valueText}`;
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
        if (child && !(child instanceof Alias)) {
          const properties = `${child.anchor ? `&${child.anchor} ` : ""}${child.tag ? `${tagText(child.tag)} ` : ""}`;
          if (properties) {
            inheritedStart = (inheritedStart ?? 0) + properties.length;
          }
        }
      }
    }
    const inline = `${prefix}${open} ${entries.map((entry) => entry.text).join(", ")} ${close}`;
    const multiline =
      entries.some(
        (entry) => entry.text.includes("\n") || !!entry.before || !!entry.after || entry.blank,
      ) || inline.length - prefix.length + entries.length - 1 > 80;
    if (!multiline) {
      return inline;
    }
    let result = `${prefix}${open}`;
    entries.forEach((entry, index) => {
      result += "\n";
      if (entry.blank) {
        result += "\n";
      }
      if (entry.before) {
        result += entry.before === "\n" ? "\n" : `${entryIndent}${comment(entry.before, indent)}\n`;
      }
      result += `${entryIndent}${entry.text}`;
      if (index < entries.length - 1) {
        result += ",";
      }
      if (entry.after) {
        result += trailingComment(
          entry.after,
          n instanceof YAMLMap ? entryIndent : `${entryIndent}  `,
        );
      }
    });
    return `${result}\n${indent}${close}`;
  }
  return render(node, "", false, undefined, true);
}
