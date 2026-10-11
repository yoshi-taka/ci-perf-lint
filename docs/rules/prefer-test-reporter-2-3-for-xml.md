# prefer-test-reporter-2-3-for-xml

## Why it matters

test-reporter v2.3.0 updates sax.js to fix expensive parsing of large XML CDATA
sections. Upstream cites a 50 MB log requiring about 5 GiB of memory and several
seconds of parsing before the fix. Small XML files may see little benefit;
JSON reporters and test execution itself are unaffected by this parser change.

## What it flags

Pinned `dorny/test-reporter` versions below v2.3.0 with a literal XML reporter:
`dotnet-nunit`, `dotnet-trx`, `java-junit`, `jest-junit`, `python-xunit` or
`swift-xunit`. Emits one warning per job. The scanner does not infer generated
report size or require logs to be checked into the repository.

## Suggested action

Upgrade to v2.3.0 or a later compatible release. Preserve reporter format, paths,
artifact selection, permissions, annotations and failure policy. Review
compatibility when upgrading across Action major versions.

## Verification

Compare reporting-step duration and peak memory using identical representative
XML files with large embedded logs. Check summary/check results, annotations
and failure behavior.

## What the scanner does

Compares numeric minor/full tags and SHA pins annotated with such tags. Skips
floating major tags, branches, prereleases, unknown SHA pins, disabled jobs/steps,
missing/dynamic reporter inputs, unknown formats and all JSON reporters.

References:
- [CHANGELOG](https://github.com/dorny/test-reporter/blob/main/CHANGELOG.md)
- [Update sax.js for large XML parsing](https://github.com/dorny/test-reporter/pull/681)
