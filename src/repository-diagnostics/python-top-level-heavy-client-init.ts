import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "python-top-level-heavy-client-init",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/python-top-level-heavy-client-init.md",
} satisfies RuleMeta;

const frameworkSignalFileNames = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "setup.cfg",
  "tox.ini",
  "Pipfile",
  "poetry.lock",
  "uv.lock",
];

const lambdaSignalFileNames = [
  "serverless.yml",
  "serverless.yaml",
  "template.yml",
  "template.yaml",
  "samconfig.toml",
  "cdk.out/manifest.json",
  "cdk.json",
];

const heavyInitializerMatchers = [
  { label: "SQLAlchemy engine", pattern: /\bcreate_engine\s*\(/ },
  { label: "boto3 client/resource", pattern: /\bboto3\.(?:client|resource)\s*\(/ },
  { label: "Redis client", pattern: /\bredis\.(?:Redis|StrictRedis|from_url)\s*\(/ },
  { label: "MongoDB client", pattern: /\b(?:MongoClient|AsyncIOMotorClient)\s*\(/ },
  {
    label: "OpenAI client",
    pattern: /\b(?:OpenAI|AsyncOpenAI|AzureOpenAI|AsyncAzureOpenAI)\s*\(/,
  },
  { label: "Anthropic client", pattern: /\bAnthropic(?:Bedrock|Vertex)?\s*\(/ },
  { label: "Google GenAI client", pattern: /\bgenai\.Client\s*\(/ },
  { label: "Cohere client", pattern: /\bCohere(?:Async)?Client\s*\(/ },
  { label: "Weaviate client", pattern: /\bweaviate\.(?:Client|WeaviateClient)\s*\(/ },
  { label: "Pinecone client", pattern: /\b(?:Pinecone|PineconeGRPC)\s*\(/ },
  { label: "Hugging Face model", pattern: /\bAutoModel(?:For\w+)?\.from_pretrained\s*\(/ },
  { label: "Hugging Face tokenizer", pattern: /\bAutoTokenizer\.from_pretrained\s*\(/ },
  { label: "Transformers pipeline", pattern: /\bpipeline\s*\(/ },
  { label: "SentenceTransformer model", pattern: /\bSentenceTransformer\s*\(/ },
  { label: "spaCy model load", pattern: /\bspacy\.load\s*\(/ },
];

const heavyInitializerPrefilter = new RegExp(
  [
    "create_engine\\s*\\(",
    "boto3\\.(?:client|resource)\\s*\\(",
    "redis\\.(?:Redis|StrictRedis|from_url)\\s*\\(",
    "(?:MongoClient|AsyncIOMotorClient)\\s*\\(",
    "(?:OpenAI|AsyncOpenAI|AzureOpenAI|AsyncAzureOpenAI)\\s*\\(",
    "Anthropic(?:Bedrock|Vertex)?\\s*\\(",
    "genai\\.Client\\s*\\(",
    "Cohere(?:Async)?Client\\s*\\(",
    "weaviate\\.(?:Client|WeaviateClient)\\s*\\(",
    "(?:Pinecone|PineconeGRPC)\\s*\\(",
    "AutoModel(?:For\\w+)?\\.from_pretrained\\s*\\(",
    "AutoTokenizer\\.from_pretrained\\s*\\(",
    "pipeline\\s*\\(",
    "SentenceTransformer\\s*\\(",
    "spacy\\.load\\s*\\(",
  ].join("|"),
);

const topLevelAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/;
const placeholderOrProxyPattern =
  /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:None|cast\s*\(|typing\.cast\s*\(|LocalProxy\s*\()/;
const pathExcludePattern = /(?:^|\/)(?:tests?|scripts?|migrations)(?:\/|$)/i;
const lambdaPathPattern = /(?:^|\/)(?:lambda|lambdas|functions|handlers)(?:\/|$)/i;
const frameworkPattern = /\b(?:fastapi|starlette|django|flask)\b/i;
const lambdaTextPattern =
  /\b(?:lambda_handler|Mangum|aws_lambda_powertools|awslambdaric|chalice|AWS::Lambda::Function|lambda\.Function|_lambda\.Function)\b/;

interface TopLevelHit {
  label: string;
  line: number;
}

function assignmentTargetName(expression: string): string | undefined {
  const match = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1];
}

function parenBalance(text: string): number {
  let balance = 0;
  for (const char of text) {
    if (char === "(" || char === "[" || char === "{") {
      balance += 1;
    }
    if (char === ")" || char === "]" || char === "}") {
      balance -= 1;
    }
  }
  return balance;
}

async function repositoryUsesTargetFramework(context: RepositoryScanContext): Promise<boolean> {
  for (const fileName of frameworkSignalFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (text && frameworkPattern.test(text)) {
      return true;
    }
  }

  return false;
}

async function repositoryHasLambdaMarkers(context: RepositoryScanContext): Promise<boolean> {
  for (const fileName of lambdaSignalFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (
      text &&
      /(?:functions\s*:|handler\s*:|AWS::Lambda::Function|aws_lambda_powertools|awslambdaric|lambda\.Function|_lambda\.Function)/i.test(
        text,
      )
    ) {
      return true;
    }
  }

  for (const fileName of ["requirements.txt", "requirements-dev.txt", "dev-requirements.txt"]) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (text && /\b(?:awslambdaric|aws-lambda-powertools|mangum|chalice)\b/i.test(text)) {
      return true;
    }
  }

  return false;
}

function findHeavyInitializerLabel(expression: string): string | undefined {
  const targetName = assignmentTargetName(expression)?.toLowerCase();

  if (
    /\bpipeline\s*\(/.test(expression) &&
    targetName &&
    !/(?:model|pipeline|generator|classifier|embedder|encoder|decoder|qa|summarizer|translator)/.test(
      targetName,
    )
  ) {
    return undefined;
  }

  if (
    /\bspacy\.load\s*\(/.test(expression) &&
    targetName &&
    !/(?:nlp|model|pipeline|parser|tagger)/.test(targetName)
  ) {
    return undefined;
  }

  for (const matcher of heavyInitializerMatchers) {
    if (matcher.pattern.test(expression)) {
      return matcher.label;
    }
  }
  return undefined;
}

function collectTopLevelHeavyInitializerHits(text: string): TopLevelHit[] {
  const lines = text.split("\n");
  const hits: TopLevelHit[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }
    if (/^[ \t]/.test(line)) {
      continue;
    }
    if (!topLevelAssignmentPattern.test(line)) {
      continue;
    }
    if (placeholderOrProxyPattern.test(line)) {
      continue;
    }

    let expression = line.trim();
    let balance = parenBalance(line);
    let endIndex = index;

    while (
      (balance > 0 || /[([{,\\]\s*$/.test(lines[endIndex] ?? "")) &&
      endIndex + 1 < lines.length
    ) {
      endIndex += 1;
      const nextLine = lines[endIndex] ?? "";
      expression += `\n${nextLine.trim()}`;
      balance += parenBalance(nextLine);
    }

    const label = findHeavyInitializerLabel(expression);
    if (label) {
      hits.push({ label, line: index + 1 });
    }

    index = endIndex;
  }

  return hits;
}

export async function collectPythonTopLevelHeavyClientInitDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (!(await repositoryUsesTargetFramework(context))) {
    return [];
  }

  const repositoryHasLambdaHints = await repositoryHasLambdaMarkers(context);
  const diagnostics: Diagnostic[] = [];

  for await (const relativePath of context.walkFilesIter(".", {
    include: (candidate) => /^src\/.*\.py$/i.test(candidate) && !pathExcludePattern.test(candidate),
    cacheKey: "src-python-files",
  })) {
    if (repositoryHasLambdaHints && lambdaPathPattern.test(relativePath)) {
      continue;
    }

    const text = await context.readTextFileOrWarn(context.resolve(relativePath));
    if (!text) {
      continue;
    }
    if (!heavyInitializerPrefilter.test(text)) {
      continue;
    }
    if (repositoryHasLambdaHints && lambdaTextPattern.test(text)) {
      continue;
    }

    const hits = collectTopLevelHeavyInitializerHits(text);
    for (const hit of hits) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: relativePath,
            line: hit.line,
            column: 1,
          },
          message: `${relativePath} initializes ${hit.label} at module top level.`,
          why: "Creating clients, connections, or model loads during module import adds startup cost to ordinary imports, can trigger network or auth work too early, and makes web app startup and worker reuse less predictable.",
          suggestion:
            "Move heavy client, connection, or model initialization behind a lazy getter, app startup hook, or dependency injection boundary instead of importing it eagerly at module load time.",
          measurementHint:
            "Compare app startup latency, import-time overhead, and memory usage before and after deferring the initialization.",
          aiHandoff: `Refactor ${relativePath} so the heavy initializer is created lazily or during explicit app startup, while preserving existing call sites and lifecycle behavior.`,
          score: 50,
        }),
      );
    }
  }

  return diagnostics;
}
