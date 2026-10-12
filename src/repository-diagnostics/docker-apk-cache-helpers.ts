import {
  collectDockerfileInstructions,
  type CollectedDockerfileInstruction,
} from "./dockerfile-instructions.ts";
import { directCommand, dockerRunCommands } from "./docker-image-metadata-helpers.ts";
import { cacheIsMounted } from "./docker-package-cache-helpers.ts";

const valueOptions = new Set([
  "-X",
  "--repository",
  "--repositories-file",
  "--arch",
  "--keys-dir",
  "-t",
  "--virtual",
  "--wait",
  "--timeout",
]);

export function instructionInstallsApkWithoutCacheControl(
  instruction: CollectedDockerfileInstruction,
): boolean {
  if (/^ONBUILD\s+RUN\b/i.test(instruction.text.trim())) {
    const run = collectDockerfileInstructions([
      instruction.text.trim().replace(/^ONBUILD\s+/i, ""),
    ])[0];
    return !!run && instructionInstallsApkWithoutCacheControl(run);
  }
  return dockerRunCommands(instruction).some((tokens) => {
    const { name, args } = directCommand(tokens);
    if (
      name !== "apk" ||
      args.includes("--no-cache") ||
      args.some((arg) => /^(?:--help|--version|--simulate|-s|-h|-p|--root)(?:=|$)/.test(arg))
    ) {
      return false;
    }
    let action: string | undefined;
    let cache = "/var/cache/apk";
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--cache-dir") {
        cache = args[++index] ?? "";
      } else if (arg.startsWith("--cache-dir=")) {
        cache = arg.slice(12);
      } else if (valueOptions.has(arg)) {
        index++;
      } else if (!arg.startsWith("-") && action === undefined) {
        action = arg;
      }
    }
    return (
      action === "add" &&
      cache.startsWith("/") &&
      !/[$`]/.test(cache) &&
      !cacheIsMounted(cache, instruction, ["cache", "tmpfs"])
    );
  });
}
