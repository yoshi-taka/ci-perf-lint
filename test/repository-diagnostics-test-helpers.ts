import { afterEach } from "bun:test";
import { createTempDirTracker, getFullRepositoryFixtureReport } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

export { tempDirs };

export function getFixtureReport(
  cwd: string,
  options: Parameters<typeof getFullRepositoryFixtureReport>[1],
) {
  return getFullRepositoryFixtureReport(cwd, options);
}
