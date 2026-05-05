import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

function countCargoWorkspaceMembers(cargoTomlText: string): number | undefined {
  const workspaceMembersMatch = cargoTomlText.match(
    /\[workspace\][\s\S]*?\bmembers\s*=\s*\[([\s\S]*?)\]/,
  );
  if (!workspaceMembersMatch?.[1]) {
    return undefined;
  }

  const members = workspaceMembersMatch[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));

  return members.length;
}

export async function collectElixirSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["elixir"]> {
  const mixExsPath = context.resolve("mix.exs");
  const hasMixExs = await context.pathExists(mixExsPath);

  const toolVersionsPath = context.resolve(".tool-versions");
  const toolVersionsText = (await context.pathExists(toolVersionsPath))
    ? await context.readTextFileOrWarn(toolVersionsPath)
    : undefined;

  let hasToolVersions = false;
  let erlangVersion: string | undefined;
  let elixirVersion: string | undefined;

  if (toolVersionsText) {
    hasToolVersions = true;
    for (const line of toolVersionsText.split("\n")) {
      const trimmed = line.trim();
      const erlangMatch = trimmed.match(/^erlang\s+(\S+)/);
      if (erlangMatch) {
        erlangVersion = erlangMatch[1];
        continue;
      }
      const elixirMatch = trimmed.match(/^elixir\s+(\S+)/);
      if (elixirMatch) {
        elixirVersion = elixirMatch[1];
      }
    }
  }

  return { hasMixExs, hasToolVersions, erlangVersion, elixirVersion };
}

export async function collectRustSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["rust"]> {
  const cargoTomlPath = context.resolve("Cargo.toml");
  const hasCargoToml = await context.pathExists(cargoTomlPath);
  const cargoTomlText = hasCargoToml ? await context.readTextFileOrWarn(cargoTomlPath) : undefined;
  const nextestConfigPresent =
    (await context.pathExists(context.resolve(".config", "nextest.toml"))) ||
    (await context.pathExists(context.resolve("nextest.toml")));

  return {
    hasCargoToml,
    hasWorkspace: (cargoTomlText ?? "").includes("[workspace]"),
    workspaceMemberCount: cargoTomlText ? countCargoWorkspaceMembers(cargoTomlText) : undefined,
    usesNextest: nextestConfigPresent || /\bnextest\b/i.test(cargoTomlText ?? ""),
  };
}
