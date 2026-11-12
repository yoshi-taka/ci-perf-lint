import path from "node:path";
import { fileURLToPath } from "node:url";

const executables = {
  Evidence: "evidence",
  Gates: "gates",
  GateExpr: "gateExpr",
  FindingRetention: "findingRetention",
} as const;
export type FormalModel = keyof typeof executables;
export const formalModels = Object.keys(executables) as FormalModel[];

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
type CommandRunner = (args: string[], cwd: string, limit: number) => Promise<CommandResult>;

async function boundedText(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        throw new Error(`Formal command output exceeded ${limit} bytes`);
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export const runFormalCommand: CommandRunner = async (args, cwd, limit) => {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      boundedText(child.stdout, limit),
      boundedText(child.stderr, limit),
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
};

/** Build once per verification invocation; Lake owns dependency/content hashes.
 * Native JSONL is regenerated and compared against CURRENT TS on every run.
 * No result cache, prebuilt bypass flag, or proof-check suppression is provided.
 */
export function createFormalRunner(
  options: {
    directory?: string;
    lake?: string;
    execute?: CommandRunner;
    log?: (text: string) => void;
  } = {},
) {
  const directory = options.directory ?? fileURLToPath(new URL("../formal/", import.meta.url));
  const lean = process.env.LEAN_BIN;
  const siblingLake =
    lean && (path.isAbsolute(lean) || lean.includes(path.sep))
      ? path.join(path.dirname(lean), process.platform === "win32" ? "lake.exe" : "lake")
      : "lake";
  const lake = options.lake ?? process.env.LAKE_BIN ?? siblingLake;
  const execute = options.execute ?? runFormalCommand;
  const log = options.log ?? console.log;
  const builds = new Map<FormalModel, Promise<void>>();
  let buildTail = Promise.resolve();
  let toolchain: Promise<void> | undefined;

  function timed(phase: string, started: number): void {
    if (process.env.CI_PERF_LINT_FORMAL_TIMINGS === "1") {
      console.error(`[formal] ${phase}=${(performance.now() - started).toFixed(1)}ms`);
    }
  }

  function checkToolchain(): Promise<void> {
    return (toolchain ??= (async () => {
      const started = performance.now();
      const pin = (await Bun.file(path.join(directory, "lean-toolchain")).text()).trim();
      const expected = /^leanprover\/lean4:v([\w.-]+)$/.exec(pin)?.[1];
      if (!expected) {
        throw new Error(`Unsupported Lean toolchain pin: ${pin}`);
      }
      // Check the compiler Lake actually selects, not an unrelated PATH binary.
      const result = await execute([lake, "env", "lean", "--version"], directory, 1024 * 1024);
      if (result.code !== 0 || /\bversion ([\w.-]+)/.exec(result.stdout)?.[1] !== expected) {
        throw new Error(
          `Lean ${expected} required via Lake. Install elan or set LEAN_BIN/LAKE_BIN.\n${result.stdout}${result.stderr}`,
        );
      }
      timed("toolchain", started);
    })());
  }

  async function build(models: readonly FormalModel[] = formalModels): Promise<void> {
    const missing = [...new Set(models)].filter((model) => !builds.has(model));
    if (missing.length) {
      const pending = buildTail.then(async () => {
        await checkToolchain();
        const started = performance.now();
        const result = await execute(
          [lake, "build", ...missing.map((model) => executables[model])],
          directory,
          8 * 1024 * 1024,
        );
        const output = result.stdout + result.stderr;
        if (result.code !== 0) {
          throw new Error(`Lean build failed:\n${output}`);
        }
        if (/\bsorryAx\b/.test(output)) {
          throw new Error("Proof depends on sorryAx");
        }
        // Lake replays checked diagnostics even on a cache hit. Refuse missing
        // audit output instead of silently treating an empty build log as proof.
        for (const model of missing) {
          const source = await Bun.file(path.join(directory, `${model}.lean`)).text();
          const proofs = [...source.matchAll(/^\s*#print\s+axioms\s+([\w.]+)\s*$/gm)].map(
            (m) => m[1]!,
          );
          if (!proofs.length) {
            throw new Error(`No axiom audits declared in ${model}.lean`);
          }
          for (const proof of proofs) {
            if (
              !output.includes(`'${proof}' depends on axioms:`) &&
              !output.includes(`'${proof}' does not depend on any axioms`)
            ) {
              throw new Error(`Missing axiom audit for ${proof}`);
            }
          }
        }
        const audits = output
          .split("\n")
          .filter(
            (line) =>
              line.includes("depends on axioms:") || line.includes("does not depend on any axioms"),
          );
        if (audits.length) {
          log(audits.join("\n"));
        }
        timed(`build ${missing.join(",")}`, started);
      });
      buildTail = pending;
      for (const model of missing) {
        builds.set(model, pending);
      }
    }
    await Promise.all(models.map((model) => builds.get(model)));
  }

  async function run(model: FormalModel): Promise<string> {
    await build([model]);
    const started = performance.now();
    const suffix = process.platform === "win32" ? ".exe" : "";
    const binary = path.join(directory, ".lake", "build", "bin", executables[model] + suffix);
    const result = await execute([binary], directory, 64 * 1024 * 1024);
    if (result.code !== 0) {
      throw new Error(`Lean model ${model} failed:\n${result.stdout}${result.stderr}`);
    }
    timed(`generate ${model}`, started);
    return result.stdout;
  }

  return { build, run };
}

export const formalRunner = createFormalRunner();
