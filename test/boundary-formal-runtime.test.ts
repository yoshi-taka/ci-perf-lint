import { afterAll, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFormalRunner, formalModels, runFormalCommand } from "../scripts/formal-runtime.ts";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function directory() {
  const base = path.join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "formal-runtime-"));
  roots.push(root);
  await writeFile(path.join(root, "lean-toolchain"), "leanprover/lean4:v4.35.0\n");
  for (const model of formalModels) {
    await writeFile(path.join(root, `${model}.lean`), `#print axioms ${model}.test\n`);
  }
  return root;
}

const targetModels: Record<string, string> = {
  evidence: "Evidence",
  gates: "Gates",
  gateExpr: "GateExpr",
  findingRetention: "FindingRetention",
};
function buildLog(args: string[]) {
  return args
    .slice(2)
    .map((target) => `'${targetModels[target]}.test' does not depend on any axioms`)
    .join("\n");
}

test("one checked build serves concurrent native generators; comparisons are never cached", async () => {
  const root = await directory();
  const commands: string[][] = [];
  let generations = 0;
  const runner = createFormalRunner({
    directory: root,
    lake: "fake-lake",
    log: () => {},
    execute: async (args, cwd) => {
      await Promise.resolve();
      expect(cwd).toBe(root);
      commands.push(args);
      if (args[1] === "env") {
        return { code: 0, stdout: "Lean (version 4.35.0, test)", stderr: "" };
      }
      if (args[1] === "build") {
        return { code: 0, stdout: buildLog(args), stderr: "" };
      }
      generations++;
      return { code: 0, stdout: '{"case":1}\n', stderr: "" };
    },
  });
  await runner.build();
  expect(await Promise.all(formalModels.map((model) => runner.run(model)))).toEqual(
    formalModels.map(() => '{"case":1}\n'),
  );
  await runner.run("Evidence");
  expect(commands.filter((args) => args[1] === "env")).toHaveLength(1);
  expect(commands.filter((args) => args[1] === "build")).toEqual([
    ["fake-lake", "build", "evidence", "gates", "gateExpr", "findingRetention"],
  ]);
  expect(generations).toBe(5);
});

test("focused verification only builds its own target", async () => {
  const root = await directory();
  const commands: string[][] = [];
  const runner = createFormalRunner({
    directory: root,
    lake: "fake-lake",
    log: () => {},
    execute: async (args) => {
      await Promise.resolve();
      commands.push(args);
      return {
        code: 0,
        stdout:
          args[1] === "env"
            ? "Lean (version 4.35.0)"
            : args[1] === "build"
              ? buildLog(args)
              : "{}\n",
        stderr: "",
      };
    },
  });
  await runner.run("Gates");
  expect(commands.filter((args) => args[1] === "build")).toEqual([["fake-lake", "build", "gates"]]);
});

for (const scenario of [
  "wrong-version",
  "failed-build",
  "sorry",
  "missing-audit",
  "undeclared-audit",
] as const) {
  test(`${scenario} cannot execute a stale native generator`, async () => {
    const root = await directory();
    if (scenario === "undeclared-audit") {
      await writeFile(path.join(root, "Evidence.lean"), "def unrelated := 1\n");
    }
    let ranGenerator = false;
    const runner = createFormalRunner({
      directory: root,
      lake: "fake-lake",
      log: () => {},
      execute: async (args) => {
        await Promise.resolve();
        if (args[1] === "env") {
          return {
            code: 0,
            stdout: `Lean (version ${scenario === "wrong-version" ? "4.34.0" : "4.35.0"})`,
            stderr: "",
          };
        }
        if (args[1] === "build") {
          return {
            code: scenario === "failed-build" ? 1 : 0,
            stdout:
              scenario === "missing-audit"
                ? "Build completed"
                : scenario === "sorry"
                  ? "'Evidence.test' depends on axioms: [sorryAx]"
                  : buildLog(args),
            stderr: "",
          };
        }
        ranGenerator = true;
        return { code: 0, stdout: "stale result", stderr: "" };
      },
    });
    await rejects(runner.run("Evidence"));
    expect(ranGenerator).toBe(false);
  });
}

test("native generator failure propagates instead of accepting partial output", async () => {
  const root = await directory();
  const runner = createFormalRunner({
    directory: root,
    lake: "fake-lake",
    log: () => {},
    execute: async (args) => {
      await Promise.resolve();
      if (args[1] === "env") {
        return { code: 0, stdout: "Lean (version 4.35.0)", stderr: "" };
      }
      if (args[1] === "build") {
        return { code: 0, stdout: buildLog(args), stderr: "" };
      }
      return { code: 7, stdout: '{"case":1}\n', stderr: "generator failed" };
    },
  });
  await rejects(runner.run("Evidence"), /generator failed/);
});

test("bounded process capture preserves exit status and rejects excessive output", async () => {
  const result = await runFormalCommand(
    [process.execPath, "-e", 'console.log("日本語"); process.exit(7)'],
    process.cwd(),
    1024,
  );
  expect(result.code).toBe(7);
  expect(result.stdout).toBe("日本語\n");
  await rejects(
    runFormalCommand(
      [process.execPath, "-e", 'process.stdout.write("x".repeat(100000))'],
      process.cwd(),
      512,
    ),
    /exceeded 512 bytes/,
  );
});

test.skipIf(process.env.FORMAL_INTEGRATION !== "1")(
  "real Lake cache rebuilds changed sources and rejects false/untracked-sorry proofs",
  async () => {
    const root = await directory();
    await writeFile(
      path.join(root, "lakefile.toml"),
      'name = "formalRuntimeTest"\nmoreLeanArgs = ["-DwarningAsError=true"]\n[[lean_exe]]\nname = "evidence"\nroot = "Evidence"\n',
    );
    const source = (value: number, proof = "1 + 1 = 2 := by decide", extra = "") =>
      `import Lean\nnamespace Evidence\ntheorem test : ${proof}\n${extra}\nend Evidence\n#print axioms Evidence.test\ndef main : IO Unit := do\n  (← IO.getStdout).putStrLn ${JSON.stringify(JSON.stringify({ value }))}\n`;
    const runner = () => createFormalRunner({ directory: root, log: () => {} });
    await writeFile(path.join(root, "Evidence.lean"), source(1));
    expect(JSON.parse(await runner().run("Evidence"))).toEqual({ value: 1 });
    // A warm cache still replays the audit; no compilation output is not enough.
    expect(JSON.parse(await runner().run("Evidence"))).toEqual({ value: 1 });
    await writeFile(path.join(root, "Evidence.lean"), source(2));
    expect(JSON.parse(await runner().run("Evidence"))).toEqual({ value: 2 });
    await writeFile(path.join(root, "Evidence.lean"), source(3, "1 + 1 = 3 := by decide"));
    await rejects(runner().run("Evidence"), /Lean build failed/);
    await writeFile(
      path.join(root, "Evidence.lean"),
      source(4, "1 + 1 = 2 := by decide", "theorem untracked : False := by sorry"),
    );
    await rejects(runner().run("Evidence"), /Lean build failed/);
  },
  60_000,
);
