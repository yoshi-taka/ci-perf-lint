import { parseDocument } from "yaml";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
} from "./repository-package-helpers.ts";

type RecordValue = Record<string, unknown>;

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
  return (
    typeof value === "string" &&
    !/^(?:file:|link:|workspace:|https?:|git|github:)/.test(value) &&
    (!value.startsWith("npm:") || value.startsWith(`npm:${name}@`))
  );
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
      const end = text.indexOf("\n", i + 2);
      i = end < 0 ? text.length : end;
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
  for (const block of text.split(/\r?\n(?=[^\s#])/)) {
    const lines = block.split(/\r?\n/);
    const header = lines.shift() ?? "";
    if (!header.endsWith(":")) {
      continue;
    }
    const selectors: string[] = [];
    let rest = header.slice(0, -1);
    while (rest) {
      const match = /^("(?:[^"\\]|\\.)*"|[^\s",]+)(?:,\s*|$)/.exec(rest);
      if (!match) {
        break;
      }
      selectors.push(match[1]!.startsWith('"') ? JSON.parse(match[1]!) : match[1]!);
      rest = rest.slice(match[0].length);
    }
    if (rest) {
      continue;
    }
    const fields = lines.filter((line) => /^  version\s/.test(line));
    const match = fields.length === 1 ? /^  version "([^"\r\n]+)"\s*$/.exec(fields[0]!) : null;
    for (const selector of selectors) {
      versions.set(selector, versions.has(selector) ? undefined : exactVersion(match?.[1]));
    }
  }
  return versions;
}

/** Only root manifest dependencies; no graph traversal or package execution. */
export function readRootLockfileVersions(
  text: string,
  fileName: string,
  manifest: RecordValue,
): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const classic = fileName === "yarn.lock" && text.includes("# yarn lockfile v1");
    const data = classic
      ? {}
      : fileName === "bun.lock"
        ? record(parseBunJson(text))
        : fileName === "package-lock.json"
          ? record(JSON.parse(text))
          : parseYaml(text);
    const yarn = classic ? classicYarnVersions(text) : undefined;
    const names = new Set(
      dependencySectionsOf(manifest).flatMap((section) => Object.keys(record(section))),
    );
    for (const name of names) {
      const spec = packageJsonDependencyVersionSpec(manifest, name);
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
        const version = typeof entry === "string" ? entry : own(entry, "version");
        if (typeof version === "string") {
          value = /^(\d+\.\d+\.\d+(?:\+[\w.-]+)?)(?:\([^\r\n]*\))?$/.exec(version)?.[1];
        }
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
