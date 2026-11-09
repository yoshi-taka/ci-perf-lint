import { shellInvocations } from "./shell-invocations.ts";

const valueOptions = new Set([
  "-o",
  "--option",
  "-c",
  "--config-file",
  "-t",
  "--target-release",
  "--host-architecture",
  "--build-profiles",
  "-S",
  "--snapshot",
]);
const switches = new Set([
  "-y",
  "--yes",
  "--assume-yes",
  "-q",
  "-qq",
  "--quiet",
  "--no-install-recommends",
  "--no-install-suggests",
  "--reinstall",
  "--fix-broken",
  "--allow-downgrades",
  "--allow-change-held-packages",
  "--allow-unauthenticated",
]);

interface AptInstallCommand {
  packages: string[];
  command: string;
}

/** Collect package arguments only, never output, option values or later commands. */
export function collectAptInstallCommands(text: string): AptInstallCommand[] {
  return shellInvocations(text, false).flatMap(([tool, ...args]) => {
    if (tool !== "apt" && tool !== "apt-get") {
      return [];
    }
    let install = false;
    let options = true;
    const packages: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (options && arg === "--") {
        options = false;
        continue;
      }
      if (options && arg.startsWith("-")) {
        const name = arg.split("=", 1)[0]!;
        if (valueOptions.has(name)) {
          if (!arg.includes("=")) {
            index++;
          }
        } else if (!switches.has(arg)) {
          return [];
        }
        continue;
      }
      if (!install) {
        if (arg !== "install") {
          return [];
        }
        install = true;
      } else if (/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?(?:=[^\s]+|\/[a-z0-9+.-]+)?$/.test(arg)) {
        packages.push(arg);
      }
    }
    return install && packages.length > 0 ? [{ packages, command: [tool, ...args].join(" ") }] : [];
  });
}
