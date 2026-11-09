import { shellInvocations } from "./shell-invocations.ts";

export function stepIsToxRun(run: string): boolean {
  return shellInvocations(run).some(
    ([tool, ...args]) =>
      tool === "tox" && !args.some((arg) => ["--help", "-h", "--version"].includes(arg)),
  );
}

export function stepInstallsToxUv(run: string): boolean {
  return shellInvocations(run).some(([tool, ...args]) => {
    if (tool === "uv" && args[0] === "pip") {
      args = args.slice(1);
    } else if (!/^pip(?:3(?:\.\d+)?)?$/.test(tool ?? "")) {
      return false;
    }
    if (
      args[0] !== "install" ||
      args.some((arg) => ["--help", "-h", "--version", "--dry-run"].includes(arg))
    ) {
      return false;
    }
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!;
      if (
        [
          "-r",
          "--requirement",
          "-c",
          "--constraint",
          "--index-url",
          "--extra-index-url",
          "--target",
          "--prefix",
          "--cache-dir",
          "--config-settings",
          "--python",
        ].includes(arg)
      ) {
        index++;
      } else if (/^tox-uv(?:$|[<>=!~;[])/i.test(arg)) {
        return true;
      }
    }
    return false;
  });
}
