#!/usr/bin/env node
const { runCli } = await import("./main.ts");

try {
  const exitCode = await runCli(process.argv.slice(2), process.cwd(), console);
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
