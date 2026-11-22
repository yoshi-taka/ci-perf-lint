import path from "node:path";
import { buildSite } from "./src/build-site";
import { createSiteHandler, watchSiteSources } from "./src/server";

const rootDir = path.resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
let hostname = "127.0.0.1";
let port = 4321;
let development = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--watch") development = true;
  else if (arg === "--port" && args[index + 1]) port = Number(args[++index]);
  else if (arg === "--host" && args[index + 1]) hostname = args[++index] ?? hostname;
  else
    throw new Error(
      `Unknown or incomplete option: ${arg}. Use --port <number> or --host <address>.`,
    );
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
const output = path.join(rootDir, "site/dist");
async function rebuild() {
  const result = await buildSite({ rootDir });
  console.log(`[site] rebuilt ${result.pages} pages from ${result.rules} rule docs`);
}
if (development) await rebuild();
else if (!(await Bun.file(path.join(output, "index.html")).exists())) {
  throw new Error("No site build found. Run bun run docs:build first.");
}
const watcher = development
  ? watchSiteSources(rootDir, {
      rebuild,
      onError: (error) => console.error("[site] build failed; keeping previous output:", error),
    })
  : undefined;
const server = Bun.serve({ hostname, port, fetch: createSiteHandler(output) });
console.log(`[site] ${server.url}${development ? " (watching docs and public assets)" : ""}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void watcher?.close().finally(() => server.stop(true));
    if (!watcher) server.stop(true);
  });
}
