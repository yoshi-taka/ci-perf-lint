import type { Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

interface WorkflowTarget {
  repoRoot: string;
  workflowDirs: string[];
  selectedWorkflowFile?: string;
  rootWorkflowFiles?: string[];
}

function isBuildkiteWorkflowDir(workflowDir: string): boolean {
  const baseName = path.basename(workflowDir);
  return baseName === ".buildkite" || baseName === "buildkite";
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

async function findCiDirs(baseDir: string): Promise<string[]> {
  const dirs: string[] = [];
  const githubWorkflows = path.join(baseDir, ".github", "workflows");
  const buildkiteDir = path.join(baseDir, ".buildkite");
  const buildkiteDirAlt = path.join(baseDir, "buildkite");
  const depotWorkflows = path.join(baseDir, ".depot", "workflows");

  const [isGh, isBk, isBkAlt, isDepot] = await Promise.all([
    isDirectory(githubWorkflows),
    isDirectory(buildkiteDir),
    isDirectory(buildkiteDirAlt),
    isDirectory(depotWorkflows),
  ]);

  if (isGh) {
    dirs.push(githubWorkflows);
  }
  if (isBk) {
    dirs.push(buildkiteDir);
  }
  if (isBkAlt) {
    dirs.push(buildkiteDirAlt);
  }
  if (isDepot) {
    dirs.push(depotWorkflows);
  }

  return dirs;
}

export async function resolveWorkflowTarget(inputPath: string): Promise<WorkflowTarget> {
  const normalizedPath = path.resolve(inputPath);
  const baseName = path.basename(normalizedPath);
  const parentName = path.basename(path.dirname(normalizedPath));
  const grandparentName = path.basename(path.dirname(path.dirname(normalizedPath)));

  let stats: Stats;
  try {
    stats = await stat(normalizedPath);
  } catch {
    throw new Error(`Target path not found: ${normalizedPath}`);
  }
  const targetIsDir = stats.isDirectory();
  const targetIsFile = stats.isFile();

  // GitHub Actions: workflows directory
  if (baseName === "workflows" && targetIsDir) {
    return {
      repoRoot: path.dirname(path.dirname(normalizedPath)),
      workflowDirs: [normalizedPath],
    };
  }

  // GitHub Actions: .github directory
  if (baseName === ".github" && targetIsDir) {
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [path.join(normalizedPath, "workflows")],
    };
  }

  // GitHub Actions: specific workflow file
  if (
    parentName === "workflows" &&
    grandparentName === ".github" &&
    /\.(ya?ml)$/i.test(baseName) &&
    targetIsFile
  ) {
    return {
      repoRoot: path.dirname(path.dirname(path.dirname(normalizedPath))),
      workflowDirs: [path.dirname(normalizedPath)],
      selectedWorkflowFile: normalizedPath,
    };
  }

  // Buildkite: .buildkite directory
  if (baseName === ".buildkite" && targetIsDir) {
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [normalizedPath],
    };
  }

  // Buildkite: buildkite directory (non-hidden)
  if (baseName === "buildkite" && targetIsDir) {
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [normalizedPath],
    };
  }

  // Buildkite: specific pipeline file
  if (
    (parentName === ".buildkite" || parentName === "buildkite") &&
    /pipeline\.(ya?ml|json)$/i.test(baseName) &&
    targetIsFile
  ) {
    return {
      repoRoot: path.dirname(path.dirname(normalizedPath)),
      workflowDirs: [path.dirname(normalizedPath)],
      selectedWorkflowFile: normalizedPath,
    };
  }

  // Depot CI: .depot/workflows directory
  if (baseName === "workflows" && parentName === ".depot" && targetIsDir) {
    return {
      repoRoot: path.dirname(path.dirname(normalizedPath)),
      workflowDirs: [normalizedPath],
    };
  }

  // Depot CI: .depot directory
  if (baseName === ".depot" && targetIsDir) {
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [path.join(normalizedPath, "workflows")],
    };
  }

  // Depot CI: specific workflow file
  if (
    parentName === "workflows" &&
    grandparentName === ".depot" &&
    /\.(ya?ml)$/i.test(baseName) &&
    targetIsFile
  ) {
    return {
      repoRoot: path.dirname(path.dirname(path.dirname(normalizedPath))),
      workflowDirs: [path.dirname(normalizedPath)],
      selectedWorkflowFile: normalizedPath,
    };
  }

  // CircleCI: specific .circleci/config.yml file
  if (
    (baseName === "config.yml" || baseName === "config.yaml") &&
    parentName === ".circleci" &&
    targetIsFile
  ) {
    return {
      repoRoot: path.dirname(path.dirname(normalizedPath)),
      workflowDirs: [],
      rootWorkflowFiles: [normalizedPath],
    };
  }

  // CircleCI: .circleci directory
  if (baseName === ".circleci" && targetIsDir) {
    const configYml = path.join(normalizedPath, "config.yml");
    const configYaml = path.join(normalizedPath, "config.yaml");
    const [hasYml, hasYaml] = await Promise.all([isFile(configYml), isFile(configYaml)]);
    const cfgFiles: string[] = [];
    if (hasYml) {
      cfgFiles.push(configYml);
    }
    if (hasYaml) {
      cfgFiles.push(configYaml);
    }
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [],
      rootWorkflowFiles: cfgFiles.length > 0 ? cfgFiles : undefined,
    };
  }

  // GitLab CI: specific .gitlab-ci.yml file
  if (/\.gitlab-ci\.(ya?ml)$/i.test(baseName) && targetIsFile) {
    return {
      repoRoot: path.dirname(normalizedPath),
      workflowDirs: [],
      rootWorkflowFiles: [normalizedPath],
    };
  }

  // Default: scan repo root for CI dirs and repo-root CI files
  const ciDirs = await findCiDirs(normalizedPath);
  const gitlabCiYml = path.join(normalizedPath, ".gitlab-ci.yml");
  const gitlabCiYaml = path.join(normalizedPath, ".gitlab-ci.yaml");
  const circleCiCfg = path.join(normalizedPath, ".circleci", "config.yml");
  const circleCiCfgYaml = path.join(normalizedPath, ".circleci", "config.yaml");
  const [hasGlYml, hasGlYaml, hasCcYml, hasCcYaml] = await Promise.all([
    isFile(gitlabCiYml),
    isFile(gitlabCiYaml),
    isFile(circleCiCfg),
    isFile(circleCiCfgYaml),
  ]);
  const rootFiles: string[] = [];
  if (hasGlYml) {
    rootFiles.push(gitlabCiYml);
  }
  if (hasGlYaml) {
    rootFiles.push(gitlabCiYaml);
  }
  if (hasCcYml) {
    rootFiles.push(circleCiCfg);
  }
  if (hasCcYaml) {
    rootFiles.push(circleCiCfgYaml);
  }
  return {
    repoRoot: normalizedPath,
    workflowDirs: ciDirs.length > 0 ? ciDirs : [path.join(normalizedPath, ".github", "workflows")],
    rootWorkflowFiles: rootFiles.length > 0 ? rootFiles : undefined,
  };
}

async function listWorkflowFiles(workflowDir: string): Promise<string[]> {
  const entries = await readdir(workflowDir, { withFileTypes: true }).catch(() => []);
  const filePattern = isBuildkiteWorkflowDir(workflowDir)
    ? /(?:pipeline\.(?:ya?ml|json)|.+\.ya?ml)$/i
    : /\.(ya?ml)$/i;

  return entries
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => path.join(workflowDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function collectWorkflowFiles(target: WorkflowTarget): Promise<string[]> {
  if (target.selectedWorkflowFile) {
    return [target.selectedWorkflowFile];
  }

  const allFiles: string[] = [];
  for (const workflowDir of target.workflowDirs) {
    const files = await listWorkflowFiles(workflowDir);
    allFiles.push(...files);
  }

  if (target.rootWorkflowFiles) {
    allFiles.push(...target.rootWorkflowFiles);
  }

  return allFiles.sort((left, right) => left.localeCompare(right));
}
