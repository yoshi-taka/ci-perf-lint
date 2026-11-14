import type { ScriptRegion } from "./source-sfc.ts";
import { sfcExpressionEnd, sfcHeaderTokens, type SfcHeaderToken } from "./source-sfc-expression.ts";
import { sfcRawEnd, sfcTag, type SfcTag } from "./source-sfc-markup.ts";

const voidTags = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);

/** Bounded extraction only. Framework compilation/preprocessors are never loaded. */
export function componentScriptRegions(source: string, svelte: boolean) {
  const regions: ScriptRegion[] = [];
  const references: { source: string; offset: number }[] = [];
  const incomplete: string[] = [];
  const stack: { name: string; block?: true; literal: boolean }[] = [];
  const scripts = new Set<string>();
  let scriptCount = 0,
    expressionCount = 0,
    template = svelte,
    sawTemplate = false;
  function note(message: string) {
    if (!incomplete.includes(message)) {
      incomplete.push(message);
    }
  }
  function add(region: ScriptRegion) {
    if (region.role === "template" ? ++expressionCount <= 129 : ++scriptCount <= 17) {
      regions.push(region);
    }
  }
  function expression(start: number, end: number, statements = false, declaration = false) {
    add({ start, end, language: "tsx", role: "template", statements, declaration });
  }
  function binding(start: number, end: number) {
    while (start < end && /\s/.test(source[start]!)) {
      start++;
    }
    while (end > start && /\s/.test(source[end - 1]!)) {
      end--;
    }
    if (start === end) {
      return;
    }
    if (source[start] === "(" && sfcExpressionEnd(source, start) === end) {
      start++;
      end--;
    }
    add({ start, end, language: "tsx", role: "template", prefix: "((", suffix: ")=>{})" });
  }
  function header(start: number, end: number): SfcHeaderToken[] | undefined {
    const tokens: SfcHeaderToken[] = [];
    for (const token of sfcHeaderTokens(source, start, end)) {
      if (token.invalid || tokens.length >= 512) {
        return undefined;
      }
      tokens.push(token);
    }
    return tokens;
  }
  function separator(tokens: SfcHeaderToken[], words: string[]) {
    return tokens
      .filter(
        (token) =>
          token.word &&
          words.includes(token.word) &&
          /\s/.test(source[token.start - 1] ?? "") &&
          (/\s/.test(source[token.end] ?? "") || source[token.end] === "}"),
      )
      .at(-1);
  }
  function syntax() {
    return {
      regions: [],
      references: [],
      incomplete: [
        svelte
          ? "Svelte syntax errors or unsupported boundaries"
          : "Vue syntax errors or unsupported boundaries",
      ],
    };
  }
  function script(tag: SfcTag, end: number) {
    const attrs = new Map(tag.attributes.map((attr) => [attr.name, attr]));
    const role = svelte
      ? attrs.has("module") || attrs.get("context")?.value === "module"
        ? "module"
        : "instance"
      : attrs.has("setup")
        ? "instance"
        : "module";
    if (scripts.has(role)) {
      return false;
    }
    scripts.add(role);
    if (
      tag.attributes.some((attr) => attr.dynamic) ||
      (svelte && attrs.has("module") && !attrs.get("module")?.boolean) ||
      (svelte && attrs.has("context") && attrs.get("context")?.value !== "module")
    ) {
      note("external or dynamic script attributes");
      return true;
    }
    const src = attrs.get("src");
    if (src && (svelte || src.value || src.boolean)) {
      if (!svelte && !src.boolean) {
        references.push({ source: src.value, offset: tag.end });
      }
      note(svelte ? "external or dynamic script attributes" : "external script source");
      return true;
    }
    const type = attrs.get("type");
    if (
      type &&
      (type.boolean ||
        (type.value &&
          !["module", "text/javascript", "application/javascript"].includes(type.value)))
    ) {
      if (!type.value.includes("json")) {
        note("unsupported script type");
      }
      return true;
    }
    const lang = attrs.get("lang");
    add({
      start: tag.end,
      end,
      language: lang?.boolean ? "unsupported" : (lang?.value ?? "js"),
      role,
    });
    return true;
  }
  function svelteExpression(start: number, end: number): boolean {
    const raw = source.slice(start, end);
    const text = raw.trim();
    const offset = start + raw.indexOf(text);
    if (text.startsWith("/")) {
      const frame = stack.pop();
      return frame?.block === true && frame.name === text.slice(1).trim();
    }
    if (text.startsWith("#")) {
      const match = /^#(if|each|await|key|snippet)\s+/.exec(text);
      if (!match || stack.length >= 256) {
        return false;
      }
      stack.push({ name: match[1]!, block: true, literal: false });
      const begin = offset + match[0].length;
      if (match[1] === "snippet") {
        add({
          start: begin,
          end,
          language: "tsx",
          role: "template",
          prefix: "function ",
          suffix: "{}",
        });
      } else if (match[1] === "each") {
        const tokens = header(begin, end);
        const split = tokens && separator(tokens, ["as"]);
        if (!split) {
          return false;
        }
        expression(begin, split.start);
        const key = tokens.at(-1);
        const keyed = key?.group === "(" && key.start > split.end;
        binding(split.end, keyed ? key.start : end);
        if (keyed) {
          expression(key.start + 1, key.end - 1);
        }
      } else if (match[1] === "await") {
        const tokens = header(begin, end);
        if (!tokens) {
          return false;
        }
        const split = separator(tokens, ["then", "catch"]);
        expression(begin, split ? split.start : end);
        if (split) {
          binding(split.end, end);
        }
      } else {
        expression(begin, end);
      }
      return true;
    }
    if (text.startsWith(":")) {
      const frame = stack.at(-1);
      if (!frame?.block) {
        return false;
      }
      const conditional = /^:else\s+if\s+/.exec(text);
      if (conditional && frame.name === "if") {
        expression(offset + conditional[0].length, end);
      } else if (/^:(?:then|catch)(?:\s|$)/.test(text)) {
        if (frame.name !== "await") {
          return false;
        }
        const prefix = /^:(?:then|catch)\s*/.exec(text)!;
        binding(offset + prefix[0].length, end);
      } else if (text !== ":else" || !["if", "each"].includes(frame.name)) {
        return false;
      }
      return true;
    }
    if (text.startsWith("@")) {
      const match = /^@(html|debug|render|const)\s+/.exec(text);
      if (!match) {
        note("unsupported Svelte template tag");
        return true;
      }
      const begin = offset + (match[1] === "const" ? 1 : match[0].length);
      expression(begin, end, false, match[1] === "const");
    } else {
      expression(start, end);
    }
    return true;
  }
  for (let index = 0; index < source.length;) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) {
        return syntax();
      }
      index = end + 3;
      continue;
    }
    const literal = stack.at(-1)?.literal === true;
    if (template && !literal && (svelte ? source[index] === "{" : source.startsWith("{{", index))) {
      sawTemplate = true;
      if (svelte && source.startsWith("{/", index)) {
        const close = /^\{\/(?:if|each|await|key|snippet)\s*\}/.exec(
          source.slice(index, index + 64),
        );
        if (!close || !svelteExpression(index + 1, index + close[0].length - 1)) {
          return syntax();
        }
        index += close[0].length;
        continue;
      }
      const open = index + (svelte ? 0 : 1);
      const prefix = svelte
        ? /^\{(?:#(?:if|each|await|key|snippet)|:else\s+if|@(?:html|debug|render|const))\s+/.exec(
            source.slice(index, index + 64),
          )
        : undefined;
      const end = sfcExpressionEnd(source, open, 0, prefix ? index + prefix[0].length : open + 1);
      if (end === undefined || (!svelte && source[end] !== "}")) {
        return syntax();
      }
      if (svelte) {
        if (!svelteExpression(index + 1, end - 1)) {
          return syntax();
        }
      } else {
        expression(index + 2, end - 1);
      }
      index = end + (svelte ? 0 : 1);
      continue;
    }
    if (source[index] !== "<" || !/^<\/?[A-Za-z]/.test(source.slice(index, index + 3))) {
      if (svelte) {
        sawTemplate = true;
      }
      index++;
      continue;
    }
    const tag = sfcTag(source, index, svelte);
    if (!tag) {
      return syntax();
    }
    index = tag.end;
    if (tag.closing) {
      const frame = stack.pop();
      if (!frame || frame.block || frame.name !== tag.name) {
        return syntax();
      }
      if (!svelte && !stack.length) {
        template = false;
      }
      continue;
    }
    if (
      !stack.length &&
      (tag.name === "script" || tag.name === "style" || (!svelte && tag.name !== "template"))
    ) {
      const end = tag.selfClosing
        ? { start: tag.end, end: tag.end }
        : sfcRawEnd(source, tag.name, tag.end);
      if (!end) {
        return syntax();
      }
      if (tag.name === "script" && !script(tag, end.start)) {
        return syntax();
      }
      index = end.end;
      continue;
    }
    if (tag.name === "script" || tag.name === "style") {
      const end = sfcRawEnd(source, tag.name, tag.end);
      if (!end) {
        return syntax();
      }
      index = end.end;
      continue;
    }
    if (!svelte && !stack.length && tag.name === "template") {
      if (sawTemplate) {
        return syntax();
      }
      sawTemplate = true;
      template = !tag.selfClosing;
      const lang = tag.attributes.find((attr) => attr.name === "lang");
      if (lang && lang.value !== "html") {
        const end = sfcRawEnd(source, tag.name, tag.end);
        if (!end) {
          return syntax();
        }
        note("template preprocessing unavailable");
        index = end.end;
        template = false;
        continue;
      }
    }
    const staticTemplate =
      literal || (!svelte && tag.attributes.some((attr) => attr.name === "v-pre"));
    if (svelte) {
      sawTemplate = true;
    }
    if (template && !staticTemplate) {
      for (const attr of tag.attributes) {
        if (svelte && !attr.name) {
          const start = attr.start + (attr.value.match(/^\s*/)?.[0].length ?? 0);
          expression(source.startsWith("...", start) ? start + 3 : start, attr.end);
        } else if (svelte && attr.dynamic) {
          for (let offset = attr.start; offset < attr.end; offset++) {
            if (source[offset] !== "{") {
              continue;
            }
            const end = sfcExpressionEnd(source, offset);
            if (end === undefined || end > attr.end) {
              return syntax();
            }
            expression(offset + 1, end - 1);
            offset = end - 1;
          }
        } else if (!svelte && /^(?:[:@#]|v-)/.test(attr.name)) {
          const bracket = attr.name.indexOf("[");
          if (bracket >= 0 && attr.nameStart !== undefined) {
            const start = attr.nameStart + bracket;
            const end = sfcExpressionEnd(source, start);
            if (end === undefined || end > attr.nameStart + attr.name.length) {
              return syntax();
            }
            expression(start + 1, end - 1);
          }
          if (!attr.boolean) {
            if (attr.name === "v-for") {
              const tokens = header(attr.start, attr.end);
              const split = tokens && separator(tokens, ["in", "of"]);
              if (!split) {
                return syntax();
              }
              binding(attr.start, split.start);
              expression(split.end, attr.end);
            } else if (/^(?:#|v-slot(?::|$))/.test(attr.name)) {
              binding(attr.start, attr.end);
            } else {
              expression(attr.start, attr.end, /^(?:@|v-on(?::|$))/.test(attr.name));
            }
          }
        }
      }
    }
    if (!tag.selfClosing && !voidTags.has(tag.name)) {
      if (stack.length >= 256) {
        return syntax();
      }
      stack.push({ name: tag.name, literal: staticTemplate });
    }
  }
  if (stack.length) {
    return syntax();
  }
  if (scriptCount > 16) {
    note("more than 16 script regions");
  }
  if (expressionCount > 128) {
    note("more than 128 template expressions");
  }
  if (sawTemplate) {
    note("template imports audited; template snapshot provenance is not inferred");
  }
  return { regions, incomplete, references };
}
