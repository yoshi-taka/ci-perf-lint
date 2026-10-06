# prefer-elixir-parallel-deps-compile

Detects GitHub Actions jobs that use Elixir 1.19+ and run `mix` without enabling parallel dependency compilation.

## What it detects

- a job using Elixir 1.19 or newer, from
  - `erlef/setup-beam` (`elixir-version`), or
  - a job container image (`elixir:1.19-otp-27`), and
- a `mix` command that compiles the project or its dependencies (`mix deps.compile`, `mix compile`, `mix test`, ...), and
- no `MIX_OS_DEPS_COMPILE_PARTITION_COUNT` set anywhere in the workflow.

Commands that do not compile dependencies (`mix local.hex`, `mix deps.get`, `mix format`, ...) are ignored.

## Why it matters

Elixir 1.19 can compile a dependency graph across multiple OS processes. Compiling dependencies with native code, downloading assets, or uneven compile times used to leave cores idle; with partitioning the Elixir team reports up to 4x faster compilation on large projects. Parallel dependency compilation is opt-in, so upgrading to Elixir 1.19 alone does not capture the speedup.

## Suggested action

Set `MIX_OS_DEPS_COMPILE_PARTITION_COUNT` to a number greater than 1 in the job or workflow `env:`, starting around half the number of machine cores (for example `4`). Each partition starts an extra OS process, so watch memory usage on the runner.

```yaml
env:
  MIX_OS_DEPS_COMPILE_PARTITION_COUNT: 4
```

## Measurement

Compare `mix deps.compile` wall-clock time with and without the variable on the same runner, and increase the count until it stops improving.

## Compatibility notes

`MIX_OS_DEPS_COMPILE_PARTITION_COUNT` requires Elixir 1.19+. The optimal value differs per machine and project, which is why Mix exposes it as an environment variable instead of a flag.
