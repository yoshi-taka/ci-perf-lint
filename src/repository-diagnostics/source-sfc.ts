import { componentScriptRegions } from "./source-sfc-components.ts";

export interface ScriptRegion {
  start: number;
  end: number;
  language: string;
  role?: "module" | "instance" | "template";
  statements?: boolean;
  declaration?: boolean;
  prefix?: string;
  suffix?: string;
  omit?: { start: number; end: number }[];
}
export interface SfcScripts {
  units: {
    source: string;
    /** Add to parser offsets to recover positions in the original component. */
    positionOffset?: number;
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
  let sharedBlank: string | undefined;
  const unsafeBindings = incomplete.some((note) => /external|language|syntax|span/.test(note));
  const sharedScope =
    combine &&
    accepted.filter((region) => region.role !== "template").length > 1 &&
    !unsafeBindings;
  const skipSnapshots = combine && (sharedScope || unsafeBindings);
  if (unsafeBindings && combine) {
    incomplete.push("unknown cross-script bindings; snapshots skipped");
  }
  return {
    incomplete,
    sharedScope,
    references,
    units: accepted.map((region) => {
      const prefix =
        region.role === "template"
          ? (region.prefix ?? (region.declaration ? "{" : region.statements ? "(()=>{" : "("))
          : "";
      const suffix =
        region.role === "template"
          ? (region.suffix ?? (region.declaration ? "}" : region.statements ? "})()" : ")"))
          : "";
      // Shared captures keep absolute AST offsets. Otherwise retain just the
      // scaffold and one bordering character, so a script hashbang stays noninitial.
      const absolute = sharedScope || region.start < prefix.length;
      const positionOffset = absolute ? 0 : Math.max(0, region.start - prefix.length - 1);
      const limit = absolute
        ? source.length
        : Math.min(source.length, region.end + suffix.length + 1);
      const blank = absolute
        ? (sharedBlank ??= source.replace(/[^\r\n\u2028\u2029]/g, " "))
        : source.slice(positionOffset, limit).replace(/[^\r\n\u2028\u2029]/g, " ");
      const begin = region.start - positionOffset;
      const end = region.end - positionOffset;
      let masked =
        blank.slice(0, begin) + source.slice(region.start, region.end) + blank.slice(end);
      for (const span of region.omit ?? []) {
        const left = span.start - positionOffset;
        const right = span.end - positionOffset;
        masked = `${masked.slice(0, left)}0${blank.slice(left + 1, right)}${masked.slice(right)}`;
      }
      if (region.role === "template") {
        if (region.start < prefix.length) {
          incomplete.push("template expression scaffold span unavailable");
          masked = blank;
        } else {
          masked = masked.padEnd(end + suffix.length, " ");
          masked =
            masked.slice(0, begin - prefix.length) +
            prefix +
            masked.slice(begin, end) +
            suffix +
            masked.slice(end + suffix.length);
        }
      }
      const jsx = region.language.endsWith("sx");
      const typescript = ["ts", "tsx", "typescript"].includes(region.language);
      return {
        source: masked,
        positionOffset,
        extension: typescript ? (jsx ? ".tsx" : ".ts") : jsx ? ".jsx" : ".js",
        skipSnapshots: skipSnapshots || region.role === "template",
        role: region.role,
        start: region.start,
        end: region.end,
      };
    }),
  };
}

/** Static region extraction; no framework compiler, preprocessing or target evaluation. */
export async function extractSfcScripts(filename: string, source: string): Promise<SfcScripts> {
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) {
    return { units: [], incomplete: ["component exceeds 4 MiB"] };
  }
  if (/\.(?:vue|svelte)$/i.test(filename)) {
    const result = componentScriptRegions(source, /\.svelte$/i.test(filename));
    return units(source, result.regions, true, result.incomplete, result.references);
  }
  const { astroScriptRegions } = await import("./source-sfc-astro.ts");
  const result = astroScriptRegions(source);
  return units(source, result.regions, false, result.incomplete, result.references);
}
