import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
  parseTypeScriptVersionSpec,
} from "../src/repository-package-helpers.ts";

describe("repository package helpers", () => {
  test("detects dependencies across supported package.json sections only when versions are strings", () => {
    const packageJson = {
      dependencies: {
        next: "^14.2.0",
        ignored: 1,
      },
      devDependencies: {
        typescript: "^5.4.5",
      },
      peerDependencies: {
        react: "^18.0.0",
      },
      optionalDependencies: {
        sharp: "^0.33.0",
      },
    };

    expect(packageJsonHasDependency(packageJson, "next")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "typescript")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "react")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "sharp")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "ignored")).toBe(false);
    expect(packageJsonHasDependency(packageJson, "missing")).toBe(false);
  });

  test("prefers devDependency version specs before other package.json sections", () => {
    const packageJson = {
      dependencies: {
        typescript: "^5.1.0",
        next: "^14.0.0",
      },
      devDependencies: {
        typescript: "~5.4.5",
      },
      optionalDependencies: {
        next: "14.2.3",
      },
    };

    expect(packageJsonDependencyVersionSpec(packageJson, "typescript")).toBe("~5.4.5");
    expect(packageJsonDependencyVersionSpec(packageJson, "next")).toBe("^14.0.0");
    expect(packageJsonDependencyVersionSpec(packageJson, "missing")).toBeUndefined();
  });

  test("ignores blank and non-string package version specs", () => {
    const packageJson = {
      dependencies: {
        vite: "",
        react: 18,
      },
    };

    expect(packageJsonDependencyVersionSpec(packageJson, "vite")).toBeUndefined();
    expect(packageJsonDependencyVersionSpec(packageJson, "react")).toBeUndefined();
  });

  test("ignores whitespace-only version specs", () => {
    const packageJson = {
      dependencies: {
        vite: "   ",
      },
    };

    expect(packageJsonDependencyVersionSpec(packageJson, "vite")).toBeUndefined();
  });

  test("ignores null, undefined, and array dependency sections", () => {
    const packageJson = {
      dependencies: null,
      devDependencies: undefined,
      peerDependencies: [],
      optionalDependencies: {
        sharp: "^0.33.0",
      },
    };

    expect(packageJsonHasDependency(packageJson, "sharp")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "missing")).toBe(false);
    expect(packageJsonDependencyVersionSpec(packageJson, "sharp")).toBe("^0.33.0");
    expect(packageJsonDependencyVersionSpec(packageJson, "missing")).toBeUndefined();
  });

  test("skips non-object sections (string, number, boolean)", () => {
    const packageJson = {
      dependencies: "some-string",
      devDependencies: 42,
      peerDependencies: true,
      optionalDependencies: {
        sharp: "^0.33.0",
      },
    };

    expect(packageJsonHasDependency(packageJson, "sharp")).toBe(true);
    expect(packageJsonHasDependency(packageJson, "missing")).toBe(false);
    expect(packageJsonDependencyVersionSpec(packageJson, "sharp")).toBe("^0.33.0");
    expect(packageJsonDependencyVersionSpec(packageJson, "missing")).toBeUndefined();
  });

  test.each([
    ["^5.4.5", { major: 5, minor: 4 }],
    [">=5.8 <6", { major: 5, minor: 8 }],
    ["workspace:*", {}],
    ["next", {}],
    ["10.20", { major: 10, minor: 20 }],
  ])("parses TypeScript version spec %s", (versionSpec, expected) => {
    expect(parseTypeScriptVersionSpec(versionSpec)).toEqual(expected);
  });

  test.each([
    ["^14.2.3", { major: 14, minor: 2, patch: 3 }],
    ["~7.6", { major: 7, minor: 6 }],
    [">=29.0.0 <30", { major: 29, minor: 0, patch: 0 }],
    ["10.0.0-beta.1", { major: 10, minor: 0, patch: 0 }],
    ["workspace:*", {}],
    ["10.20.30", { major: 10, minor: 20, patch: 30 }],
    ["10.20", { major: 10, minor: 20 }],
  ])("parses semver-like version spec %s", (versionSpec, expected) => {
    expect(parseSemverLikeVersionSpec(versionSpec)).toEqual(expected);
  });

  test("prefers non-blank devDependency specs over other sections", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        fc.string({ minLength: 1 }).filter((value) => value.trim().length > 0),
        fc.option(fc.oneof(fc.constant(""), fc.integer(), fc.boolean()), {
          nil: undefined,
        }),
        fc.option(
          fc.string({ minLength: 1 }).filter((value) => value.trim().length > 0),
          {
            nil: undefined,
          },
        ),
        (dependencyName, devVersion, dependencyVersion, optionalVersion) => {
          const packageJson = {
            dependencies:
              dependencyVersion === undefined ? {} : { [dependencyName]: dependencyVersion },
            devDependencies: { [dependencyName]: devVersion },
            optionalDependencies:
              optionalVersion === undefined ? {} : { [dependencyName]: optionalVersion },
          };

          expect(packageJsonHasDependency(packageJson, dependencyName)).toBe(true);
          expect(packageJsonDependencyVersionSpec(packageJson, dependencyName)).toBe(devVersion);
        },
      ),
    );
  });

  test("detects dependencies exactly when at least one supported section holds a string value", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        fc.record({
          dependencies: fc.option(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
            nil: undefined,
          }),
          devDependencies: fc.option(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
            nil: undefined,
          }),
          peerDependencies: fc.option(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
            nil: undefined,
          }),
          optionalDependencies: fc.option(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
            nil: undefined,
          }),
        }),
        (dependencyName, sections) => {
          const packageJson = {
            dependencies:
              sections.dependencies === undefined
                ? {}
                : { [dependencyName]: sections.dependencies },
            devDependencies:
              sections.devDependencies === undefined
                ? {}
                : { [dependencyName]: sections.devDependencies },
            peerDependencies:
              sections.peerDependencies === undefined
                ? {}
                : { [dependencyName]: sections.peerDependencies },
            optionalDependencies:
              sections.optionalDependencies === undefined
                ? {}
                : { [dependencyName]: sections.optionalDependencies },
          };

          const expected = Object.values(sections).some((value) => typeof value === "string");
          expect(packageJsonHasDependency(packageJson, dependencyName)).toBe(expected);
        },
      ),
    );
  });

  test("extracts the first major and minor pair from TypeScript-like version specs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 999 }),
        fc.stringMatching(/^[^0-9]*$/),
        fc.stringMatching(/^[^0-9.]*$/),
        (major, minor, prefix, suffix) => {
          const versionSpec = `${prefix}${major}.${minor}${suffix}`;
          expect(parseTypeScriptVersionSpec(versionSpec)).toEqual({ major, minor });
        },
      ),
    );
  });

  test("extracts semver major, minor, and patch when a full triplet is present", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 0, max: 999 }),
        fc.stringMatching(/^[^0-9]*$/),
        fc.stringMatching(/^[^0-9.]*$/),
        (major, minor, patch, prefix, suffix) => {
          const versionSpec = `${prefix}${major}.${minor}.${patch}${suffix}`;
          expect(parseSemverLikeVersionSpec(versionSpec)).toEqual({ major, minor, patch });
        },
      ),
    );
  });
});
