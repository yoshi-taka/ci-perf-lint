import { appendFile } from "node:fs/promises";

interface RegistryResult {
  exitCode: number;
  stdout: string;
}
type RegistryLookup = (specifier: string) => Promise<RegistryResult>;

async function queryRegistry(specifier: string): Promise<RegistryResult> {
  const process = Bun.spawn(["npm", "view", specifier, "version", "--json"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stdout };
}

export async function getPublishPlan(
  version: string,
  lookup: RegistryLookup = queryRegistry,
): Promise<{ publishScoped: boolean; publishWrapper: boolean }> {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version))
    throw new Error(`Expected exact publish version: ${version}`);
  const exists = async (name: string): Promise<boolean> => {
    const result = await lookup(`${name}@${version}`);
    const data: unknown = JSON.parse(result.stdout);
    if (result.exitCode === 0 && data === version) return true;
    if (result.exitCode !== 0 && data && typeof data === "object" && "error" in data) {
      const error = data.error;
      if (error && typeof error === "object" && "code" in error && error.code === "E404")
        return false;
    }
    throw new Error(`Cannot determine registry status for ${name}@${version}`);
  };
  const [scoped, wrapper] = await Promise.all([
    exists("@yoshi-taka/ci-perf-lint"),
    exists("ci-perf-lint"),
  ]);
  return { publishScoped: !scoped, publishWrapper: !wrapper };
}

if (import.meta.main) {
  const plan = await getPublishPlan(process.argv[2] ?? "");
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  await appendFile(
    output,
    `publish_scoped=${plan.publishScoped}\npublish_wrapper=${plan.publishWrapper}\n`,
  );
  console.log(`Publish scoped=${plan.publishScoped}, wrapper=${plan.publishWrapper}`);
}
