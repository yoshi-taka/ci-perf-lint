# Use direct upload for already-compressed artifacts

## What it detects

`actions/upload-artifact` steps that upload a single already-compressed or binary file without using `archive: false`, or that use a version older than v7 which does not support direct uploads.

## Why it matters

actions/upload-artifact v7 introduced direct (unzipped) uploads for single files. Wrapping an already-compressed file (e.g., `.zip`, `.gz`, `.exe`, `.png`) in an additional zip archive adds unnecessary CPU overhead and increases artifact size. Skipping the zip step saves time and storage.

## Suggested action

- If the step uses `actions/upload-artifact` v6 or earlier, upgrade to v7 or later.
- Add `archive: false` to the step when uploading a single file of a compressed or binary format.

## Measurement or verification guidance

Compare artifact upload duration and download size before and after enabling `archive: false`.

## Compatibility notes

- `archive: false` is only supported for single-file uploads. If the `path` resolves to multiple files, the action will fail.
- When `archive: false` is used, the artifact name becomes the uploaded file name and the `name` input is ignored. Verify downstream `download-artifact` references if you rely on a custom artifact name.
- When uploading a `.zip` file with `archive: false`, downstream `actions/download-artifact` steps may need `skip-decompress: true` to prevent double-decompression.
