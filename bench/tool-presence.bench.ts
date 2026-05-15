import { readFileSync } from "node:fs";
import path from "node:path";
import { Bench } from "tinybench";
import { AhoCorasickAutomaton } from "../src/rules/shared/aho-corasick.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

interface PatternDef {
  key: string;
  regex: RegExp;
  keywords: string[];
}

const PATTERNS: PatternDef[] = [
  { key: "hasNpmEcosystem", regex: /actions\/setup-node@|\boven-sh\/setup-bun@|\bpnpm\/action-setup@|\bvolta-cli\/action@|\b(?:npm|pnpm|yarn|bun)\b|\b(?:eslint|oxlint|tsc|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/, keywords: ["actions/setup-node@", "oven-sh/setup-bun@", "pnpm/action-setup@", "volta-cli/action@", "npm", "pnpm", "yarn", "bun", "eslint", "oxlint", "tsc", "vitest", "jest", "next build", "vite build", "webpack", "rollup", "esbuild", "turbo", "nx"] },
  { key: "hasDockerBuild", regex: /docker\/build-push-action@|\bdocker\s+(?:buildx\s+build|build)\b/, keywords: ["docker/build-push-action@", "docker"] },
  { key: "hasTerraform", regex: /\bterraform\s+init\b/, keywords: ["terraform"] },
  { key: "hasPython", regex: /actions\/setup-python@|\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/, keywords: ["actions/setup-python@", "pip install", "python -m", "pytest", "tox", "poetry install"] },
  { key: "hasDatadog", regex: /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/, keywords: ["datadog/datadog-lambda-extension@", "public.ecr.aws/datadog/lambda-extension"] },
  { key: "hasElixir", regex: /erlef\/setup-beam@|\belixir\b|\bmix\b|container:\s*elixir:/, keywords: ["erlef/setup-beam@", "elixir", "mix"] },
  { key: "hasPythonSignal", regex: /\b(?:python|pip|uv|ruff|black|isort|tox|nox|hatch|pdm|pytest)\b/i, keywords: ["python", "pip", "uv", "ruff", "black", "isort", "tox", "nox", "hatch", "pdm", "pytest"] },
  { key: "hasRustSignal", regex: /\b(?:cargo|rustc|nextest)\b/i, keywords: ["cargo", "rustc", "nextest"] },
  { key: "hasElixirSignal", regex: /\b(?:elixir|erlang|otp|mix|setup-beam)\b/i, keywords: ["elixir", "erlang", "otp", "mix", "setup-beam"] },
  { key: "hasNativePackageSignal", regex: /\b(?:npm|pnpm|yarn|bun|node-gyp|prebuild|node-pre-gyp|pip|uv|maturin|setuptools)\b/i, keywords: ["npm", "pnpm", "yarn", "bun", "node-gyp", "prebuild", "node-pre-gyp", "pip", "uv", "maturin", "setuptools"] },
  { key: "hasEslintSignal", regex: /\b(?:eslint|oxlint)\b/i, keywords: ["eslint", "oxlint"] },
  { key: "hasPrettierSignal", regex: /\b(?:prettier|oxfmt)\b/i, keywords: ["prettier", "oxfmt"] },
  { key: "hasFrameworkSignal", regex: /\b(?:next|storybook|vite|astro|svelte|turbo|nx|lerna|gradle|gradlew|angular|rails|rspec|ruby\/setup-ruby)\b/i, keywords: ["next", "storybook", "vite", "astro", "svelte", "turbo", "nx", "lerna", "gradle", "gradlew", "angular", "rails", "rspec", "ruby/setup-ruby"] },
  { key: "hasTypeScriptSignal", regex: /\b(?:tsc|typescript|tsx|ts-jest)\b/i, keywords: ["tsc", "typescript", "tsx", "ts-jest"] },
  { key: "hasJestSignal", regex: /\b(?:jest|jsdom)\b/i, keywords: ["jest", "jsdom"] },
  { key: "hasTailwindSignal", regex: /\b(?:tailwind|postcss)\b/i, keywords: ["tailwind", "postcss"] },
  { key: "hasHuskySignal", regex: /\b(?:husky|lint-staged)\b/i, keywords: ["husky", "lint-staged"] },
  { key: "hasBabelSignal", regex: /\b(?:babel|@babel\/|core-js)\b/i, keywords: ["babel", "@babel/", "core-js"] },
  { key: "hasSparseCheckout", regex: /sparse-checkout/i, keywords: ["sparse-checkout"] },
  { key: "hasNpmRun", regex: /npm run/i, keywords: ["npm run"] },
  { key: "hasDockerBuildPushAction", regex: /docker\/build-push-action/, keywords: ["docker/build-push-action"] },
  { key: "hasDockerPush", regex: /--push/, keywords: ["--push"] },
  { key: "hasWebpackOrRspackOrBabel", regex: /\b(?:webpack|rspack|babel|ts-loader|fork-ts-checker|next build|vite build|storybook)\b/i, keywords: ["webpack", "rspack", "babel", "ts-loader", "fork-ts-checker", "next build", "vite build", "storybook"] },
  { key: "hasNpmOrPnpmOrYarnOrBun", regex: /\b(?:npm|pnpm|yarn|bun)\b/i, keywords: ["npm", "pnpm", "yarn", "bun"] },
];

function loadTextFixtures(): Map<string, string> {
  const entries: { label: string; filePath: string }[] = [
    { label: "small (sample ci.yml)", filePath: "sample-repo/.github/workflows/ci.yml" },
    { label: "medium (workflow-efficiency)", filePath: "workflow-efficiency-like/.github/workflows/ci.yml" },
    { label: "large (dd-trace-js)", filePath: "dd-trace-js/.github/workflows/test-optimization.yml" },
  ];

  const result = new Map<string, string>();
  for (const entry of entries) {
    try {
      const fullPath = path.join(fixturesDir, entry.filePath);
      result.set(entry.label, readFileSync(fullPath, "utf8").toLowerCase());
    } catch { /* skip if fixture unavailable */ }
  }

  const generatedLines: string[] = [];
  const template = [
    "steps:",
    "  - run: actions/checkout@v4",
    "  - run: npm ci",
    "  - run: npm test",
    "  - run: npx eslint .",
    "  - name: Build",
    "    run: docker build .",
  ];
  for (let i = 0; i < 100; i++) {generatedLines.push(...template);}
  result.set("generated-100x", generatedLines.join("\n").toLowerCase());

  return result;
}

function regexOnly(blob: string): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    m.set(p.key, p.regex.test(blob));
  }
  return m;
}

const allKeywords: string[] = [];
const kwToPatIdx: number[] = [];
for (let pi = 0; pi < PATTERNS.length; pi++) {
  for (const kw of PATTERNS[pi].keywords) {
    kwToPatIdx[allKeywords.length] = pi;
    allKeywords.push(kw);
  }
}

const acAuto = new AhoCorasickAutomaton(allKeywords);

function acThenRegex(blob: string): Map<string, boolean> {
  const matchedAc = acAuto.search(blob);
  const matchedPats = new Set<number>();
  for (const acIdx of matchedAc) {
    matchedPats.add(kwToPatIdx[acIdx]);
  }

  const m = new Map<string, boolean>();
  for (let pi = 0; pi < PATTERNS.length; pi++) {
    if (matchedPats.has(pi)) {
      PATTERNS[pi].regex.lastIndex = 0;
      m.set(PATTERNS[pi].key, PATTERNS[pi].regex.test(blob));
    } else {
      m.set(PATTERNS[pi].key, false);
    }
  }
  return m;
}

function acOnly(blob: string): Set<number> {
  return acAuto.search(blob);
}

const fixtures = loadTextFixtures();

const bench = new Bench({
  iterations: 50,
  time: 0,
  warmup: false,
});

for (const [label, blob] of fixtures) {
  const byteLen = new TextEncoder().encode(blob).length;
  const trimmedLabel = `${label} (${byteLen}b)`.replace(/\s+/g, " ");

  bench
    .add(`[old] regex-only ${trimmedLabel}`, () => { regexOnly(blob); })
    .add(`[new] ac+verify ${trimmedLabel}`, () => { acThenRegex(blob); })
    .add(`[new] ac-only   ${trimmedLabel}`, () => { acOnly(blob); });
}

export { bench };
