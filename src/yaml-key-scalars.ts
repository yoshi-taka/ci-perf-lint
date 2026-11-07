import type { Scalar } from "./yaml-ast.ts";
import { foldKeyLines } from "./yaml-key-folding.ts";

export interface KeyScalarContext {
  indent: string;
  implicitKey?: boolean;
  indentAtStart?: number;
  skipResolution?: boolean;
}

function fold(text: string, context: KeyScalarContext, quoted: boolean): string {
  return context.implicitKey
    ? text
    : foldKeyLines(text, context.indent, quoted, {
        indentAtStart: context.indentAtStart,
      });
}

function doubleQuote(value: string, context: KeyScalarContext): string {
  const multiline = !context.implicitKey && JSON.stringify(value).length >= 40;
  let text = '"';
  const escapes: Record<string, string> = {
    "\0": "\\0",
    "\x07": "\\a",
    "\b": "\\b",
    "\t": "\\t",
    "\v": "\\v",
    "\f": "\\f",
    "\r": "\\r",
    "\x1b": "\\e",
    '"': '\\"',
    "\\": "\\\\",
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const code = value.charCodeAt(i);
    if (ch === "\n") {
      let end = i;
      while (value[end + 1] === "\n") {
        end++;
      }
      const count = end - i + 1;
      if (!multiline) {
        text += "\\n".repeat(count);
      } else if (end === value.length - 1) {
        text += count > 1 ? `${"\n".repeat(count)}${context.indent}\\n` : "\\n";
      } else {
        text += "\n".repeat(count + 1) + context.indent;
      }
      i = end;
    } else if (
      ch === " " &&
      (value[i + 1] === "\n" || (multiline && i > 0 && value[i - 1] === "\n"))
    ) {
      text += multiline && value[i - 1] === "\n" && value[i + 1] === "\n" ? "\\\\ " : "\\ ";
    } else if (escapes[ch]) {
      text += escapes[ch];
    } else if (code < 32 || (code >= 127 && code <= 159 && code !== 133)) {
      text += `\\x${code.toString(16).padStart(2, "0")}`;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      text += ch + value[++i];
    } else if (code >= 0xd800 && code <= 0xdfff) {
      text += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      text += ch;
    }
  }
  return fold(`${text}"`, context, true);
}

function singleQuote(value: string, context: KeyScalarContext): string {
  if ((context.implicitKey && value.includes("\n")) || /[ \t]\n|\n[ \t]/.test(value)) {
    return doubleQuote(value, context);
  }
  const text = `'${value.replace(/'/g, "''").replace(/\n+/g, (run) => `${run}\n${context.indent}`)}'`;
  return fold(text, context, false);
}

function stringText(value: string, node: Scalar, context: KeyScalarContext): string {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code <= 8 ||
      (code >= 11 && code <= 31) ||
      (code >= 127 && code <= 159) ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return doubleQuote(value, context);
    }
  }
  if (node.type === "QUOTE_DOUBLE") {
    return doubleQuote(value, context);
  }
  if (node.type === "QUOTE_SINGLE") {
    return singleQuote(value, context);
  }
  const plain = node.type === undefined || node.type === "PLAIN";
  const unsafe =
    !value ||
    /^[ \t\r\n\x85]|[ \t\r\n\x85]$/.test(value) ||
    /^[!&*{}[\],#|>@`"'%]/.test(value) ||
    /^[-?:](?:[ \t\r\n]|$)/.test(value) ||
    /[[\]{},]|:(?:[ \t\r\n]|$)|[ \t\r\n]#|[ \t]\n|\n[ \t]/.test(value) ||
    (!!context.implicitKey && value.includes("\n"));
  const resolved =
    /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:\.inf|\.Inf|\.INF)|\.nan|\.NaN|\.NAN|0o[0-7]+|0x[\da-fA-F]+|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/.test(
      value,
    );
  if (plain && !unsafe && (!resolved || context.skipResolution)) {
    return fold(
      value.replace(/\n+/g, (run) => `${run}\n${context.indent}`),
      context,
      false,
    );
  }
  return value.includes('"') && !value.includes("'")
    ? singleQuote(value, context)
    : doubleQuote(value, context);
}

export function scalarKeyText(node: Scalar, context: KeyScalarContext): string | undefined {
  if (node.tag || node.mergeKey) {
    return undefined;
  }
  const value = node.value;
  if (value == null) {
    return node.source !== undefined && /^(?:~|null|Null|NULL)?$/.test(node.source)
      ? node.source
      : "null";
  }
  if (typeof value === "boolean") {
    return node.source &&
      (value ? /^(?:true|True|TRUE)$/ : /^(?:false|False|FALSE)$/).test(node.source)
      ? node.source
      : String(value);
  }
  if (typeof value === "string") {
    return stringText(value, node, context);
  }
  if (typeof value !== "number" && typeof value !== "bigint") {
    return undefined;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return Number.isNaN(value) ? ".nan" : value < 0 ? "-.inf" : ".inf";
  }
  const integer = typeof value === "bigint" || Number.isInteger(value);
  if (integer && value >= 0 && (node.format === "HEX" || node.format === "OCT")) {
    return (node.format === "HEX" ? "0x" : "0o") + value.toString(node.format === "HEX" ? 16 : 8);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (node.format === "EXP") {
    return value.toExponential();
  }
  let text = Object.is(value, -0) ? "-0" : String(value);
  if (!node.format && node.minFractionDigits && !/[eE]/.test(text)) {
    const digits = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
    if (digits < node.minFractionDigits) {
      text += (digits === 0 ? "." : "") + "0".repeat(node.minFractionDigits - digits);
    }
  }
  return text;
}
