import { describe, expect, test } from "bun:test";
import {
  collectMakeBuildCommands,
  textRunsUntunedMake,
} from "../src/rules/shared/make-build-commands.ts";
import { extractMakeTarget } from "../src/rules/shared/makefile-parser.ts";

describe("Make/CMake parallel argument boundaries", () => {
  test.each([
    ["make build", [true]],
    ["gmake build", [true]],
    ["make build && echo --jobs=4", [true]],
    ["make build # -j4", [true]],
    ['make -f "serial -j4.mk" build', [true]],
    ["make -fj4.mk build", [true]],
    ["make -I include build", [true]],
    ["make FLAG=-j4 build", [true]],
    ["make -- -j4", [true]],
    ["make -j4 build", [false]],
    ["make -kj4 build", [false]],
    ["make -j 4 build", [false]],
    ["make -j build", [false]],
    ["make --jobs=4 build", [false]],
    ["make --jobs 4 build", [false]],
    ["make -j$(nproc) build", []],
    ["make -C $(pwd) -j4 build", []],
    ["cmake --build $(pwd) --parallel", []],
    ["export MAKEFLAGS=$(guess)\nmake build", []],
    ["echo $(pwd) && make build", [true]],
    ["make build && make -j4 test", [true, false]],
    ["make -j4 build && make test", [false, true]],
    ["MAKEFLAGS=-j4 make build && make test", [false, true]],
    ["export MAKEFLAGS=-j4\nmake build", [false]],
    ["export MAKEFLAGS=-j4\nunset MAKEFLAGS\nmake build", [true]],
    ["make --help", [false]],
    ["make -n build", [false]],
    ["make -q build || make build", [false, true]],
    ["cmake --build build", [true]],
    ["cmake --build build && echo --parallel", [true]],
    ['cmake --build build --target "serial -j4 target"', [true]],
    ["cmake --build build --parallel", [false]],
    ["cmake --build build --parallel=4", [false]],
    ["cmake --build build -j4", [false]],
    ["cmake --build build -- -j4", [false]],
    ["cmake --build --preset release", [false]],
    ["echo 'make build'", []],
    ["echo 'cmake --build build'", []],
    ["cat <<EOF\nmake build\nEOF", []],
    ["if false; then\nexport MAKEFLAGS=-j4\nfi\nmake build", []],
  ] as const)("%s", (text, expected) => {
    expect(
      collectMakeBuildCommands(text)
        .filter((command) => command.kind !== "cmake-configure")
        .map((command) => command.needsParallel),
    ).toEqual([...expected]);
  });
  test.each([
    ["make build", { MAKEFLAGS: "--jobs=4" }, false],
    ["make build", { MAKEFLAGS: "j4" }, false],
    ["make build", { MAKEFLAGS: "-s" }, true],
    ["make build", { CMAKE_BUILD_PARALLEL_LEVEL: "4" }, true],
    ["cmake --build build", { MAKEFLAGS: "-j4" }, true],
    ["cmake --build build", { CMAKE_BUILD_PARALLEL_LEVEL: "4" }, false],
    ["cmake --build build", { CMAKE_BUILD_PARALLEL_LEVEL: "" }, true],
    ["MAKEFLAGS= make build", { MAKEFLAGS: "-j4" }, true],
  ] as const)("tool-specific environment: %s %j", (text, env, expected) => {
    expect(collectMakeBuildCommands(text, env)[0]?.needsParallel).toBe(expected);
  });
  test("Make directory options do not become target names", () => {
    expect(extractMakeTarget("make -C app -I include target")).toBe("target");
    expect(extractMakeTarget('make -f "other file.mk" target')).toBe("target");
    expect(collectMakeBuildCommands("make -C app -C src target")[0]?.directory).toBe("app/src");
  });
  test("configure state stays associated with its build directory", () => {
    const configure = collectMakeBuildCommands('cmake -S . -B out -G "Ninja Multi-Config"')[0];
    expect(configure?.directory).toBe("out");
    expect(configure?.generator).toBe("Ninja Multi-Config");
  });
  test("repository Make checks cannot borrow flags from another command", () => {
    expect(textRunsUntunedMake("make build && echo --jobs=4")).toBe(true);
    expect(textRunsUntunedMake("env MAKEFLAGS=-j4 make build")).toBe(false);
  });
});
