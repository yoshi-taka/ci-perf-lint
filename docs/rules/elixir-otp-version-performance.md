# elixir-otp-version-performance

Detects outdated Elixir and OTP (Erlang) versions across your CI configuration,
Dockerfiles, and `.tool-versions` files.

## OTP Sources

| Source | Example |
|---|---|
| `erlef/setup-beam` action | `otp-version: "26"` |
| setup-beam elixir-version | `elixir-version: "1.15-otp-26"` |
| job container image | `container: elixir:1.15-otp-25` |
| `.tool-versions` | `erlang 26` |
| Dockerfile | `FROM elixir:1.6-otp-21` |

## Elixir Sources

| Source | Example |
|---|---|
| `erlef/setup-beam` action | `elixir-version: "1.15"` |
| job container image | `container: elixir:1.15-otp-25` |
| `.tool-versions` | `elixir 1.18.4-otp-28` |
| Dockerfile | `FROM elixir:1.6-otp-21` |

## Effective Priority

Sources are checked in order: CI definitions > Dockerfile > `.tool-versions`.
Only the highest-priority source per pipeline is used.

## Rules

| Condition | Severity | Action |
|---|---|---|
| OTP 25 | warning | Upgrade to OTP 26 for improved CI test/runtime performance |
| Elixir < 1.15 (i.e. 1.13, 1.14) | warning | Upgrade to Elixir 1.15 for compile and boot-time improvements |
| Elixir 1.17, 1.18 | warning | Upgrade to Elixir 1.19 for improved compile performance in dependency-heavy projects |

## Why This Matters

- **OTP version** directly affects BEAM runtime performance in tests and during job
  execution. OTP 26 introduced significant BEAM improvements.
- **Elixir version** affects compile-time performance. Elixir 1.15 improved boot
  time; Elixir 1.19 includes compiler optimizations particularly beneficial for
  dependency-heavy projects.
