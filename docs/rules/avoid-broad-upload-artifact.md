# avoid-broad-upload-artifact

Detects `actions/upload-artifact` steps that upload very broad paths (`.`, `./`, `*`, or `**`) without an error-condition guard.

## What it detects

- Steps using `actions/upload-artifact` with `path` set to the entire working directory or an all-encompassing glob.
- Steps that lack an `if` guard such as `failure()`, `cancelled()`, or `!success()`.

## Why it matters

Uploading the whole repository or a broad glob on every run wastes artifact storage and increases upload/download time. Broad uploads are usually only appropriate for collecting debug dumps after a failure.

## Suggested action

- Narrow `path` to the specific files or directories the downstream job actually needs.
- If the upload is meant for debug artifacts, add `if: failure()` (or equivalent) so it only runs when needed.

## Measurement

Compare artifact size and upload duration before and after narrowing the path or adding the guard.

## Compatibility

- This rule intentionally skips steps that already have an error guard because they are likely debug uploads.
