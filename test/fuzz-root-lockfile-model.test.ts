import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { stringify } from "yaml";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

// Structural models from the official npm package-lock docs, pnpm spec v9,
// Yarn SYML PEG (Classic)/YAML (Berry), and Bun JSONC workspace/package layout.
// Expected versions come from the model, never from another call to our reader.
type Dependency = { name: string; version: string; section: string };
type Format = "npm" | "bun" | "pnpm" | "classic" | "berry";
const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
const versionArbitrary = fc
  .tuple(
    fc.integer({ min: 0, max: 50 }),
    fc.integer({ min: 0, max: 50 }),
    fc.integer({ min: 0, max: 50 }),
  )
  .map((parts) => parts.join("."));
const nameArbitrary = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}$/),
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,5}$/), fc.stringMatching(/^[a-z]{1,5}$/))
    .map(([scope, name]) => `@${scope}/${name}`),
);
const dependenciesArbitrary = fc.uniqueArray(
  fc.record({
    name: nameArbitrary,
    version: versionArbitrary,
    section: fc.constantFrom("dependencies", "devDependencies", "optionalDependencies"),
  }),
  { selector: (entry) => entry.name, minLength: 1, maxLength: 8 },
);
const formatArbitrary = fc.constantFrom<Format>("npm", "bun", "pnpm", "classic", "berry");

function manifest(entries: Dependency[], spec?: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const entry of entries) {
    (result[entry.section] ??= {})[entry.name] = spec ?? `^${entry.version.split(".")[0]}.0.0`;
  }
  return result;
}

function render(format: Format, entries: Dependency[]) {
  const root = manifest(entries);
  if (format === "npm") {
    return {
      file: "package-lock.json",
      text: JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": root,
          ...Object.fromEntries(
            entries.map((entry) => [`node_modules/${entry.name}`, { version: entry.version }]),
          ),
          ...Object.fromEntries(
            entries.map((entry) => [
              `node_modules/unrelated/node_modules/${entry.name}`,
              { version: "999.0.0" },
            ]),
          ),
        },
      }),
    };
  }
  if (format === "bun") {
    return {
      file: "bun.lock",
      text: JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": root, "packages/unrelated": manifest(entries, "^999.0.0") },
        packages: Object.fromEntries(
          entries.map((entry) => [entry.name, [`${entry.name}@${entry.version}`, "", {}, ""]]),
        ),
      }),
    };
  }
  if (format === "pnpm") {
    const importer: Record<string, Record<string, unknown>> = {};
    for (const entry of entries) {
      (importer[entry.section] ??= {})[entry.name] = {
        specifier: root[entry.section]![entry.name],
        version: `${entry.version}(peer@2.0.0(other@3.0.0))`,
      };
    }
    return {
      file: "pnpm-lock.yaml",
      text: stringify({
        lockfileVersion: "9.0",
        importers: {
          ".": importer,
          "packages/unrelated": {
            dependencies: Object.fromEntries(
              entries.map((entry) => [entry.name, { version: "999.0.0" }]),
            ),
          },
        },
      }),
    };
  }
  if (format === "berry") {
    return {
      file: "yarn.lock",
      text: stringify(
        Object.fromEntries(
          entries.flatMap((entry) => [
            [
              `${entry.name}@npm:${root[entry.section]![entry.name]}`,
              { version: entry.version, resolution: `${entry.name}@npm:${entry.version}` },
            ],
            [
              `${entry.name}@npm:^999.0.0`,
              { version: "999.0.0", resolution: `${entry.name}@npm:999.0.0` },
            ],
          ]),
        ),
      ),
    };
  }
  return {
    file: "yarn.lock",
    text: `# yarn lockfile v1\n${entries
      .map(
        (entry) =>
          `${JSON.stringify(`${entry.name}@${root[entry.section]![entry.name]}`)}:\n  version ${JSON.stringify(entry.version)}\n\n${JSON.stringify(`${entry.name}@^999.0.0`)}:\n  version "999.0.0"\n`,
      )
      .join("\n")}`,
  };
}

describe("fuzz: official lockfile structural models", () => {
  test("all formats extract the modeled root version, not nested/importer/selector decoys", () => {
    fc.assert(
      fc.property(formatArbitrary, dependenciesArbitrary, (format, entries) => {
        const { file, text } = render(format, entries);
        expect(Object.fromEntries(readRootLockfileVersions(text, file, manifest(entries)))).toEqual(
          Object.fromEntries(entries.map((entry) => [entry.name, entry.version])),
        );
      }),
      options,
    );
  });

  test("removing manifest declarations only removes evidence, never admits transitive packages", () => {
    fc.assert(
      fc.property(formatArbitrary, dependenciesArbitrary, fc.nat(), (format, entries, cut) => {
        const { file, text } = render(format, entries);
        const retained = entries.slice(0, cut % (entries.length + 1));
        expect(
          Object.fromEntries(readRootLockfileVersions(text, file, manifest(retained))),
        ).toEqual(Object.fromEntries(retained.map((entry) => [entry.name, entry.version])));
      }),
      options,
    );
  });

  test("foreign aliases and workspace/file/unknown protocols never become registry versions", () => {
    fc.assert(
      fc.property(
        formatArbitrary,
        dependenciesArbitrary,
        fc.constantFrom(
          "npm:@different/package@^1.0.0",
          "workspace:*",
          "file:../local",
          "portal:../local",
          "exec:./script",
          "owner/repo",
        ),
        (format, entries, spec) => {
          const { file, text } = render(format, entries);
          expect(readRootLockfileVersions(text, file, manifest(entries, spec)).size).toBe(0);
        },
      ),
      options,
    );
  });
});
