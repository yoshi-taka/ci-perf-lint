import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OutlineFont } from "./src/og/font";
import { renderOgPrototype } from "./src/og/card";

const output = path.resolve(import.meta.dir, "dist/og-prototype");
const font = new OutlineFont(
  await Bun.file(new URL("./assets/jost/Jost-600-Semi.ttf", import.meta.url)).bytes(),
);
await mkdir(output, { recursive: true });
for (const [name, title] of [
  ["home", undefined],
  ["missing-concurrency", "missing-concurrency"],
  ["long-rule", "dockerfile-maven-build-without-cache-mount"],
] as const) {
  const start = performance.now();
  const png = renderOgPrototype(font, title);
  await writeFile(path.join(output, `${name}.png`), png);
  console.log(`${name}: ${Math.round(performance.now() - start)}ms, ${png.length} bytes`);
}
console.log(output);
