# prefer-wiremock-3-11

## Why it matters

WireMock 3.11 is a cumulative performance baseline:

- [3.4.2](https://github.com/wiremock/wiremock/releases/tag/3.4.2) fixes a request-matching performance regression.
- [3.5.0](https://github.com/wiremock/wiremock/releases/tag/3.5.0) caches parsed JSON documents and evaluated JSONPath values per request, benefiting multiple `matchesJsonPath` stubs ([implementation](https://github.com/wiremock/wiremock/pull/2629)).
- [3.7.0](https://github.com/wiremock/wiremock/releases/tag/3.7.0) bounds the default template cache at 1,000 entries and includes proxy connection-management improvements.
- [3.11.0](https://github.com/wiremock/wiremock/releases/tag/3.11.0) ignores XML comments while parsing rather than using a memory-intensive XSLT transform in `equalToXml` ([implementation](https://github.com/wiremock/wiremock/pull/2944)).

These benefits depend on the current version and matching/template workload. A user already on 3.10 with only simple URL stubs is not promised a speedup from the XML change. No whole-suite multiplier was independently established.

## What it flags

Enabled GitHub Actions jobs with `wiremock/wiremock:x.y.z` service images below 3.11.0, optionally prefixed with `docker.io/`. Warning severity; no requirement to prove XML usage because this is one cumulative baseline, not an XML-only recommendation.

## Suggested action

Upgrade to 3.11.0 or a later compatible stable release. Preserve mappings, image variant, extensions, readiness checks, and verification behavior. For 2.x upgrades, review [the 3.0 release's breaking changes](https://github.com/wiremock/wiremock/releases/tag/3.0.0), Java 11+, Jetty compatibility, and response-template configuration. A bounded template cache can change hit rates for workloads with many unique templates.

Do not disable the request journal indiscriminately: tests may need it for request verification. Async response handling can help delayed-response load tests, but requires workload evidence and is not automatically recommended by this version rule.

## Verification

Compare startup, image pull, request-matching latency, memory, and full integration-suite duration. Retain XML/JSONPath, templating, and request-verification assertions where used. Confirm semantic compatibility rather than only a successful container start.

## What the scanner does

Only stable three-component official service-image tags are compared. Floating tags, partial versions, prereleases, digests, mirrors, expressions, shell commands, Compose files, and Maven/Gradle dependencies are not interpreted in this first detector.
