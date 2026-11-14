import type { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  parseSourceAudit,
  type SourceImport,
  type SourceSnapshot,
  type SourceWildcardExport,
  type SourceProgramCapture,
  sourcePositions,
} from "./source-audit-parser.ts";
import {
  findLargeBarrels,
  createSourceReferenceResolver,
  type SourceBarrel,
} from "./source-barrel-graph.ts";
import { createTsconfigReferences } from "./source-tsconfig.ts";
import { createPackageReferences } from "./source-package-references.ts";
import { extractSfcScripts, type SfcScripts } from "./source-sfc.ts";
import { findComponentSnapshots } from "./jest-inline-snapshots.ts";
import path from "node:path";

interface SourceAudit {
  imports: SourceImport[];
  barrels: SourceBarrel[];
  snapshots: SourceSnapshot[];
}

const scans = new WeakMap<RepositoryScanContext, Promise<SourceAudit>>();
const jsSource = /\.[cm]?[jt]sx?$/i;
const unsupportedSource = /\.(vue|svelte|astro)$/i;
const ignoredPath =
  /(?:^|\/)(?:\.git|node_modules|vendor|dist|build|out|\.next|\.turbo|coverage|fixtures|__fixtures__|__snapshots__|[^/]+\.snapshot)(?:\/|$)|\.fixture\.[^/]+$/;

/** Cache facts, not ASTs; context lifetime prevents stale results across analyses. */
export function collectSourceAudit(context: RepositoryScanContext): Promise<SourceAudit> {
  const cached = scans.get(context);
  if (cached) {
    return cached;
  }
  const scan = (async () => {
    const facts: SourceAudit = { imports: [], barrels: [], snapshots: [] };
    const wildcardExports: SourceWildcardExport[] = [];
    const sourceFiles = new Set<string>();
    let unsupported = 0;
    let failed = 0;
    let firstFailure = "";
    let partialComponents = 0;
    let firstComponentNote = "";
    const files: string[] = [];
    for await (const filename of context.walkFilesIter(".")) {
      if (ignoredPath.test(filename)) {
        continue;
      }
      files.push(filename);
    }
    const knownFiles = new Set(files);
    for (const filename of files) {
      const component = unsupportedSource.test(filename);
      if (!jsSource.test(filename) && !component) {
        continue;
      }
      try {
        const source = await context.readTextFileOrWarn(context.resolve(filename));
        if (source === undefined) {
          failed++;
          firstFailure ||= filename;
          continue;
        }
        const omittedExtension = (request: string) => {
          const target = path.posix.normalize(
            path.posix.join(path.posix.dirname(filename), request),
          );
          // Exact assets win. Require an unambiguous source file; never infer from dots alone.
          if (knownFiles.has(target)) {
            return false;
          }
          return (
            [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].filter((extension) =>
              knownFiles.has(target + extension),
            ).length === 1
          );
        };
        const scripts: SfcScripts = component
          ? await extractSfcScripts(filename, source)
          : { units: [{ source, extension: "" }], incomplete: [] };
        const importStart = facts.imports.length;
        if (scripts.references?.length) {
          const position = sourcePositions(source);
          facts.imports.push(
            ...scripts.references.map((reference) => ({
              relativePath: filename,
              source: reference.source,
              ...position(reference.offset),
              names: [],
              namespace: false,
              restricted: false,
              extensions: false,
            })),
          );
        }
        if (scripts.incomplete.length) {
          partialComponents++;
          firstComponentNote ||= `${filename}: ${scripts.incomplete.join("; ")}`;
        }
        let valid = scripts.units.length === 0;
        let parseFailure = false;
        let scriptFailure = false;
        const programs: {
          capture: SourceProgramCapture;
          role?: "module" | "instance" | "template";
          start: number;
          end: number;
        }[] = [];
        for (const unit of scripts.units) {
          const parsed = await parseSourceAudit(
            filename,
            unit.source,
            omittedExtension,
            { filename: filename + unit.extension, positionSource: source },
            scripts.sharedScope && unit.role !== "template"
              ? (capture) =>
                  programs.push({
                    capture,
                    role: unit.role,
                    start: unit.start ?? 0,
                    end: unit.end ?? source.length,
                  })
              : undefined,
          );
          if (parsed) {
            valid = true;
            facts.imports.push(...parsed.imports);
            wildcardExports.push(...parsed.wildcardExports);
            if (!unit.skipSnapshots) {
              facts.snapshots.push(...parsed.snapshots);
            }
          } else {
            parseFailure = true;
            if (unit.role !== "template") {
              scriptFailure = true;
            }
          }
        }
        if (scripts.sharedScope && !scriptFailure) {
          const module = programs.find((program) => program.role === "module");
          const instance = programs.find((program) => program.role === "instance");
          if (instance) {
            const captures = programs;
            const snapshots = findComponentSnapshots(
              module?.capture.program,
              instance.capture.program,
              instance.capture.visitorKeys,
              (offset) =>
                captures
                  .find((program) => offset >= program.start && offset < program.end)
                  ?.capture.suppressed(offset) ?? false,
            );
            facts.snapshots.push(
              ...snapshots.map(({ offset, lineCount }) => ({
                relativePath: filename,
                ...instance.capture.position(offset),
                lineCount,
              })),
            );
          }
        }
        if (component) {
          const seen = new Set<string>();
          const ordered = facts.imports
            .splice(importStart)
            .sort((a, b) => a.line - b.line || a.column - b.column);
          facts.imports.push(
            ...ordered.filter((entry) => {
              const key = JSON.stringify([entry.line, entry.column, entry.source]);
              if (seen.has(key)) {
                return false;
              }
              seen.add(key);
              return true;
            }),
          );
        }
        if (valid) {
          sourceFiles.add(filename);
        }
        if (parseFailure) {
          failed++;
          firstFailure ||= filename;
        }
      } catch (error) {
        if (component) {
          unsupported++;
        } else {
          failed++;
        }
        firstFailure ||= `${filename}: ${String(error)}`;
      }
    }
    if (partialComponents) {
      context.warn(
        "source-audit",
        `SFC audit partial in ${partialComponents} component files: ${firstComponentNote}. Only supported script/template regions and static references were audited.`,
      );
    }
    if (wildcardExports.length) {
      const tsconfig = await createTsconfigReferences(context, knownFiles, sourceFiles);
      const packages = await createPackageReferences(context, knownFiles, sourceFiles);
      const relativeReference = createSourceReferenceResolver(sourceFiles);
      facts.barrels = findLargeBarrels(
        facts.imports,
        wildcardExports,
        sourceFiles,
        (from, request) => {
          if (
            /^\.{1,2}(?:\/|$)/.test(request) ||
            request.startsWith("/") ||
            /^[a-z][\w+.-]*:/i.test(request) ||
            /[?#]/.test(request.slice(request.startsWith("#") ? 1 : 0))
          ) {
            return relativeReference(from, request);
          }
          return (
            tsconfig(from, request) ?? packages(from, request) ?? relativeReference(from, request)
          );
        },
      );
    }
    if (unsupported || failed) {
      context.warn(
        "source-audit",
        `Source audit incomplete: skipped ${unsupported} Vue/Svelte/Astro files and ${failed} JS/TS read/parse failures.${firstFailure ? ` First failure: ${firstFailure}.` : ""}`,
      );
    }
    return facts;
  })();
  scans.set(context, scan);
  return scan;
}
