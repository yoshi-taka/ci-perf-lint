import { expect, test } from "bun:test";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";

const snapshot = JSON.stringify(Array(51).fill("line").join("\n"));
const call = (name: string) => `${name}(value).toMatchInlineSnapshot(${snapshot});`;

test.each([
  `let check=expect; ${call("check")}`,
  `var check=expect; ${call("check")}`,
  `const check=(value)=>expect(value); ${call("check")}`,
  `const check=function(value) { return expect(value); }; ${call("check")}`,
  `${call("check")} function check(value) { return expect(value); }`,
  `import * as globals from "@jest/globals"; const check=(value)=>globals.expect(value); ${call("check")}`,
  `const check=expect; ${call("check")}`,
  `import {expect as original} from "@jest/globals"; const check=original; ${call("check")}`,
  `import * as globals from "@jest/globals"; const check=globals.expect; ${call("check")}`,
  `import * as globals from "@jest/globals"; const check=globals["expect"]; ${call("check")}`,
  `import * as globals from "@jest/globals"; const {expect:check}=globals; ${call("check")}`,
  `import * as globals from "@jest/globals"; const {"expect":check}=globals; ${call("check")}`,
  `const first=expect; const second=first; const check=second; ${call("check")}`,
  `const outer=expect; function f() { const check=outer; ${call("check")} }`,
])("readonly, prior Jest aliases preserve identity: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toHaveLength(1);
});

test.each([
  `var check=expect; var check=custom; ${call("check")}`,
  `let check=expect; check=other; ${call("check")}`,
  `const check=async value=>expect(value); ${call("check")}`,
  `const check=function*(value) { return expect(value); }; ${call("check")}`,
  `const check=(value,other)=>expect(value); ${call("check")}`,
  `const check=value=>expect(transform(value)); ${call("check")}`,
  `function check(value) { sideEffect(); return expect(value); } ${call("check")}`,
  `function check(expect) { return expect(expect); } ${call("check")}`,
  `function f(expect) { const check=expect; ${call("check")} }`,
  `expect=custom; const check=expect; ${call("check")}`,
  `const check=expect; expect=custom; ${call("check")}`,
  `const check=expect; check=custom; ${call("check")}`,
  `const check=expect; function mutate() { check=custom; } ${call("check")}`,
  `const check=expect.bind(undefined); ${call("check")}`,
  `const check=unknown; ${call("check")}`,
  `const check=later; const later=expect; ${call("check")}`,
  `function f() { ${call("check")} } const check=expect;`,
  `const check=other; const other=check; ${call("check")}`,
  `import * as globals from "@jest/globals"; const {expect:check=custom}=globals; ${call("check")}`,
  `import * as globals from "@jest/globals"; function f(globals) { const check=globals.expect; ${call("check")} }`,
  `import * as globals from "@jest/globals"; globals.expect=custom; const check=globals.expect; ${call("check")}`,
])("ambiguous/mutable/forward/wrapped aliases are not guessed: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toEqual([]);
});

test("shadowed writes remain local and cannot resurrect an invalidated alias chain", async () => {
  const source = `const check=expect; function f(check) { check=other; ${call("check")} } ${call("check")}`;
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toHaveLength(1);
  expect(
    (await parseSourceAudit(
      "a.test.ts",
      `const first=expect; const check=first; first=custom; ${call("check")}`,
    ))!.snapshots,
  ).toEqual([]);
});
