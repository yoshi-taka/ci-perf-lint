import type { Node } from "@astrojs/compiler/types";
import type { ScriptRegion } from "./source-sfc.ts";

/** Astro AST spans are UTF-8 bytes; Oxc and diagnostics need UTF-16 code units. */
export async function astroScriptRegions(source: string): Promise<{
  regions: ScriptRegion[];
  incomplete: string[];
  references?: { source: string; offset: number }[];
}> {
  const { parse } = await import("@astrojs/compiler");
  const parsed = await parse(source, { position: true });
  const incomplete: string[] = [];
  if (parsed.diagnostics.some((issue) => issue.severity === 1)) {
    return { regions: [], incomplete: ["Astro syntax errors"] };
  }
  const scripts: {
    start: number;
    end: number;
    language: string;
    content?: string;
    template?: boolean;
    tail?: string;
  }[] = [];
  const wanted = new Set<number>();
  const external: { source: string; byte: number }[] = [];
  const attributes: { byte: number; value: string }[] = [];
  function warnOnce(note: string) {
    if (!incomplete.includes(note)) {
      incomplete.push(note);
    }
  }
  function walk(node: Node, insideExpression = false) {
    if (scripts.length >= 145) {
      warnOnce("script/expression metadata budget exhausted");
      return;
    }
    if ("attributes" in node) {
      for (const attribute of node.attributes) {
        if (attribute.kind === "expression" && attribute.position) {
          if (attributes.length < 128) {
            wanted.add(attribute.position.start.offset);
            attributes.push({ byte: attribute.position.start.offset, value: attribute.value });
          } else {
            warnOnce("attribute expression budget exhausted");
          }
        }
      }
    }
    if (node.type === "frontmatter" && node.position?.end) {
      wanted.add(node.position.start.offset);
      scripts.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        language: "ts",
        content: node.value,
      });
    } else if (node.type === "element" && node.name === "script") {
      const attrs = new Map(node.attributes.map((attribute) => [attribute.name, attribute]));
      const src = attrs.get("src");
      if (src?.value && ["quoted", "empty"].includes(src.kind) && src.position) {
        if (external.length < 128) {
          wanted.add(src.position.start.offset);
          external.push({ source: src.value, byte: src.position.start.offset });
        } else if (!incomplete.includes("external reference budget exhausted")) {
          incomplete.push("external reference budget exhausted");
        }
      }
      if (
        attrs.has("src") ||
        node.attributes.some((attribute) =>
          ["expression", "spread", "shorthand", "template-literal"].includes(attribute.kind),
        )
      ) {
        incomplete.push("external or dynamic script attributes");
        return;
      }
      const type = attrs.get("type")?.value;
      if (type && !["module", "text/javascript", "application/javascript"].includes(type)) {
        if (!type.includes("json")) {
          incomplete.push("unsupported script type");
        }
        return;
      }
      const language = attrs.get("lang")?.value;
      if (attrs.size && language && !["js", "javascript"].includes(language)) {
        incomplete.push("inline script language preprocessing unavailable");
        return;
      }
      for (const child of node.children) {
        if (child.type !== "text" || !child.position?.end) {
          incomplete.push("unsupported script child");
          continue;
        }
        wanted.add(child.position.start.offset);
        wanted.add(child.position.end.offset);
        scripts.push({
          start: child.position.start.offset,
          end: child.position.end.offset,
          language: language ?? (attrs.size ? "js" : "ts"),
        });
      }
      return;
    } else if (node.type === "expression" && !insideExpression) {
      const first = node.children[0]?.position?.start;
      const lastNode = node.children.at(-1);
      const last = lastNode?.type === "text" ? lastNode.position?.start : lastNode?.position?.end;
      if (first && last) {
        wanted.add(first.offset);
        wanted.add(last.offset);
        scripts.push({
          start: first.offset,
          end: last.offset,
          language: "tsx",
          template: true,
          tail: lastNode?.type === "text" ? lastNode.value : undefined,
        });
      } else {
        incomplete.push("unknown Astro expression child spans");
      }
      incomplete.push("template imports audited; template snapshot provenance is not inferred");
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child, insideExpression || node.type === "expression");
      }
    }
  }
  walk(parsed.ast);
  const offsets = new Map<number, number>();
  let bytes = 0;
  let utf16 = 0;
  for (const character of source) {
    if (wanted.has(bytes)) {
      offsets.set(bytes, utf16);
    }
    bytes += Buffer.byteLength(character);
    utf16 += character.length;
  }
  offsets.set(bytes, utf16);
  const regions: ScriptRegion[] = [];
  for (const attribute of attributes) {
    const offset = offsets.get(attribute.byte);
    const open = offset === undefined ? -1 : source.indexOf("{", offset);
    const start = open + 1;
    const end = start + attribute.value.length;
    if (open < 0 || source.slice(start, end) !== attribute.value || source[end] !== "}") {
      incomplete.push("unknown Astro attribute expression span");
      continue;
    }
    regions.push({ start, end, language: "tsx", role: "template" });
  }
  for (const script of scripts) {
    let start = offsets.get(script.start);
    let end = offsets.get(script.end);
    if (script.content !== undefined && start !== undefined) {
      if (source.slice(start, start + 3) !== "---") {
        incomplete.push("unknown frontmatter delimiter span");
        continue;
      }
      start += 3;
      end = start + script.content.length;
      if (source.slice(start, end) !== script.content) {
        incomplete.push("unknown frontmatter content span");
        continue;
      }
    }
    if (start === undefined || end === undefined) {
      incomplete.push("unknown UTF-8 script span");
      continue;
    }
    if (script.template) {
      if (script.tail !== undefined) {
        if (source.slice(end, end + script.tail.length) !== script.tail) {
          incomplete.push("unknown Astro expression tail span");
          continue;
        }
        end += script.tail.length;
      }
      if (source[start - 1] !== "{" || source[end] !== "}") {
        incomplete.push("unknown Astro expression delimiters");
        continue;
      }
    }
    regions.push({
      start,
      end,
      language: script.language,
      role: script.template ? "template" : undefined,
    });
  }
  const references = external.flatMap((reference) => {
    const offset = offsets.get(reference.byte);
    return offset === undefined ? [] : [{ source: reference.source, offset }];
  });
  return { regions, incomplete, references };
}
