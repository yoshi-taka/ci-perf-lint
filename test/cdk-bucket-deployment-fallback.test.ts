import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectCdkBucketDeploymentMemoryDiagnostics } from "../src/repository-diagnostics/cdk-bucket-deployment-memory.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import type { WorkflowDocument } from "../src/workflow.ts";

describe("cdk-bucket-deployment fallback (no rg)", () => {
  test("detects BucketDeployment via walkFiles when rg unavailable", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-cdk-"));
    try {
      await mkdir(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      await mkdir(path.join(tmpDir, "lib"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".github", "workflows", "ci.yml"),
        "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
      );
      await writeFile(
        path.join(tmpDir, "lib", "stack.ts"),
        [
          'import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";',
          "new BucketDeployment(this, 'Assets', {",
          "  sources: [Source.asset('./assets')],",
          "  destinationBucket: bucket,",
          "});",
        ].join("\n"),
      );

      const signals = { usesCdk: true } as unknown as RepositorySignals;
      const scanContext = new RepositoryScanContext(tmpDir, []);
      const diagnostics = await collectCdkBucketDeploymentMemoryDiagnostics(
        tmpDir,
        signals,
        [] as unknown as WorkflowDocument[],
        [],
        scanContext,
      );

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]!.ruleId).toBe("cdk-bucket-deployment-memory-unconfigured");
      expect(diagnostics[0]!.location.path).toContain("stack.ts");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns empty when no BucketDeployment usage", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-cdk-"));
    try {
      await mkdir(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      await mkdir(path.join(tmpDir, "lib"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".github", "workflows", "ci.yml"),
        "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
      );
      await writeFile(
        path.join(tmpDir, "lib", "stack.ts"),
        "export class MyStack extends Stack {}\n",
      );

      const signals = { usesCdk: true } as unknown as RepositorySignals;
      const scanContext = new RepositoryScanContext(tmpDir, []);
      const diagnostics = await collectCdkBucketDeploymentMemoryDiagnostics(
        tmpDir,
        signals,
        [] as unknown as WorkflowDocument[],
        [],
        scanContext,
      );

      expect(diagnostics.length).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
