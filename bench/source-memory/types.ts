export interface ExpectedFacts {
  imports: number;
  snapshots: number;
  barrels: number;
}

export interface MemoryScenario {
  name: string;
  directory: string;
  components: number | null;
  projects: number | null;
  sourceFiles: number | null;
  sourceBytes: number | null;
  expected?: ExpectedFacts;
  surfaces: ("source" | "cli")[];
}

export interface MemoryVariant {
  label: "before" | "after";
  commit: string;
  directory: string;
  backend: "native" | "embedded-oxlint";
}

export interface MemoryOptions {
  before: string;
  after: string;
  runs: number;
  components: number;
  projects: number;
  memoryMiB: number;
  timeoutMs: number;
  workDir: string;
  outputDir: string;
  node: string;
  target?: string;
  cases?: string[];
  help: boolean;
}
