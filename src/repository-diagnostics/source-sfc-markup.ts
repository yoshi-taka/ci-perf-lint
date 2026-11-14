import { sfcExpressionEnd, type SfcJsxEnd } from "./source-sfc-expression.ts";

export interface SfcAttribute {
  name: string;
  start: number;
  end: number;
  value: string;
  dynamic: boolean;
  boolean?: true;
  nameStart?: number;
}
export interface SfcTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
  attributes: SfcAttribute[];
}

/** Small static tag reader, not an HTML/framework compiler. Offsets stay UTF-16. */
export function sfcTag(
  source: string,
  start: number,
  svelte: boolean,
  jsx?: SfcJsxEnd,
  quotedExpressions = true,
): SfcTag | undefined {
  const header = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(source.slice(start, start + 256));
  if (!header || header[0].length === 256) {
    return undefined;
  }
  let index = start + header[0].length;
  const attributes: SfcAttribute[] = [];
  const names = new Set<string>();
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "") && index < source.length) {
      index++;
    }
    if (source[index] === ">" || source.startsWith("/>", index)) {
      return {
        name: header[2]!,
        closing: header[1] === "/",
        selfClosing: source[index] === "/",
        end: index + (source[index] === "/" ? 2 : 1),
        attributes,
      };
    }
    if (attributes.length >= 256) {
      return undefined;
    }
    if (header[1]) {
      return undefined;
    }
    if (svelte && source[index] === "{") {
      const end = sfcExpressionEnd(source, index, 0, index + 1, jsx);
      if (end === undefined) {
        return undefined;
      }
      attributes.push({
        name: "",
        start: index + 1,
        end: end - 1,
        value: source.slice(index + 1, end - 1),
        dynamic: true,
      });
      index = end;
      continue;
    }
    const begin = index;
    while (index < source.length && !/[\s=/>]/.test(source[index]!)) {
      if (source[index] === "[") {
        const end = sfcExpressionEnd(source, index, 0, index + 1, jsx);
        if (end === undefined) {
          return undefined;
        }
        index = end;
      } else {
        if (/["'`<]/.test(source[index]!)) {
          return undefined;
        }
        index++;
      }
    }
    const name = source.slice(begin, index);
    if (!name || names.has(name)) {
      return undefined;
    }
    names.add(name);
    while (/\s/.test(source[index] ?? "") && index < source.length) {
      index++;
    }
    if (source[index] !== "=") {
      attributes.push({
        name,
        nameStart: begin,
        start: index,
        end: index,
        value: "",
        dynamic: false,
        boolean: true,
      });
      continue;
    }
    index++;
    while (/\s/.test(source[index] ?? "") && index < source.length) {
      index++;
    }
    const quote = source[index] === '"' || source[index] === "'" ? source[index++] : undefined;
    const valueStart = index;
    let dynamic = false;
    while (index < source.length) {
      if (quote ? source[index] === quote : /[\s>]/.test(source[index]!)) {
        break;
      }
      if (svelte && source[index] === "{" && (!quote || quotedExpressions)) {
        const end = sfcExpressionEnd(source, index, 0, index + 1, jsx);
        if (end === undefined) {
          return undefined;
        }
        dynamic = true;
        index = end;
      } else {
        if (!quote && /["'`<=]/.test(source[index]!)) {
          return undefined;
        }
        index++;
      }
    }
    if (index >= source.length || (!quote && valueStart === index)) {
      return undefined;
    }
    attributes.push({
      name,
      nameStart: begin,
      start: valueStart,
      end: index,
      value: source.slice(valueStart, index),
      dynamic,
    });
    if (quote) {
      index++;
    }
    if (attributes.length > 256) {
      return undefined;
    }
  }
  return undefined;
}

export function sfcRawEnd(source: string, name: string, start: number) {
  const pattern = new RegExp(`</${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`, "gi");
  pattern.lastIndex = start;
  const match = pattern.exec(source);
  return match ? { start: match.index, end: pattern.lastIndex } : undefined;
}
