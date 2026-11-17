import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Coverage } from "./coverage.ts";
import { MAX_INPUT_BYTES, Rng, mutate } from "./mutator.ts";
import { retainCoverage } from "./retention.ts";

interface FuzzConfig {
  manifest: string;
  corpusDir: string;
  outDir: string;
  seed: number;
  maxMs: number;
  maxLength: number;
}

const config = JSON.parse(process.env.FUZZ_CONFIG ?? "{}") as FuzzConfig;
const corpusDir = path.resolve(config.corpusDir);
const outDir = path.resolve(config.outDir);
const corpusOut = path.join(outDir, "corpus");
const crashOut = path.join(outDir, "crashes");
await mkdir(corpusOut, { recursive: true });
await mkdir(crashOut, { recursive: true });
const currentPath = path.join(outDir, "current.bin");

const manifest = (await import(path.resolve(config.manifest))) as {
  fuzz: (data: Buffer) => unknown;
};
const rng = new Rng(config.seed);
const coverage = new Coverage();
await coverage.start();
const seen = new Set<string>();
const corpus: Buffer[] = [];
let inputs = 0;
let retained = 0;
let crashes = 0;
let coverageKeys = 0;

function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function saveCorpus(data: Buffer): Promise<void> {
  await writeFile(path.join(corpusOut, hash(data)), data);
}

async function saveCrash(data: Buffer, kind: string): Promise<void> {
  crashes += 1;
  await writeFile(path.join(crashOut, `${kind}-${hash(data)}`), data);
}

async function execute(data: Buffer): Promise<void> {
  await writeFile(currentPath, data);
  try {
    await manifest.fuzz(data);
  } catch {
    await saveCrash(data, "crash");
  }
  const keys = await coverage.take();
  const retention = retainCoverage(seen, keys);
  for (const key of retention.seen) {
    if (!seen.has(key)) {
      seen.add(key);
    }
  }
  const fresh = retention.fresh;
  coverageKeys = seen.size;
  if (fresh) {
    retained += 1;
    await saveCorpus(data);
    if (corpus.length < 5000) {
      corpus.push(data);
    }
  }
}

for (const entry of await readdir(corpusDir)) {
  const file = path.join(corpusDir, entry);
  try {
    const data = await readFile(file);
    corpus.push(data);
    await execute(data);
  } catch {
    // skip unreadable corpus entries
  }
}
if (corpus.length === 0) {
  corpus.push(Buffer.from("", "utf8"));
  await execute(corpus[0]!);
}
process.stdout.write(
  `${JSON.stringify({ type: "progress", inputs, coverageKeys, crashes, corpus: retained })}\n`,
);

const deadline = Date.now() + config.maxMs;
while (Date.now() < deadline) {
  const seed = corpus[rng.int(corpus.length)]!;
  const data = mutate(seed, rng, corpus, config.maxLength || MAX_INPUT_BYTES);
  await execute(data);
  inputs += 1;
  if (inputs % 100 === 0) {
    process.stdout.write(
      `${JSON.stringify({ type: "progress", inputs, coverageKeys, crashes, corpus: retained })}\n`,
    );
  }
}

await coverage.stop();
process.stdout.write(
  `${JSON.stringify({ type: "summary", inputs, coverageKeys, crashes, corpus: retained })}\n`,
);
