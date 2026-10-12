import {
  collectDockerfileInstructions,
  type CollectedDockerfileInstruction,
} from "./dockerfile-instructions.ts";
import { directCommand, dockerRunCommands } from "./docker-image-metadata-helpers.ts";

const valueOptions = new Set(["-o", "--option", "-t", "--target-release", "-S", "--snapshot"]);

export function instructionInstallsAptWithRecommends(
  instruction: CollectedDockerfileInstruction,
): boolean {
  if (/^ONBUILD\s+RUN\b/i.test(instruction.text.trim())) {
    const run = collectDockerfileInstructions([
      instruction.text.trim().replace(/^ONBUILD\s+/i, ""),
    ])[0];
    return !!run && instructionInstallsAptWithRecommends(run);
  }
  return dockerRunCommands(instruction).some((tokens) => {
    const { name, args } = directCommand(tokens);
    if (
      !/^apt(?:-get)?$/.test(name) ||
      args.some((arg) =>
        /^(?:--help|--version|--simulate|--just-print|--dry-run|--recon|--no-act|-s|-h|-c|--config-file)(?:=|$)/.test(
          arg,
        ),
      )
    ) {
      return false;
    }
    let action: string | undefined;
    let recommends = true;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--no-install-recommends") {
        recommends = false;
      } else if (arg === "--install-recommends") {
        recommends = true;
      } else if (arg === "-o" || arg === "--option" || /^--option=|^-o./.test(arg)) {
        const value =
          arg === "-o" || arg === "--option"
            ? (args[++index] ?? "")
            : arg.startsWith("--option=")
              ? arg.slice(9)
              : arg.slice(2);
        const setting = /^APT::Install-Recommends=(true|false|yes|no|on|off|1|0)$/i.exec(value);
        if (setting) {
          recommends = /^(?:true|yes|on|1)$/i.test(setting[1]!);
        }
      } else if (valueOptions.has(arg)) {
        index++;
      } else if (!arg.startsWith("-") && action === undefined) {
        action = arg;
      }
    }
    return action === "install" && recommends;
  });
}
