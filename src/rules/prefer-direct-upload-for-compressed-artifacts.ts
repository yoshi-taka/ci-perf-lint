import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { Node } from "yaml";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isScalar } from "yaml";

const meta = {
  id: "prefer-direct-upload-for-compressed-artifacts",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-direct-upload-for-compressed-artifacts.md",
} satisfies RuleMeta;

const USELESS_COMPRESSION_EXTENSIONS = new Set([
  ".zip",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".zst",
  ".lz4",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".elf",
  ".o",
  ".obj",
  ".a",
  ".lib",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".flv",
  ".wmv",
  ".webm",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
]);

function getMajorVersion(uses: string, usesNode: Node | undefined): number | undefined {
  const directMatch = uses.match(/@v(\d+)(?:\.\d+)*(?:[-+].*)?$/i);
  if (directMatch?.[1]) {
    return parseInt(directMatch[1], 10);
  }

  const comment = isScalar(usesNode) ? usesNode.comment : undefined;
  if (comment) {
    const commentMatch = comment.match(/(?:ratchet:[^@]*@)?v?(\d+)/i);
    if (commentMatch?.[1]) {
      return parseInt(commentMatch[1], 10);
    }
  }

  return undefined;
}

function getSingleFilePath(pathValue: unknown): string | undefined {
  if (typeof pathValue === "string") {
    const trimmed = pathValue.trim();
    if (trimmed.includes("\n")) {
      return undefined;
    }
    return trimmed;
  }
  if (Array.isArray(pathValue) && pathValue.length === 1 && typeof pathValue[0] === "string") {
    return pathValue[0].trim();
  }
  return undefined;
}

function looksLikeSingleFilePath(path: string): boolean {
  if (path.endsWith("/")) {
    return false;
  }
  if (/[*?{}]/.test(path)) {
    return false;
  }
  return true;
}

function hasUselessCompressionExtension(path: string): boolean {
  const lower = path.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1 || lastDot === lower.length - 1) {
    return false;
  }
  const ext = lower.slice(lastDot);
  return USELESS_COMPRESSION_EXTENSIONS.has(ext);
}

export const preferDirectUploadForCompressedArtifactsRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!step.uses || !step.uses.toLowerCase().startsWith("actions/upload-artifact@")) {
          continue;
        }

        const pathValue = step.with?.path;
        const singlePath = getSingleFilePath(pathValue);
        if (
          !singlePath ||
          !looksLikeSingleFilePath(singlePath) ||
          !hasUselessCompressionExtension(singlePath)
        ) {
          continue;
        }

        const archiveValue = step.with?.archive;
        const hasArchiveFalse = archiveValue === false || archiveValue === "false";

        const version = getMajorVersion(step.uses, step.usesNode);
        if (version !== undefined && version < 7) {
          findings.push(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} uploads ${singlePath} without direct upload support.`,
              why: "actions/upload-artifact v7 added direct (unzipped) uploads for single files. Uploading an already-compressed or binary file through an older version forces an unnecessary zip wrapper, which wastes time and storage.",
              suggestion: `Upgrade to actions/upload-artifact@v7 or later and add \`archive: false\` for single-file uploads of already-compressed or binary artifacts. Note that with \`archive: false\` the artifact name becomes the file name and the \`name\` input is ignored; add \`skip-decompress: true\` to downstream download-artifact steps when uploading .zip files to prevent double-decompression.`,
              measurementHint:
                "Compare artifact upload duration and download size before and after the change.",
              aiHandoff: `Update the upload-artifact step in ${workflow.relativePath} to use actions/upload-artifact@v7 or later with archive: false for ${singlePath}. Preserve unrelated behavior and verify downstream artifact references.`,
              score: 60,
            }),
          );
        } else if (version !== undefined && version >= 7 && !hasArchiveFalse) {
          findings.push(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} uploads ${singlePath} without skipping the zip wrapper.`,
              why: "Uploading an already-compressed or binary file with archive wrapping adds unnecessary overhead. actions/upload-artifact v7 supports `archive: false` for single files to skip this.",
              suggestion: `Add \`archive: false\` to upload-artifact steps that upload already-compressed or binary files. Note that with \`archive: false\` the artifact name becomes the file name and the \`name\` input is ignored; add \`skip-decompress: true\` to downstream download-artifact steps when uploading .zip files to prevent double-decompression.`,
              measurementHint:
                "Compare artifact upload duration and download size before and after the change.",
              aiHandoff: `Add archive: false to the upload-artifact step in ${workflow.relativePath} that uploads ${singlePath}. Preserve unrelated behavior and verify downstream artifact references.`,
              score: 50,
            }),
          );
        }
      }
    }

    return findings;
  },
};
