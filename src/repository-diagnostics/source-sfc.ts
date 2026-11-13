export interface ScriptRegion {
  start: number;
  end: number;
  language: string;
  role?: "module" | "instance" | "template";
  statements?: boolean;
  declaration?: boolean;
}
export interface SfcScripts {
  units: {
    source: string;
    extension: string;
    skipSnapshots?: boolean;
    role?: ScriptRegion["role"];
    start?: number;
    end?: number;
  }[];
  incomplete: string[];
  sharedScope?: boolean;
  references?: { source: string; offset: number }[];
}

function units(
  source: string,
  regions: ScriptRegion[],
  combine: boolean,
  incomplete: string[],
  references: { source: string; offset: number }[] = [],
): SfcScripts {
  const validRegions = regions.filter((region) => {
    const valid =
      ["js", "jsx", "ts", "tsx", "javascript", "typescript"].includes(region.language) &&
      region.start >= 0 &&
      region.end >= region.start &&
      region.end <= source.length;
    if (!valid) {
      incomplete.push("unsupported script language or source span");
    }
    return valid;
  });
  const scriptRegions = validRegions.filter((region) => region.role !== "template");
  const expressionRegions = validRegions.filter((region) => region.role === "template");
  const accepted = [...scriptRegions.slice(0, 16), ...expressionRegions.slice(0, 128)].sort(
    (a, b) => a.start - b.start,
  );
  if (scriptRegions.length > 16) {
    incomplete.push("more than 16 script regions");
  }
  if (expressionRegions.length > 128) {
    incomplete.push("more than 128 template expressions");
  }
  const blank = source.replace(/[^\r\n\u2028\u2029]/g, " ");
  const unsafeBindings = incomplete.some((note) => /external|language|syntax|span/.test(note));
  const sharedScope =
    combine &&
    accepted.filter((region) => region.role !== "template").length > 1 &&
    !unsafeBindings;
  const skipSnapshots = combine && (sharedScope || unsafeBindings);
  if (unsafeBindings && combine) {
    incomplete.push("unknown cross-script bindings; snapshots skipped");
  }
  const groups = accepted.map((region) => [region]);
  return {
    incomplete,
    sharedScope,
    references,
    units: groups.map((group) => {
      let masked = blank;
      for (const region of group) {
        masked =
          masked.slice(0, region.start) +
          source.slice(region.start, region.end) +
          masked.slice(region.end);
      }
      const region = group[0]!;
      if (region.role === "template") {
        const prefix = region.declaration ? "{" : region.statements ? "(()=>{" : "(";
        const suffix = region.declaration ? "}" : region.statements ? "})()" : ")";
        if (region.start < prefix.length || region.end + suffix.length > source.length) {
          incomplete.push("template expression scaffold span unavailable");
          masked = blank;
        } else {
          masked =
            masked.slice(0, region.start - prefix.length) +
            prefix +
            masked.slice(region.start, region.end) +
            suffix +
            masked.slice(region.end + suffix.length);
        }
      }
      const jsx = group.some((entry) => entry.language.endsWith("sx"));
      const typescript = group.some((entry) =>
        ["ts", "tsx", "typescript"].includes(entry.language),
      );
      return {
        source: masked,
        extension: typescript ? (jsx ? ".tsx" : ".ts") : jsx ? ".jsx" : ".js",
        skipSnapshots: skipSnapshots || region.role === "template",
        role: region.role,
        start: region.start,
        end: region.end,
      };
    }),
  };
}

/** Host-owned parsers only. No preprocessing, compilation, target hooks or evaluation. */
export async function extractSfcScripts(filename: string, source: string): Promise<SfcScripts> {
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) {
    return { units: [], incomplete: ["component exceeds 4 MiB"] };
  }
  const incomplete: string[] = [];
  const regions: ScriptRegion[] = [];
  const references: { source: string; offset: number }[] = [];
  if (/\.vue$/i.test(filename)) {
    const { parse } = await import("@vue/compiler-sfc");
    const result = parse(source, { filename, sourceMap: false });
    if (result.errors.length) {
      return { units: [], incomplete: ["Vue syntax errors"] };
    }
    for (const block of [result.descriptor.script, result.descriptor.scriptSetup]) {
      if (!block) {
        continue;
      }
      if (block.src) {
        references.push({ source: block.src, offset: block.loc.start.offset });
        incomplete.push("external script source");
        continue;
      }
      if (
        block.attrs.type &&
        !["module", "text/javascript", "application/javascript"].includes(String(block.attrs.type))
      ) {
        if (!String(block.attrs.type).includes("json")) {
          incomplete.push("unsupported script type");
        }
        continue;
      }
      regions.push({
        start: block.loc.start.offset,
        end: block.loc.end.offset,
        language: block.lang ?? "js",
        role: block === result.descriptor.script ? "module" : "instance",
      });
    }
    if (result.descriptor.template) {
      const visited = new WeakSet<object>();
      function expressions(value: unknown, statements = false) {
        if (!value || typeof value !== "object" || visited.has(value)) {
          return;
        }
        visited.add(value);
        if (Array.isArray(value)) {
          for (const child of value) {
            expressions(child, statements);
          }
          return;
        }
        const node = value as Record<string, unknown>;
        const loc = node.loc as
          { start?: { offset: number }; end?: { offset: number } } | undefined;
        if (
          node.type === 4 &&
          !node.isStatic &&
          typeof node.content === "string" &&
          loc?.start &&
          loc.end
        ) {
          const raw = source.slice(loc.start.offset, loc.end.offset);
          const index = raw.indexOf(node.content);
          if (index >= 0) {
            regions.push({
              start: loc.start.offset + index,
              end: loc.start.offset + index + node.content.length,
              language: "tsx",
              role: "template",
              statements,
            });
          } else {
            incomplete.push("unknown Vue expression span");
          }
          return;
        }
        for (const key of ["children", "props", "content", "exp", "arg"]) {
          expressions(node[key], node.type === 7 && node.name === "on");
        }
      }
      expressions(result.descriptor.template.ast);
      incomplete.push("template imports audited; template snapshot provenance is not inferred");
    }
  } else if (/\.svelte$/i.test(filename)) {
    const { parse } = await import("svelte/compiler");
    const result = parse(source, { modern: true });
    for (const script of [result.module, result.instance]) {
      if (!script) {
        continue;
      }
      let language = "js";
      let supported = true;
      for (const attribute of script.attributes) {
        if (attribute.name === "src") {
          supported = false;
        }
        if (attribute.name === "lang") {
          language =
            Array.isArray(attribute.value) &&
            attribute.value.length === 1 &&
            attribute.value[0]?.type === "Text"
              ? attribute.value[0].data
              : "unsupported";
        }
      }
      if (!supported) {
        incomplete.push("external or dynamic script attributes");
        continue;
      }
      const content = script.content;
      if (
        !("start" in content) ||
        typeof content.start !== "number" ||
        !("end" in content) ||
        typeof content.end !== "number"
      ) {
        incomplete.push("missing Svelte script spans");
        continue;
      }
      regions.push({
        start: content.start,
        end: content.end,
        language,
        role: script === result.module ? "module" : "instance",
      });
    }
    if (result.fragment.nodes.length) {
      const visited = new WeakSet<object>();
      function expressions(value: unknown) {
        if (!value || typeof value !== "object" || visited.has(value)) {
          return;
        }
        visited.add(value);
        if (Array.isArray(value)) {
          for (const child of value) {
            expressions(child);
          }
          return;
        }
        const node = value as Record<string, unknown>;
        if (typeof node.type === "string" && /(?:Tag|Block|Directive)$/.test(node.type)) {
          const expression = (node.type === "ConstTag" ? node.declaration : node.expression) as
            { start?: number; end?: number } | undefined;
          if (typeof expression?.start === "number" && typeof expression.end === "number") {
            regions.push({
              start: expression.start,
              end: expression.end,
              language: "ts",
              role: "template",
              declaration: node.type === "ConstTag",
            });
          }
        }
        for (const [key, child] of Object.entries(node)) {
          if (key !== "expression" && key !== "declaration") {
            expressions(child);
          }
        }
      }
      expressions(result.fragment);
      incomplete.push("template imports audited; template snapshot provenance is not inferred");
    }
  } else {
    const { astroScriptRegions } = await import("./source-sfc-astro.ts");
    const result = await astroScriptRegions(source);
    return units(source, result.regions, false, result.incomplete, result.references);
  }
  return units(source, regions, true, incomplete, references);
}
