import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { treeResidentKiB } from "../scripts/run-bounded.ts";
import { createTempDirTracker } from "./helpers.ts";
const dirs = createTempDirTracker();
const runner = new URL("../scripts/run-bounded.ts", import.meta.url).pathname;
const posix = process.platform !== "win32";

test("memory samples aggregate the complete process group, not unrelated processes", () => {
  expect(
    treeResidentKiB("42 1 42 100\n43 1 43 99999\n44 42 44 200\n45 1 42 50\n46 44 46 75\n", 42),
  ).toBe(425);
  expect(treeResidentKiB("", 42)).toBe(0);
  expect(() => treeResidentKiB("42 invalid", 42)).toThrow("Invalid ps memory sample");
});
async function run(source: string, memory = 256, deadline = 2000, onExit?: () => Promise<void>) {
  const p = Bun.spawn(
    [
      process.execPath,
      "--no-orphans",
      runner,
      "--memory-mib",
      String(memory),
      "--timeout-ms",
      String(deadline),
      "--",
      process.execPath,
      "--no-orphans",
      "-e",
      source,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited.then(async (status) => {
      await onExit?.();
      return status;
    }),
  ]);
  return { out, err, code };
}
function notRunning(pid: number) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" })
      .trim()
      .startsWith("Z");
  } catch {
    return true;
  }
}

test.skipIf(!posix)(
  "deadline directly kills a detached worker with a starved event loop",
  async () => {
    const root = await dirs.create("apl-bounded-starved-"),
      pidFile = `${root}/pid`;
    // Finite control, not an unrestricted runaway if cleanup regresses.
    const busy = "const until=Date.now()+800;while(Date.now()<until){await Promise.resolve();}";
    const source = `import {spawn} from "node:child_process";const p=spawn(process.execPath,["--no-orphans","-e",${JSON.stringify(busy)}],{detached:true,stdio:"inherit"});await Bun.write(${JSON.stringify(pidFile)},String(p.pid));setInterval(()=>{},1000);`;
    const result = await run(source, 256, 400, async () => {
      expect(notRunning(Number(await Bun.file(pidFile).text()))).toBe(true);
    });
    expect(result.code).toBe(124);
  },
);
test.skipIf(!posix)("bounded runner preserves a normal command exit code", async () => {
  const result = await run('console.log("bounded-normal"); process.exit(7)');
  expect(result.code).toBe(7);
  expect(result.out).toContain("bounded-normal");
  expect(result.err).toContain("sampled peak group RSS");
});
test.skipIf(!posix)(
  "deadline terminates grandchildren as well as the command wrapper",
  async () => {
    const root = await dirs.create("apl-bounded-deadline-"),
      pidFile = `${root}/pid`;
    const source = `import {spawn} from "node:child_process";const p=spawn(process.execPath,["--no-orphans","-e","setInterval(()=>{},1000)"],{detached:true,stdio:"inherit"});await Bun.write(${JSON.stringify(pidFile)},String(p.pid));setInterval(()=>{},1000);`;
    const result = await run(source, 256, 400);
    expect(result.code).toBe(124);
    expect(result.err).toContain("deadline");
    expect(notRunning(Number(await Bun.file(pidFile).text()))).toBe(true);
  },
);
test.skipIf(!posix)("normal wrapper exit does not leave inherited workers running", async () => {
  const root = await dirs.create("apl-bounded-exit-"),
    pidFile = `${root}/pid`;
  const source = `import {spawn} from "node:child_process";const p=spawn(process.execPath,["--no-orphans","-e","setInterval(()=>{},1000)"],{detached:true,stdio:"inherit"});await Bun.write(${JSON.stringify(pidFile)},String(p.pid));p.unref();process.exit(0);`;
  const result = await run(source);
  expect(result.code).toBe(0);
  expect(notRunning(Number(await Bun.file(pidFile).text()))).toBe(true);
});
test.skipIf(!posix)(
  "sampled RSS limit fails rather than silently passing a growing process",
  async () => {
    // Deliberately bounded fixture: at most 128 MiB allocated even if the guard regresses.
    const result = await run(
      "const blocks=[];const timer=setInterval(()=>{blocks.push(Buffer.alloc(4*1024*1024,1));if(blocks.length===32){clearInterval(timer);setInterval(()=>{},1000);}},5);",
      80,
      4000,
    );
    expect(result.code).toBe(137);
    expect(result.err).toContain("exceeded 80 MiB");
  },
);

test.skipIf(!posix)("RSS limit includes a worker in a different process group", async () => {
  const root = await dirs.create("apl-bounded-worker-"),
    pidFile = `${root}/pid`;
  const allocation =
    "const blocks=[];const t=setInterval(()=>{blocks.push(Buffer.alloc(4*1024*1024,1));if(blocks.length===32){clearInterval(t);setInterval(()=>{},1000);}},5);";
  const source = `import {spawn} from "node:child_process";const p=spawn(process.execPath,["--no-orphans","-e",${JSON.stringify(allocation)}],{detached:true,stdio:"inherit"});await Bun.write(${JSON.stringify(pidFile)},String(p.pid));setInterval(()=>{},1000);`;
  const result = await run(source, 110, 4000);
  expect(result.code).toBe(137);
  expect(result.err).toContain("exceeded 110 MiB");
  expect(notRunning(Number(await Bun.file(pidFile).text()))).toBe(true);
});
