# prefer-download-artifact-v8-for-archives

## Why it matters

download-artifact v8 introduced `skip-decompress: true`. Retaining a ZIP instead of
extracting it avoids CPU and disk I/O when the next step publishes the archive itself.
Updating the action alone does not disable decompression.

## What it flags

- download-artifact v4–v7 with an explicit `skip-decompress: true` input, which those
  versions do not support.
- A named ZIP download with no decompression setting, where the same workflow has
  a matching upload-artifact v7+ direct upload (`archive: false`) in the same job
  before the download or a directly needed job, and a later upload-artifact or
  softprops/action-gh-release step consumes the exact downloaded ZIP path.

Findings are exploratory suggestions, consolidated per job. The second case also
flags v8+ when `skip-decompress` is missing.

## Suggested action

Use download-artifact v8 or later and set `skip-decompress: true` when the ZIP file
itself is required. Preserve artifact names and download paths.

**Do not skip decompression blindly:** ordinary upload-artifact uploads add an
outer ZIP wrapper. Keeping that wrapper is not equivalent to keeping the inner ZIP.
Direct uploads ignore the upload `name` input and use the file name instead.
v8 also makes digest mismatches errors by default; check runner compatibility.

## Verification

Compare download duration and disk writes. Verify the release/re-uploaded ZIP's
contents and path, not just whether the job exits successfully.

## What the scanner does

Only literal numeric action versions and SHA pins with an exact version comment
are classified. Dynamic names/paths, globs, remote runs, ID/pattern selection,
explicit decompression settings, ambiguous producers, and v3 GHES downloads are
left unclassified. Producer linking is local to this workflow; it does not inspect
other workflows or shell consumers.

Reference: [download-artifact v8 release](https://github.com/actions/download-artifact/releases/tag/v8.0.0).
