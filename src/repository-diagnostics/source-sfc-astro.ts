import type { ScriptRegion } from "./source-sfc.ts";
import { sfcExpressionEnd, sfcHeaderTokens } from "./source-sfc-expression.ts";
import { sfcRawEnd, sfcTag, type SfcTag } from "./source-sfc-markup.ts";

const voidTags = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);

/** Native UTF-16 spans; no Astro compiler or project code is loaded. */
export function astroScriptRegions(source: string) {
  const regions: ScriptRegion[] = [];
  const references: { source: string; offset: number }[] = [];
  const incomplete: string[] = [];
  let metadata = 0,
    attributes = 0;
  const jsxSpans: { start: number; end: number }[] = [];
  const jsxCache = new Map<number, number>();
  function note(message: string) {
    if (!incomplete.includes(message)) {
      incomplete.push(message);
    }
  }
  function syntax() {
    return {
      regions: [],
      references: [],
      incomplete: [...incomplete, "Astro syntax errors or unsupported boundaries"],
    };
  }
  function add(region: ScriptRegion, attribute = false) {
    if (attribute) {
      if (++attributes > 128) {
        note("attribute expression budget exhausted");
        return;
      }
    } else if (++metadata > 145) {
      note("script/expression metadata budget exhausted");
      return;
    }
    regions.push(region);
  }
  function tagAt(start: number, depth = 0): SfcTag | undefined {
    if (source.startsWith("<>", start)) {
      return { name: "", closing: false, selfClosing: false, end: start + 2, attributes: [] };
    }
    if (source.startsWith("</>", start)) {
      return { name: "", closing: true, selfClosing: false, end: start + 3, attributes: [] };
    }
    return sfcTag(
      source,
      start,
      true,
      (offset, childDepth) => jsxEnd(offset, depth + childDepth),
      false,
    );
  }
  function jsxEnd(start: number, depth: number): number | undefined {
    if (depth >= 64) {
      return undefined;
    }
    const cached = jsxCache.get(start);
    if (cached !== undefined) {
      return cached;
    }
    if (jsxSpans.length >= 512) {
      note("JSX metadata budget exhausted");
      return undefined;
    }
    function finish(end: number) {
      jsxSpans.push({ start, end });
      jsxCache.set(start, end);
      return end;
    }
    const stack: string[] = [];
    for (let index = start; index < source.length;) {
      if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index + 4);
        if (end < 0) {
          return undefined;
        }
        index = end + 3;
      } else if (source[index] === "{") {
        const end = sfcExpressionEnd(source, index, depth + 1, index + 1, jsxEnd);
        if (end === undefined) {
          return undefined;
        }
        expression(index + 1, end - 1);
        index = end;
      } else if (
        source[index] === "<" &&
        /^<(?:\/?[A-Za-z]|\/?>)/.test(source.slice(index, index + 3))
      ) {
        const tag = tagAt(index, depth);
        if (!tag) {
          return undefined;
        }
        if (tag.closing) {
          if (stack.pop() !== tag.name) {
            return undefined;
          }
        } else if (!tag.selfClosing && !voidTags.has(tag.name)) {
          if (stack.length >= 256) {
            return undefined;
          }
          stack.push(tag.name);
        }
        if (!tag.closing && !attributeExpressions(tag)) {
          return undefined;
        }
        index = tag.end;
        if (!stack.length) {
          return finish(index);
        }
      } else {
        index++;
      }
    }
    return undefined;
  }
  function expression(start: number, end: number, attribute = false) {
    if (
      /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$))*$/.test(
        source.slice(start, end),
      )
    ) {
      return;
    }
    add({ start, end, language: "tsx", role: "template" }, attribute);
    note("template imports audited; template snapshot provenance is not inferred");
  }
  function attributeExpressions(tag: SfcTag) {
    for (const attr of tag.attributes) {
      if (!attr.dynamic) {
        continue;
      }
      if (!attr.name) {
        const start = attr.start + (attr.value.match(/^\s*/)?.[0].length ?? 0);
        expression(source.startsWith("...", start) ? start + 3 : start, attr.end, true);
      } else {
        for (let index = attr.start; index < attr.end; index++) {
          if (source[index] !== "{") {
            continue;
          }
          const end = sfcExpressionEnd(source, index, 0, index + 1, jsxEnd);
          if (end === undefined || end > attr.end) {
            return false;
          }
          expression(index + 1, end - 1, true);
          index = end - 1;
        }
      }
    }
    return true;
  }
  function script(tag: SfcTag, end: number) {
    const attrs = new Map(tag.attributes.map((attr) => [attr.name, attr]));
    const src = attrs.get("src");
    if (src?.value && !src.dynamic && !src.boolean) {
      if (references.length < 128) {
        references.push({ source: src.value, offset: src.nameStart ?? src.start });
      } else {
        note("external reference budget exhausted");
      }
    }
    if (attrs.has("src") || tag.attributes.some((attr) => attr.dynamic)) {
      note("external or dynamic script attributes");
      return;
    }
    const type = attrs.get("type")?.value;
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) {
      if (!type.includes("json")) {
        note("unsupported script type");
      }
      return;
    }
    const language = attrs.get("lang")?.value;
    if (language && !["js", "javascript", "ts", "typescript", "jsx", "tsx"].includes(language)) {
      note("unsupported script language");
      return;
    }
    add({ start: tag.end, end, language: language ?? (attrs.size ? "js" : "ts") });
  }
  function fenceEnd(start: number): number | undefined {
    if (!source.startsWith("---", start)) {
      return undefined;
    }
    let before = start - 1;
    while (before >= 0 && /[ \t]/.test(source[before]!)) {
      before--;
    }
    if (before >= 0 && !/[\r\n]/.test(source[before]!)) {
      return undefined;
    }
    let end = start + 3;
    while (/[ \t]/.test(source[end] ?? "")) {
      end++;
    }
    return end === source.length || /[\r\n]/.test(source[end]!) ? end : undefined;
  }
  let index = 0;
  const opening = /^\uFEFF?\s*---(?=\r?\n|$)/.exec(source);
  if (opening) {
    const start = opening[0].lastIndexOf("---") + 3;
    let close: { start: number; end: number } | undefined;
    for (const token of sfcHeaderTokens(source, start, source.length)) {
      if (token.invalid) {
        return syntax();
      }
      const end = fenceEnd(token.start);
      if (end !== undefined) {
        close = { start: token.start, end };
        break;
      }
    }
    if (!close) {
      return syntax();
    }
    add({ start, end: close.start, language: "ts" });
    index = close.end;
  }
  const stack: string[] = [];
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) {
        return syntax();
      }
      index = end + 3;
      continue;
    }
    if (source[index] === "{") {
      const end = sfcExpressionEnd(source, index, 0, index + 1, jsxEnd);
      if (end === undefined) {
        return syntax();
      }
      expression(index + 1, end - 1);
      index = end;
      continue;
    }
    if (source[index] !== "<" || !/^<(?:\/?[A-Za-z]|\/?>)/.test(source.slice(index, index + 3))) {
      index++;
      continue;
    }
    const tag = tagAt(index);
    if (!tag) {
      return syntax();
    }
    index = tag.end;
    if (tag.closing) {
      if (stack.pop() !== tag.name) {
        return syntax();
      }
      continue;
    }
    if (!attributeExpressions(tag)) {
      return syntax();
    }
    if (tag.name === "script" || tag.name === "style") {
      const end = tag.selfClosing
        ? { start: tag.end, end: tag.end }
        : sfcRawEnd(source, tag.name, tag.end);
      if (!end) {
        return syntax();
      }
      if (tag.name === "script") {
        script(tag, end.start);
      }
      index = end.end;
    } else if (!tag.selfClosing && !voidTags.has(tag.name)) {
      if (stack.length >= 256) {
        return syntax();
      }
      stack.push(tag.name);
    }
  }
  if (stack.length) {
    return syntax();
  }
  jsxSpans.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const region of regions) {
    if (region.role !== "template") {
      continue;
    }
    const omit: { start: number; end: number }[] = [];
    for (const span of jsxSpans) {
      if (
        span.start >= region.start &&
        span.end <= region.end &&
        span.start >= (omit.at(-1)?.end ?? 0)
      ) {
        omit.push(span);
      }
    }
    if (omit.length) {
      region.omit = omit;
    }
  }
  return { regions, incomplete, references };
}
