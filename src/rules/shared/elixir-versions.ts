export function parseOtpVersion(value: string): number | undefined {
  const match = value.trim().match(/^(\d+)/);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function parseElixirMajorMinor(value: string): { major: number; minor: number } | undefined {
  const cleaned = value.replace(/-otp\.?\d+/i, "").trim();
  const match = cleaned.match(/^(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return { major: Number.parseInt(match[1]!, 10), minor: Number.parseInt(match[2]!, 10) };
}

export function extractOtpFromElixirVersion(elixirVersion: string): number | undefined {
  const match = elixirVersion.match(/otp[-.]?(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

export function extractOtpFromContainerImage(image: string): number | undefined {
  const match = image.match(/elixir:.*?otp[-.]?(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

interface OtpRuleFinding {
  message: string;
  why: string;
  suggestion: string;
}

interface ElixirRuleFinding {
  message: string;
  why: string;
  suggestion: string;
}

export function checkOtpVersion(otp: number): OtpRuleFinding | undefined {
  if (otp === 25) {
    return {
      message: `OTP 25 may impact CI test/runtime performance.`,
      why: "OTP 26 improved BEAM JIT compilation, scheduler efficiency, and I/O throughput, which directly speeds up test suites and job execution.",
      suggestion: "Upgrade to OTP 26 for faster test and runtime performance in CI.",
    };
  }
  return undefined;
}

export function checkElixirVersion(elixirVersion: string): ElixirRuleFinding | undefined {
  const parsed = parseElixirMajorMinor(elixirVersion);
  if (!parsed) {
    return undefined;
  }

  const { major, minor } = parsed;

  if (major === 1 && (minor === 13 || minor === 14)) {
    return {
      message: `Elixir ${elixirVersion} may increase compile and boot times.`,
      why: "Elixir 1.15 introduced faster boot times and compilation improvements, reducing cold-start overhead in CI.",
      suggestion: "Upgrade to Elixir 1.15 for faster compile and boot times in CI.",
    };
  }

  if (major === 1 && minor >= 15 && minor <= 18) {
    return {
      message: `Elixir ${elixirVersion} may increase compile times in dependency-heavy projects.`,
      why: "Elixir 1.19 makes modules load lazily, reducing code-server pressure, and supports parallel dependency compilation (MIX_OS_DEPS_COMPILE_PARTITION_COUNT), delivering up to 4x faster builds in large projects.",
      suggestion:
        "Upgrade to Elixir 1.19 for up to 4x faster compilation in dependency-heavy projects (Elixir 1.19 requires Erlang/OTP 26+).",
    };
  }

  if (major === 1 && minor === 19) {
    return {
      message: `Elixir ${elixirVersion} is one minor behind the latest compile improvements.`,
      why: "Elixir 1.20 continues the compile-time improvements from 1.19 (lazy modules and parallel dependency compilation), especially on machines with many cores.",
      suggestion:
        "Upgrade to Elixir 1.20 for further compile-time improvements (Elixir 1.20 requires Erlang/OTP 27+).",
    };
  }

  return undefined;
}
