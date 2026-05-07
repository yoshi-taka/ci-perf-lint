import { readFile } from "node:fs/promises";

export const readTextFile: (path: string) => Promise<string> =
  typeof Bun !== "undefined"
    ? (path) => Bun.file(path).text()
    : (path) => readFile(path, "utf8");
