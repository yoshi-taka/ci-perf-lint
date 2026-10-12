import path from "node:path";
import { applyAssignments } from "./docker-package-cache-helpers.ts";

export type CacheTool = "bun" | "npm" | "pnpm" | "uv" | "yarn";
export interface PackageCacheSettings {
  bunCache?: string;
  npmCache?: string;
  pnpmStore?: string;
  yarnCache?: string;
  modernYarn?: boolean;
  globalVirtualStore?: boolean;
}
export interface PackageCacheState {
  environment: Map<string, string>;
  rootUser: boolean;
  workdir: string;
  modernYarn: boolean;
  settings?: PackageCacheSettings;
}
export interface PackageCacheCommand {
  tool: CacheTool;
  cache: string;
}
const tools = new Set<CacheTool>(["bun", "npm", "pnpm", "uv", "yarn"]);
const valueOptions = new Set([
  "--cache",
  "--cache-dir",
  "--cache-folder",
  "--store-dir",
  "--cwd",
  "--dir",
  "--prefix",
  "-C",
  "--filter",
]);

export function commandOption(tokens: string[], name: string): string | undefined {
  let value: string | undefined;
  for (let index = 0; index < tokens.length && tokens[index] !== "--"; index += 1) {
    const token = tokens[index]!;
    if (token === name) {
      value = tokens[++index];
    } else if (token.startsWith(`${name}=`)) {
      value = token.slice(name.length + 1);
    }
  }
  return value;
}

function resolveCache(value: string, environment: Map<string, string>, workdir: string): string {
  const expanded = value
    .replace(
      /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
      (match, braced: string | undefined, plain: string | undefined) =>
        environment.get(braced ?? plain ?? "") ?? match,
    )
    .replace(/^~(?=\/|$)/, environment.get("HOME") ?? "~");
  if (!expanded || /[$`~]/.test(expanded)) {
    return expanded;
  }
  return path.posix.isAbsolute(expanded)
    ? path.posix.normalize(expanded)
    : path.posix.resolve(workdir, expanded);
}

export function packageCacheCommand(
  tokens: string[],
  state: PackageCacheState,
  settings: PackageCacheSettings,
): PackageCacheCommand | undefined {
  settings = { ...settings, ...state.settings };
  const environment = new Map(state.environment);
  if (!environment.has("HOME") && state.rootUser) {
    environment.set("HOME", "/root");
  }
  let index = tokens[0] === "env" ? 1 : 0;
  index += applyAssignments(tokens.slice(index), environment);
  if (tokens[index] === "corepack") {
    index += 1;
  }
  const tool = path.posix.basename(tokens[index] ?? "") as CacheTool;
  if (!tools.has(tool)) {
    return undefined;
  }
  const args = tokens.slice(index + 1);
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    (tool === "yarn" && args.includes("-v")) ||
    args.includes("--dry-run") ||
    args.includes("--lockfile-only") ||
    args.includes("--package-lock-only")
  ) {
    return undefined;
  }
  let actionIndex = 0;
  while (args[actionIndex]?.startsWith("-")) {
    actionIndex += valueOptions.has(args[actionIndex]!) ? 2 : 1;
  }
  const action = args[actionIndex];
  const install =
    tool === "uv"
      ? action === "sync" ||
        (action === "pip" && /^(?:install|sync)$/.test(args[actionIndex + 1] ?? "")) ||
        (action === "tool" && args[actionIndex + 1] === "install")
      : /^(?:install|i|add|ci)$/.test(action ?? "") ||
        (tool === "pnpm" && action === "fetch") ||
        (tool === "yarn" && action === undefined);
  if (!install) {
    return undefined;
  }

  const home = environment.get("HOME") ?? "";
  const xdgCache = environment.get("XDG_CACHE_HOME") ?? (home ? `${home}/.cache` : "");
  let cache = "";
  switch (tool) {
    case "uv":
      if ((commandOption(args, "--link-mode") ?? environment.get("UV_LINK_MODE")) === "symlink") {
        return undefined;
      }
      if (
        args.includes("--no-cache") ||
        args.includes("-n") ||
        /^(?:1|true)$/i.test(environment.get("UV_NO_CACHE") ?? "")
      ) {
        return undefined;
      }
      cache =
        commandOption(args, "--cache-dir") ??
        environment.get("UV_CACHE_DIR") ??
        (xdgCache ? `${xdgCache}/uv` : "");
      break;
    case "npm":
      cache =
        commandOption(args, "--cache") ??
        environment.get("npm_config_cache") ??
        environment.get("NPM_CONFIG_CACHE") ??
        settings.npmCache ??
        (home ? `${home}/.npm` : "");
      break;
    case "pnpm": {
      if (
        settings.globalVirtualStore ||
        args.includes("--enable-global-virtual-store") ||
        /^(?:true|1)$/i.test(environment.get("npm_config_enable_global_virtual_store") ?? "")
      ) {
        return undefined;
      }
      const pnpmHome = environment.get("PNPM_HOME");
      const data = environment.get("XDG_DATA_HOME") ?? (home ? `${home}/.local/share` : "");
      cache =
        commandOption(args, "--store-dir") ??
        environment.get("npm_config_store_dir") ??
        environment.get("NPM_CONFIG_STORE_DIR") ??
        settings.pnpmStore ??
        (pnpmHome ? `${pnpmHome}/store` : data ? `${data}/pnpm/store` : "");
      break;
    }
    case "bun":
      // Symlink installs may need the global cache at runtime. --no-cache only
      // bypasses parts of Bun's cache; it does not establish no layer writes.
      if (commandOption(args, "--backend") === "symlink") {
        return undefined;
      }
      cache =
        commandOption(args, "--cache-dir") ??
        environment.get("BUN_INSTALL_CACHE_DIR") ??
        settings.bunCache ??
        (home ? `${home}/.bun/install/cache` : "");
      break;
    case "yarn":
      // PnP/zero-install archives are runtime dependencies, not disposable caches.
      if (
        settings.modernYarn ||
        state.modernYarn ||
        /^(?:[2-9]|\d{2,})\./.test(environment.get("YARN_VERSION") ?? "") ||
        args.includes("--immutable") ||
        args.includes("--immutable-cache") ||
        environment.has("YARN_NODE_LINKER") ||
        environment.has("YARN_ENABLE_GLOBAL_CACHE")
      ) {
        return undefined;
      }
      cache =
        commandOption(args, "--cache-folder") ??
        environment.get("YARN_CACHE_FOLDER") ??
        settings.yarnCache ??
        "";
      // Classic's default varies by root/user and platform. Unknown paths are
      // reported, but only an explicit path can prove mount/cleanup coverage.
      break;
  }
  const workdir =
    commandOption(args, "--cwd") ??
    commandOption(args, "--dir") ??
    commandOption(args, "-C") ??
    state.workdir;
  return { tool, cache: resolveCache(cache, environment, workdir) };
}
