export const rootOnlyArtifactDirs = ["runs"] as const;

export const subdirArtifactDirs = [
  ".ipynb_checkpoints",
  "wandb",
  "mlruns",
  "mlflow",
  "lightning_logs",
  "outputs",
  "experiments",
  "checkpoints",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  "htmlcov",
  ".coverage",
] as const;

export const experimentalArtifactDirs = [...rootOnlyArtifactDirs, ...subdirArtifactDirs] as const;

export const experimentalArtifactPatterns = [
  ...rootOnlyArtifactDirs.map((dir) => new RegExp(`^${dir}/`)),
  ...subdirArtifactDirs.map((dir) => new RegExp(`(^|/)${dir}/`)),
];
