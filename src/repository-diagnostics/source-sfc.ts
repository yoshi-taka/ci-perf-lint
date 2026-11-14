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
  return {
    incomplete,
    sharedScope,
    references,
    units: accepted.map((region) => {
      let masked =
        blank.slice(0, region.start) +
        source.slice(region.start, region.end) +
        blank.slice(region.end);
      for (const span of region.omit ?? []) {
        masked = `${masked.slice(0, span.start)}0${blank.slice(
          span.start + 1,
          span.end,
        )}${masked.slice(span.end)}`;
      }
      if (region.role === "template") {
        const prefix =
          region.prefix ?? (region.declaration ? "{" : region.statements ? "(()=>{" : "(");
        const suffix =
          region.suffix ?? (region.declaration ? "}" : region.statements ? "})()" : ")");
        if (region.start < prefix.length) {
          incomplete.push("template expression scaffold span unavailable");
          masked = blank;
        } else {
          masked = masked.padEnd(region.end + suffix.length, " ");
          masked =
            masked.slice(0, region.start - prefix.length) +
            prefix +
            masked.slice(region.start, region.end) +
            suffix +
            masked.slice(region.end + suffix.length);
        }
      }
      const jsx = region.language.endsWith("sx");
      const typescript = ["ts", "tsx", "typescript"].includes(region.language);
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
