import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "ci-perf-package-"));
try {
  const archive = path.join(temp, "package.tgz");
  const pack = Bun.spawn(["bun", "pm", "pack", "--ignore-scripts", "--filename", archive], {
    stdout: "ignore",
    stderr: "inherit",
  });
  if ((await pack.exited) !== 0) throw new Error("Package creation failed");
  const tar = Bun.gunzipSync(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  const decoder = new TextDecoder();
  const files: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = decoder.decode(tar.slice(offset, offset + 100)).replace(/\0.*$/, "");
    if (!name) break;
    const prefix = decoder.decode(tar.slice(offset + 345, offset + 500)).replace(/\0.*$/, "");
    const size =
      Number.parseInt(
        decoder
          .decode(tar.slice(offset + 124, offset + 136))
          .replace(/\0.*$/, "")
          .trim(),
        8,
      ) || 0;
    if (tar[offset + 156] !== 53)
      files.push((prefix ? `${prefix}/${name}` : name).replace(/^package\//, ""));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const expected = ["package.json", "dist/cli.js", "README.md", "LICENSE"].sort();
  if (JSON.stringify(files.sort()) !== JSON.stringify(expected))
    throw new Error(`Unexpected package contents: ${files.join(", ")}`);
  console.log("Package contents verified (CLI, manifest, README, license).");
} finally {
  await rm(temp, { recursive: true, force: true });
}
