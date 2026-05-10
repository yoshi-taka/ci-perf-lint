import { AhoCorasickAutomaton } from "./aho-corasick.ts";

interface ToolPresenceSpec {
  key: string;
  regex: RegExp;
  keywords: string[];
}

const TOOL_PRESENCE_SPECS: ToolPresenceSpec[] = [
  {
    key: "hasNpmEcosystem",
    regex:
      /actions\/setup-node@|\boven-sh\/setup-bun@|\bpnpm\/action-setup@|\bvolta-cli\/action@|\b(?:npm|pnpm|yarn|bun)\b|\b(?:eslint|oxlint|tsc|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/,
    keywords: [
      "actions/setup-node@",
      "oven-sh/setup-bun@",
      "pnpm/action-setup@",
      "volta-cli/action@",
      "npm",
      "pnpm",
      "yarn",
      "bun",
      "eslint",
      "oxlint",
      "tsc",
      "vitest",
      "jest",
      "next build",
      "vite build",
      "webpack",
      "rollup",
      "esbuild",
      "turbo",
      "nx",
    ],
  },
  {
    key: "hasDockerBuild",
    regex: /docker\/build-push-action@|\bdocker\s+(?:buildx\s+build|build)\b/,
    keywords: ["docker/build-push-action@", "docker"],
  },
  {
    key: "hasTerraform",
    regex: /\bterraform\s+init\b/,
    keywords: ["terraform"],
  },
  {
    key: "hasPython",
    regex: /actions\/setup-python@|\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/,
    keywords: [
      "actions/setup-python@",
      "pip install",
      "python -m",
      "pytest",
      "tox",
      "poetry install",
    ],
  },
  {
    key: "hasDatadog",
    regex: /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/,
    keywords: ["datadog/datadog-lambda-extension@", "public.ecr.aws/datadog/lambda-extension"],
  },
  {
    key: "hasElixir",
    regex: /erlef\/setup-beam@|\belixir\b|\bmix\b|container:\s*elixir:/,
    keywords: ["erlef/setup-beam@", "elixir", "mix"],
  },
  {
    key: "hasPythonSignal",
    regex: /\b(?:python|pip|uv|ruff|black|isort|tox|nox|hatch|pdm|pytest)\b/i,
    keywords: [
      "python",
      "pip",
      "uv",
      "ruff",
      "black",
      "isort",
      "tox",
      "nox",
      "hatch",
      "pdm",
      "pytest",
    ],
  },
  {
    key: "hasRustSignal",
    regex: /\b(?:cargo|rustc|nextest)\b/i,
    keywords: ["cargo", "rustc", "nextest"],
  },
  {
    key: "hasElixirSignal",
    regex: /\b(?:elixir|erlang|otp|mix|setup-beam)\b/i,
    keywords: ["elixir", "erlang", "otp", "mix", "setup-beam"],
  },
  {
    key: "hasNativePackageSignal",
    regex: /\b(?:npm|pnpm|yarn|bun|node-gyp|prebuild|node-pre-gyp|pip|uv|maturin|setuptools)\b/i,
    keywords: [
      "npm",
      "pnpm",
      "yarn",
      "bun",
      "node-gyp",
      "prebuild",
      "node-pre-gyp",
      "pip",
      "uv",
      "maturin",
      "setuptools",
    ],
  },
  {
    key: "hasEslintSignal",
    regex: /\b(?:eslint|oxlint)\b/i,
    keywords: ["eslint", "oxlint"],
  },
  {
    key: "hasPrettierSignal",
    regex: /\b(?:prettier|oxfmt)\b/i,
    keywords: ["prettier", "oxfmt"],
  },
  {
    key: "hasFrameworkSignal",
    regex:
      /\b(?:next|storybook|vite|astro|svelte|turbo|nx|lerna|gradle|gradlew|angular|rails|rspec|ruby\/setup-ruby)\b/i,
    keywords: [
      "next",
      "storybook",
      "vite",
      "astro",
      "svelte",
      "turbo",
      "nx",
      "lerna",
      "gradle",
      "gradlew",
      "angular",
      "rails",
      "rspec",
      "ruby/setup-ruby",
    ],
  },
  {
    key: "hasTypeScriptSignal",
    regex: /\b(?:tsc|typescript|tsx|ts-jest)\b/i,
    keywords: ["tsc", "typescript", "tsx", "ts-jest"],
  },
  {
    key: "hasJestSignal",
    regex: /\b(?:jest|jsdom)\b/i,
    keywords: ["jest", "jsdom"],
  },
  {
    key: "hasTailwindSignal",
    regex: /\b(?:tailwind|postcss)\b/i,
    keywords: ["tailwind", "postcss"],
  },
  {
    key: "hasHuskySignal",
    regex: /\b(?:husky|lint-staged)\b/i,
    keywords: ["husky", "lint-staged"],
  },
  {
    key: "hasBabelSignal",
    regex: /\b(?:babel|@babel\/|core-js)\b/i,
    keywords: ["babel", "@babel/", "core-js"],
  },
  {
    key: "hasSparseCheckout",
    regex: /sparse-checkout/i,
    keywords: ["sparse-checkout"],
  },
  {
    key: "hasNpmRun",
    regex: /npm run/i,
    keywords: ["npm run"],
  },
  {
    key: "hasDockerBuildPushAction",
    regex: /docker\/build-push-action/,
    keywords: ["docker/build-push-action"],
  },
  {
    key: "hasDockerPush",
    regex: /--push/,
    keywords: ["--push"],
  },
  {
    key: "hasWebpackOrRspackOrBabel",
    regex:
      /\b(?:webpack|rspack|babel|ts-loader|fork-ts-checker|next build|vite build|storybook)\b/i,
    keywords: [
      "webpack",
      "rspack",
      "babel",
      "ts-loader",
      "fork-ts-checker",
      "next build",
      "vite build",
      "storybook",
    ],
  },
  {
    key: "hasNpmOrPnpmOrYarnOrBun",
    regex: /\b(?:npm|pnpm|yarn|bun)\b/i,
    keywords: ["npm", "pnpm", "yarn", "bun"],
  },
];

interface BuiltAutomaton {
  automaton: AhoCorasickAutomaton;
  keywordIndexToToolKey: number[];
  allKeywords: string[];
}

let cachedAutomaton: BuiltAutomaton | null = null;

function ensureAutomaton(): BuiltAutomaton {
  if (cachedAutomaton) {
    return cachedAutomaton;
  }

  const allKeywords: string[] = [];
  const keywordIndexToToolKey: number[] = [];

  let specIndex = 0;
  for (const spec of TOOL_PRESENCE_SPECS) {
    for (const kw of spec.keywords) {
      keywordIndexToToolKey.push(specIndex);
      allKeywords.push(kw);
    }
    specIndex++;
  }

  const automaton = new AhoCorasickAutomaton(allKeywords);

  cachedAutomaton = { automaton, keywordIndexToToolKey, allKeywords };
  return cachedAutomaton;
}

export interface ToolPresenceResult {
  presence: ReadonlyMap<string, boolean>;
  matches: ReadonlySet<string>;
}

export function detectToolPresence(blob: string): ToolPresenceResult {
  const { automaton, keywordIndexToToolKey } = ensureAutomaton();
  const matchedAcIndices = automaton.search(blob);

  const matchedKeys = new Set<string>();

  for (const acIdx of matchedAcIndices) {
    matchedKeys.add(TOOL_PRESENCE_SPECS[keywordIndexToToolKey[acIdx]!]!.key);
  }

  const presence = new Map<string, boolean>();

  for (const spec of TOOL_PRESENCE_SPECS) {
    if (matchedKeys.has(spec.key)) {
      spec.regex.lastIndex = 0;
      presence.set(spec.key, spec.regex.test(blob));
    } else {
      presence.set(spec.key, false);
    }
  }

  return { presence, matches: matchedKeys };
}
