import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

const originalBunSpawnSync = Bun.spawnSync;

afterEach(() => {
  Bun.spawnSync = originalBunSpawnSync;
});

describe("analyzeRepository repo-aware and tooling rules: cdk repository diagnostics", () => {
  test("detects BucketDeployment without memoryLimit", async () => {
    const report = await getFixtureReport(fixtures.cdkBucketDeploymentMemoryLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (c) => c.ruleId === "cdk-bucket-deployment-memory-unconfigured",
    );
    expect(finding).toBeDefined();
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.docsPath).toBe("docs/rules/cdk-bucket-deployment-memory-unconfigured.md");
    expect(finding?.location.path).toBe("lib/deployment-stack.ts");
    expect(finding?.message).toContain("without memoryLimit");
  });

  test("does not flag BucketDeployment with memoryLimit set", async () => {
    const report = await getFixtureReport(fixtures.cdkBucketDeploymentMemoryOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "cdk-bucket-deployment-memory-unconfigured"),
    ).toBe(false);
  });

  test("detects BucketDeployment without memoryLimit even without CDK package metadata", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-bucket-usage-only-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const libDir = path.join(fixtureRoot, "lib");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(libDir, { recursive: true });

    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk-usage-only"}');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );
    await writeFile(
      path.join(libDir, "deployment-stack.ts"),
      [
        'import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";',
        "",
        // intentional: no memoryLimit to trigger cdk-bucket-deployment-memory-unconfigured
        "new BucketDeployment(this, 'DeploySite', {",
        "  destinationBucket: bucket,",
        "  sources: [],",
        "});",
        "",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "cdk-bucket-deployment-memory-unconfigured"),
    ).toBe(true);
  });

  test("falls back when rg is unavailable and still detects BucketDeployment usage", async () => {
    Bun.spawnSync = ((cmd, options) => {
      if (Array.isArray(cmd) && cmd[0] === "rg") {
        return {
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          success: false,
          exitCode: null,
          signalCode: null,
          error: new Error("spawn rg ENOENT"),
        };
      }

      return originalBunSpawnSync(cmd, options as Parameters<typeof Bun.spawnSync>[1]);
    }) as typeof Bun.spawnSync;

    const fixtureRoot = await tempDirs.create("apl-cdk-rg-fallback-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const libDir = path.join(fixtureRoot, "lib");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(libDir, { recursive: true });

    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk-rg-fallback"}');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );
    await writeFile(
      path.join(libDir, "deployment-stack.ts"),
      [
        'import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";',
        "",
        // intentional: no memoryLimit to trigger cdk-bucket-deployment-memory-unconfigured
        "new BucketDeployment(this, 'DeploySite', {",
        "  destinationBucket: bucket,",
        "  sources: [],",
        "});",
        "",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "cdk-bucket-deployment-memory-unconfigured"),
    ).toBe(true);
  });

  test("returns early when rg finds no BucketDeployment usage (exit code 1, no fallback)", async () => {
    Bun.spawnSync = ((cmd, options) => {
      if (Array.isArray(cmd) && cmd[0] === "rg") {
        return {
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          success: true,
          exitCode: 1,
          signalCode: null,
        };
      }

      return originalBunSpawnSync(cmd, options as Parameters<typeof Bun.spawnSync>[1]);
    }) as typeof Bun.spawnSync;

    const fixtureRoot = await tempDirs.create("apl-cdk-rg-no-matches-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk-rg-no-matches"}');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "cdk-bucket-deployment-memory-unconfigured"),
    ).toBe(false);
    // No analysis warnings means rg failure didn't trigger fallback walk
    expect(report.analysisWarnings).toHaveLength(0);
  });

  test("detects waste files in CDK assets", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-asset-waste-");
    const cdkOutDir = path.join(fixtureRoot, "cdk.out", "asset123456789abcdef");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(cdkOutDir, { recursive: true });
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test-cdk", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: {
          Asset123456789abcdef: {
            type: "aws:cdk:asset",
            path: "asset123456789abcdef",
            id: "Asset123456789abcdef",
            packaging: "zip",
          },
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n      - run: npm ci\n",
    );
    await writeFile(path.join(cdkOutDir, "index.js"), "exports.handler = async () => {};");
    await writeFile(path.join(cdkOutDir, "index.test.js"), 'test("handler", () => {});');
    await writeFile(path.join(cdkOutDir, "README.md"), "# Asset\n\nDescription.");
    await writeFile(path.join(cdkOutDir, "data.csv"), `col0,col1\n${"0,1\n".repeat(100)}`);

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "cdk-asset-waste-files");
    expect(finding).toBeDefined();
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.docsPath).toBe("docs/rules/cdk-asset-waste-files.md");
    expect(finding?.message).toContain("unnecessary file");
    expect(finding?.message).toContain("Asset123456789abcdef");
  }, 60000);

  test("does not flag CDK assets without waste files", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-asset-clean-");
    const cdkOutDir = path.join(fixtureRoot, "cdk.out", "asset123456789abcdef");
    await mkdir(cdkOutDir, { recursive: true });

    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test-cdk", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: {
          Asset123456789abcdef: {
            type: "aws:cdk:asset",
            path: "asset123456789abcdef",
            id: "Asset123456789abcdef",
            packaging: "zip",
          },
        },
      }),
    );
    await writeFile(path.join(cdkOutDir, "index.js"), "exports.handler = async () => {};");
    await writeFile(path.join(cdkOutDir, "config.csv"), "key,value\nfoo,bar\n");

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "cdk-asset-waste-files")).toBe(false);
  });

  test("detects CDK manifest findings without aws-cdk-lib dependency metadata", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-manifest-only-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "cdk.out"), { recursive: true });

    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk-manifest-only"}');
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: {
          Asset1111111111: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset1111111111",
              sourceHash: "aabb11223344aabb11223344aabb11223344aabb11223344aabb11223344aabb",
            },
          },
          Asset2222222222: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset2222222222",
              sourceHash: "aabb11223344aabb11223344aabb11223344aabb11223344aabb11223344aabb",
            },
          },
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "cdk-duplicate-asset-hash")).toBe(true);
  });

  test("detects experimental artifact dirs in CDK assets at any depth", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-artifact-subdir-");
    const cdkOutDir = path.join(fixtureRoot, "cdk.out", "asset123");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(path.join(cdkOutDir, "src", "wandb", "run1"), { recursive: true });
    await mkdir(path.join(cdkOutDir, "models", "lightning_logs", "version_0"), { recursive: true });
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: { Asset123: { type: "aws:cdk:asset", path: "asset123", id: "Asset123" } },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );
    await writeFile(path.join(cdkOutDir, "index.js"), "exports.handler = async () => {};");
    await writeFile(path.join(cdkOutDir, "src", "wandb", "run1", "metrics.json"), '{"loss": 0.1}');
    await writeFile(
      path.join(cdkOutDir, "models", "lightning_logs", "version_0", "hparams.yaml"),
      "lr: 0.001\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "cdk-asset-waste-files");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("wandb");
    expect(finding?.message).toContain("lightning_logs");
  });

  test("detects runs only at root in CDK assets", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-runs-root-only-");
    const cdkOutDir = path.join(fixtureRoot, "cdk.out", "asset123");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(path.join(cdkOutDir, "runs", "run1"), { recursive: true });
    await mkdir(path.join(cdkOutDir, "lib", "runs", "run2"), { recursive: true });
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: { Asset123: { type: "aws:cdk:asset", path: "asset123", id: "Asset123" } },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n",
    );
    await writeFile(path.join(cdkOutDir, "index.js"), "exports.handler = async () => {};");
    await writeFile(path.join(cdkOutDir, "runs", "run1", "log.txt"), "root runs\n");
    await writeFile(path.join(cdkOutDir, "lib", "runs", "run2", "log.txt"), "subdir runs\n");

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "cdk-asset-waste-files");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("runs/");
    expect(finding?.message).not.toContain("lib/runs");
  });

  test("detects duplicate CDK asset hashes", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-dup-hash-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "cdk.out"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test-cdk", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: {
          Asset1111111111: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset1111111111",
              sourceHash: "aabb11223344aabb11223344aabb11223344aabb11223344aabb11223344aabb",
            },
          },
          Asset2222222222: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset2222222222",
              sourceHash: "aabb11223344aabb11223344aabb11223344aabb11223344aabb11223344aabb",
            },
          },
          Asset3333333333: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset3333333333",
              sourceHash: "ccdd11223344ccdd11223344ccdd11223344ccdd11223344ccdd11223344ccdd",
            },
          },
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n      - run: npm ci\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "cdk-duplicate-asset-hash");
    expect(finding).toBeDefined();
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.docsPath).toBe("docs/rules/cdk-duplicate-asset-hash.md");
    expect(finding?.message).toContain("2 CDK assets share the same source hash");
    expect(finding?.message).toContain("Asset1111111111");
    expect(finding?.message).toContain("Asset2222222222");
    expect(finding?.message).not.toContain("Asset3333333333");
    expect(finding?.score).toBe(70);
  });

  test("does not flag CDK assets with unique hashes", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-uniq-hash-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "cdk.out"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "test-cdk", "dependencies": {"aws-cdk-lib": "^2.0.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "cdk.out", "manifest.json"),
      JSON.stringify({
        version: "18.0.0",
        artifacts: {
          Asset1111111111: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset1111111111",
              sourceHash: "aabb11223344aabb11223344aabb11223344aabb11223344aabb11223344aabb",
            },
          },
          Asset2222222222: {
            type: "aws:cdk:asset",
            properties: {
              path: "asset2222222222",
              sourceHash: "ccdd11223344ccdd11223344ccdd11223344ccdd11223344ccdd11223344ccdd",
            },
          },
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n      - run: npm ci\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "cdk-duplicate-asset-hash")).toBe(false);
  });

  test("does not flag when manifest is missing", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-no-manifest-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk"}');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n      - run: npm ci\n",
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "cdk-duplicate-asset-hash")).toBe(false);
  });
});
