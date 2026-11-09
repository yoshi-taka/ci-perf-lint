import { shellInvocations } from "./shell-invocations.ts";

/** Executable/task names only: flags, argument filenames, labels and display text are not work. */
export function toolingWorkNames(text: string): string[] {
  return shellInvocations(text).map(invocationWorkName);
}

export function invocationWorkName([tool, action, task]: string[]): string {
  if (tool === "npm" && ["run", "run-script"].includes(action ?? "")) {
    return task ?? "";
  }
  if (
    ["npm", "pnpm", "yarn", "bun"].includes(tool ?? "") &&
    action &&
    !action.startsWith("-") &&
    ![
      "ci",
      "install",
      "i",
      "add",
      "update",
      "upgrade",
      "exec",
      "dlx",
      "x",
      "view",
      "info",
      "list",
    ].includes(action)
  ) {
    return action;
  }
  if (["poetry", "pipenv"].includes(tool ?? "") && action === "run") {
    return task ?? "";
  }
  return tool ?? "";
}

export function hasNativeOrOpaqueToolingWork(text: string): boolean {
  return shellInvocations(text).some(invocationHasNativeOrOpaqueWork);
}

export function invocationHasNativeOrOpaqueWork([tool, action]: string[]): boolean {
  return (
    /^(?:\$|`)/.test(tool ?? "") ||
    (tool ?? "").includes("__shell_substitution__") ||
    ((tool ?? "").includes("/") && !tool?.startsWith("@")) ||
    (["bash", "sh", "node", "python", "python3"].includes(tool ?? "") &&
      action !== "--version" &&
      action !== "-V") ||
    (tool === "cargo" && action !== "fmt") ||
    ["cross", "napi", "node-gyp"].includes(tool ?? "")
  );
}
