import { parseDocument } from "yaml";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
} from "./repository-package-helpers.ts";

type RecordValue = Record<string, unknown>;
const registryRangePattern = /^[\w.*+~^<>=| \t]+$/;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function own(value: unknown, key: string): unknown {
  const object = record(value);
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function declaration(root: unknown, name: string): unknown {
  for (const section of [
    "devDependencies",
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const value = own(own(root, section), name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function exactVersion(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(value)
    ? value
    : undefined;
}

function registrySpec(value: unknown, name: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const spec = value.trim();
  if (spec.startsWith(`npm:${name}@`)) {
    const range = spec.slice(name.length + 5);
    return registryRangePattern.test(range);
  }
  // Unknown protocols must not borrow the version of a similarly named package.
  return registryRangePattern.test(spec) || /^catalog:[^:\r\n]*$/.test(spec);
}

// Bun's text lockfile is JSON with comments and trailing commas. Never evaluate it.
function parseBunJson(text: string): unknown {
  const tokens: string[] = [];
  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    if (char === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
        } else if (text[i++] === '"') {
          break;
        }
      }
      tokens.push(text.slice(start, i));
    } else if (text.startsWith("//", i)) {
      i += 2;
      while (i < text.length && text[i] !== "\r" && text[i] !== "\n") {
        i++;
      }
      tokens.push(" ");
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) {
        throw new Error("Unterminated lockfile comment");
      }
      i = end + 2;
      tokens.push(" ");
    } else {
      tokens.push(char);
      i++;
    }
  }
  // Strings are single tokens, so commas inside strings cannot be changed.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== ",") {
      continue;
    }
    let next = i + 1;
    while (next < tokens.length && /^\s$/.test(tokens[next]!)) {
      next++;
    }
    if (tokens[next] === "}" || tokens[next] === "]") {
      tokens[i] = "";
    }
  }
  return JSON.parse(tokens.join(""));
}

function parseYaml(text: string): RecordValue {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) {
    throw new Error("Invalid lockfile YAML");
  }
  return record(document.toJS({ maxAliasCount: 0 }));
}

// Yarn Classic is not YAML. Read only top-level selectors and their version field.
function classicYarnVersions(text: string): Map<string, string | undefined> {
  const versions = new Map<string, string | undefined>();
  let selectors: string[] = [];
  let version: string | undefined;
  let count = 0;
  const finish = () => {
    for (const selector of selectors) {
      versions.set(selector, versions.has(selector) || count !== 1 ? undefined : version);
    }
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    // SYML's indentation step is exactly two spaces. An invalid nested header
    // must not lend its version field to the preceding root selector.
    const indentation = /^[ \t]*/.exec(line)![0];
    if (indentation.includes("\t") || indentation.length % 2 !== 0) {
      throw new Error("Invalid Yarn lockfile indentation");
    }
    if (/^[^ \t]/.test(line)) {
      finish();
      selectors = [];
      count = 0;
      version = undefined;
      const header = line.trimEnd();
      if (!header.endsWith(":")) {
        continue;
      }
      let rest = header.slice(0, -1).trimEnd();
      while (rest) {
        const match = /^("(?:[^"\\]|\\.)*"|[^\s",]+)[ \t]*(?:,[ \t]*|$)/.exec(rest);
        if (!match) {
          selectors = [];
          break;
        }
        selectors.push(match[1]!.startsWith('"') ? JSON.parse(match[1]!) : match[1]!);
        rest = rest.slice(match[0].length);
        if (!rest && match[0].trimEnd().endsWith(",")) {
          selectors = [];
        }
      }
      continue;
    }
    const field = /^ {2}("(?:[^"\\]|\\.)*"|version)(?:[ \t]*:[ \t]*|[ \t]+)(.*?)[ \t]*$/.exec(line);
    if (!field) {
      continue;
    }
    const key = field[1]!.startsWith('"') ? JSON.parse(field[1]!) : field[1];
    if (key !== "version") {
      continue;
    }
    count++;
    const value = field[2]!;
    version = exactVersion(value.startsWith('"') ? JSON.parse(value) : value);
  }
  finish();
  return versions;
}

// Peer dependency paths nest recursively in pnpm's v9 specification. Validate
// their delimiters without resolving or constructing the peer dependency graph.
function pnpmVersion(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^(\d+\.\d+\.\d+(?:\+[\w.-]+)?)([\s\S]*)$/.exec(value);
  if (!match) {
    return undefined;
  }
  let depth = 0;
  const suffix = match[2]!;
  for (let index = 0; index < suffix.length; index++) {
    const char = suffix[index]!;
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      if (depth === 0 || suffix[index - 1] === "(") {
        return undefined;
      }
      depth--;
    } else if (depth === 0 || /\s/.test(char)) {
      return undefined;
    }
  }
  return depth === 0 ? match[1] : undefined;
}

/** Only root manifest dependencies; no graph traversal or package execution. */
export function readRootLockfileVersions(
  text: string,
  fileName: string,
  manifest: RecordValue,
): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const classic =
      fileName === "yarn.lock" &&
      /^(?:#[^\r\n]*(?:\r\n|\r|\n))*?#\s+yarn\s+lockfile\s+v1(?:\r\n|\r|\n)/i.test(text);
    const data = classic
      ? {}
      : fileName === "bun.lock"
        ? record(parseBunJson(text))
        : fileName === "package-lock.json"
          ? record(JSON.parse(text))
          : parseYaml(text);
    // Only formats whose root layout we understand may supply version evidence.
    // Missing version fields retain the existing best-effort legacy behavior.
    const formatVersion = data.lockfileVersion;
    if (
      fileName === "package-lock.json" &&
      formatVersion !== undefined &&
      formatVersion !== 1 &&
      formatVersion !== 2 &&
      formatVersion !== 3
    ) {
      return result;
    }
    if (
      fileName === "bun.lock" &&
      formatVersion !== undefined &&
      formatVersion !== 0 &&
      formatVersion !== 1 &&
      formatVersion !== 2
    ) {
      return result;
    }
    const yarn = classic ? classicYarnVersions(text) : undefined;
    const names = new Set(
      dependencySectionsOf(manifest).flatMap((section) => Object.keys(record(section))),
    );
    for (const name of names) {
      const spec = packageJsonDependencyVersionSpec(manifest, name)?.trim();
      if (!spec || !registrySpec(spec, name)) {
        continue;
      }
      let value: unknown;
      if (fileName === "package-lock.json") {
        if (data.lockfileVersion === 1) {
          value = own(own(data.dependencies, name), "version");
        } else if (registrySpec(declaration(own(data.packages, ""), name), name)) {
          const entry = own(data.packages, `node_modules/${name}`);
          if (
            own(entry, "link") !== true &&
            (own(entry, "name") === undefined || own(entry, "name") === name)
          ) {
            value = own(entry, "version");
          }
        }
      } else if (fileName === "bun.lock") {
        if (registrySpec(declaration(own(data.workspaces, ""), name), name)) {
          const entry = own(data.packages, name);
          if (
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            entry[0].startsWith(`${name}@`)
          ) {
            value = entry[0].slice(name.length + 1);
          }
        }
      } else if (fileName === "pnpm-lock.yaml") {
        // Before importers, the lockfile itself represented the root project.
        const root = data.importers === undefined ? data : own(data.importers, ".");
        const entry = declaration(root, name);
        const specifier = own(entry, "specifier");
        if (specifier !== undefined && !registrySpec(specifier, name)) {
          continue;
        }
        value = pnpmVersion(typeof entry === "string" ? entry : own(entry, "version"));
      } else if (fileName === "yarn.lock") {
        const selector = `${name}@${spec.startsWith("npm:") ? spec : `npm:${spec}`}`;
        if (yarn) {
          value = yarn.get(`${name}@${spec}`);
        } else {
          const entries = Object.entries(data).filter(([key]) =>
            key.split(/,\s*/).includes(selector),
          );
          if (entries.length === 1) {
            const entry = entries[0]![1];
            const version = exactVersion(own(entry, "version"));
            if (version && own(entry, "resolution") === `${name}@npm:${version}`) {
              value = version;
            }
          }
        }
      }
      const version = exactVersion(value);
      if (version) {
        result.set(name, version);
      }
    }
  } catch {
    // Malformed or unsupported input is not evidence of an installed version.
  }
  return result;
}
