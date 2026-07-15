import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { getTerraformFileIndex } from "../src/repository-diagnostics/terraform-files.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(() => tempDirs.cleanup());

describe("terraform file index", () => {
  test("caches ordered Terraform files and ignores generated directories", async () => {
    const repoRoot = await tempDirs.create("apl-terraform-files-");
    await mkdir(path.join(repoRoot, "modules"));
    await mkdir(path.join(repoRoot, ".terraform"));
    await writeFile(path.join(repoRoot, "main.tf"), 'resource "example" "main" {}\n');
    await writeFile(path.join(repoRoot, "modules", "child.tf"), 'resource "example" "child" {}\n');
    await writeFile(path.join(repoRoot, ".terraform.lock.hcl"), "provider lock\n");
    await writeFile(path.join(repoRoot, ".terraform", "generated.tf"), "ignored\n");

    const context = new RepositoryScanContext(repoRoot, []);
    const indexLoad = getTerraformFileIndex(context);

    expect(getTerraformFileIndex(context)).toBe(indexLoad);
    expect(await indexLoad).toEqual({
      files: [
        { relativePath: "main.tf", content: 'resource "example" "main" {}\n' },
        { relativePath: "modules/child.tf", content: 'resource "example" "child" {}\n' },
      ],
      lockFiles: [".terraform.lock.hcl"],
    });
  });
});
