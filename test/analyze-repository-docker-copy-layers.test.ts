import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rootfsId = "dockerfile-runtime-copies-builder-rootfs";
const archiveId = "dockerfile-extracts-copied-archive";
const rootfs =
  'FROM golang:1.26 AS build\nWORKDIR /src\nCOPY . .\nRUN go build -o /out/app .\nFROM scratch AS runtime\nCOPY --from=build / /\nENTRYPOINT ["/out/app"]';
const archive =
  "FROM alpine:3.22 AS base\nCOPY bundle.tar.gz /tmp/\nRUN tar -xzf /tmp/bundle.tar.gz -C /app && rm /tmp/bundle.tar.gz";

async function analyze(
  dockerfile: string,
  options: {
    target?: string;
    commands?: string[];
    files?: Record<string, string>;
    dockerfile?: string;
  } = {},
) {
  const root = await tempDirs.create("apl-docker-copy-layers-");
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  const filename = options.dockerfile ?? "Dockerfile";
  const steps = options.commands
    ? options.commands.map((command) => `      - run: ${command}`).join("\n")
    : `      - uses: docker/build-push-action@v6\n        with:\n          context: .\n          file: ${filename}${options.target === undefined ? "" : `\n          target: ${JSON.stringify(options.target)}`}`;
  await writeFile(
    path.join(dir, "build.yml"),
    `name: build\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`,
  );
  await writeFile(path.join(root, filename), dockerfile);
  await writeFile(path.join(root, ".dockerignore"), ".git\n");
  const files = options.files ?? {
    "bundle.tar.gz": "fixture archive input",
    "bundle.zip": "fixture zip input",
    "go.mod": "module example.com/app\n\ngo 1.26\n",
    "main.go": "package main\nfunc main() {}\n",
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 100 });
}

describe("runtime builder-rootfs transfers", () => {
  test.each([
    ["Go rootfs", rootfs],
    [
      "Rust rootfs",
      rootfs
        .replace("golang:1.26", "rust:1.85")
        .replace("go build -o /out/app .", "rustc -o /out/app main.rs"),
    ],
    ["numeric selector", rootfs.replace("--from=build", "--from=0")],
    ["quoted paths", rootfs.replace("COPY --from=build / /", 'COPY --from=build ["/", "/"]')],
    [
      "quoted shell-form roots",
      rootfs.replace("COPY --from=build / /", 'COPY --from=build "/" "/"'),
    ],
    ["normalized root source", rootfs.replace("COPY --from=build / /", "COPY --from=build /. /")],
    [
      "repeated root separators",
      rootfs.replace("COPY --from=build / /", "COPY --from=build // //"),
    ],
    [
      "relative destination at known root WORKDIR",
      rootfs.replace("COPY --from=build / /", "COPY --from=build / ."),
    ],
    [
      "parent destination resolves to root",
      rootfs.replace("COPY --from=build / /", "WORKDIR /chroot\nCOPY --from=build / .."),
    ],
    [
      "literal ENV root destination",
      rootfs.replace("COPY --from=build / /", "ENV ROOT=/\nCOPY --from=build / ${ROOT}"),
    ],
    [
      "later WORKDIR does not change earlier copy destination",
      rootfs.replace("COPY --from=build / /", "COPY --from=build / .\nWORKDIR /chroot"),
    ],
    ["environment before compile", rootfs.replace("RUN go build", "RUN CGO_ENABLED=0 go build")],
    [
      "JSON compile",
      rootfs.replace("RUN go build -o /out/app .", 'RUN ["go", "build", "-o", "/out/app", "."]'),
    ],
    [
      "source execution config does not transfer",
      rootfs
        .replace("FROM scratch", 'ENTRYPOINT ["/bin/source-only"]\nFROM scratch')
        .replace('ENTRYPOINT ["/out/app"]', 'CMD ["/out/app"]'),
    ],
    ["inherited output rootfs", `${rootfs}\nFROM runtime AS final`],
    [
      "inherited compiler stage",
      rootfs
        .replace("WORKDIR /src", "FROM build AS compiler\nWORKDIR /src")
        .replace("--from=build", "--from=compiler"),
    ],
    [
      "relative command with explicit output workdir",
      rootfs.replace('ENTRYPOINT ["/out/app"]', 'WORKDIR /out\nCMD ["./app"]'),
    ],
  ])("warns: %s", async (_name, body) => {
    const report = await analyze(body);
    const findings = report.findings.filter((finding) => finding.ruleId === rootfsId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.location.path).toBe("Dockerfile");
    expect(findings[0]?.message).toContain("/out/app");
    expect(findings[0]?.suggestion).toContain("runtime assets");
  });
  test.each([
    [
      "artifact-only transfer",
      rootfs.replace("COPY --from=build / /", "COPY --from=build /out/app /out/app"),
    ],
    ["subdirectory rootfs", rootfs.replace("COPY --from=build / /", "COPY --from=build / /chroot")],
    [
      "subdirectory source is not whole root",
      rootfs.replace("COPY --from=build / /", "COPY --from=build /out /"),
    ],
    [
      "relative copy destination below root",
      rootfs.replace("COPY --from=build / /", "WORKDIR /chroot\nCOPY --from=build / ."),
    ],
    [
      "later root WORKDIR does not relocate earlier copy",
      rootfs.replace("COPY --from=build / /", "WORKDIR /chroot\nCOPY --from=build / .\nWORKDIR /"),
    ],
    [
      "unknown relative copy destination",
      rootfs
        .replace("FROM scratch", "FROM custom/runtime:1")
        .replace("COPY --from=build / /", "COPY --from=build / ."),
    ],
    [
      "unresolved destination variable",
      rootfs.replace("COPY --from=build / /", "COPY --from=build / ${ROOT}"),
    ],
    [
      "multiple copy sources are uncertain",
      rootfs.replace("COPY --from=build / /", 'COPY --from=build ["/", "/out/app", "/"]'),
    ],
    [
      "wildcard root is not a literal whole-root copy",
      rootfs.replace("COPY --from=build / /", "COPY --from=build /* /"),
    ],
    ["unknown numeric source stage", rootfs.replace("--from=build", "--from=99")],
    ["context root copy", rootfs.replace("COPY --from=build / /", "COPY / /")],
    ["FROM inheritance has its own finding", rootfs.replace("FROM scratch", "FROM build")],
    ["external source image", rootfs.replace("--from=build", "--from=example.com/runtime:1")],
    [
      "runtime rootfs assembly",
      rootfs
        .replace("FROM golang:1.26", "FROM scratch")
        .replace("RUN go build -o /out/app .", "COPY app /out/app"),
    ],
    [
      "runtime executable is unrelated",
      rootfs.replace('ENTRYPOINT ["/out/app"]', 'CMD ["/bin/sh"]'),
    ],
    ["bare PATH command", rootfs.replace('ENTRYPOINT ["/out/app"]', 'CMD ["app"]')],
    [
      "unknown relative output workdir",
      rootfs
        .replace("FROM scratch", "FROM custom/runtime:1")
        .replace('ENTRYPOINT ["/out/app"]', 'CMD ["../out/app"]'),
    ],
    [
      "wrapper build is not direct compile",
      rootfs.replace("RUN go build -o /out/app .", "RUN ./build.sh"),
    ],
    [
      "compiler cleanup in same RUN",
      rootfs.replace(
        "RUN go build -o /out/app .",
        "RUN go build -o /out/app . && rm -rf /usr/local/go",
      ),
    ],
    [
      "source stripping after compile",
      rootfs.replace("FROM scratch", "RUN rm -rf /usr/local/go\nFROM scratch"),
    ],
    [
      "runtime mutation after transfer",
      rootfs.replace(
        'ENTRYPOINT ["/out/app"]',
        'RUN rm -rf /usr/local/go\nENTRYPOINT ["/out/app"]',
      ),
    ],
    [
      "later artifact replacement",
      rootfs.replace('ENTRYPOINT ["/out/app"]', 'COPY other /out/app\nENTRYPOINT ["/out/app"]'),
    ],
    ["build image rather than runtime", rootfs.replace("AS runtime", "AS toolchain")],
    ["dynamic FROM", rootfs.replace("golang:1.26", "golang:$VERSION")],
    ["dynamic COPY", rootfs.replace("--from=build", "--from=$BUILDER")],
  ])("excludes: %s", async (_name, body) => {
    const report = await analyze(body);
    expect(report.findings.filter((finding) => finding.ruleId === rootfsId)).toEqual([]);
  });
  test("uses explicit action target and ignores an unused rootfs transfer", async () => {
    const body = `${rootfs}\nFROM alpine:3.22 AS minimal\nCOPY --from=build /out/app /app\nCMD ["/app"]`;
    expect((await analyze(body)).findings.filter((finding) => finding.ruleId === rootfsId)).toEqual(
      [],
    );
    expect(
      (await analyze(body, { target: "runtime" })).findings.filter(
        (finding) => finding.ruleId === rootfsId,
      ),
    ).toHaveLength(1);
  });
  test("consolidates repeated targets and respects unknown targets", async () => {
    const report = await analyze(rootfs, {
      commands: ["docker build --target runtime .", "docker build --target runtime ."],
    });
    expect(report.findings.filter((finding) => finding.ruleId === rootfsId)).toHaveLength(1);
    expect(
      (await analyze(rootfs, { target: "${{ matrix.target }}" })).findings.filter(
        (finding) => finding.ruleId === rootfsId,
      ),
    ).toEqual([]);
  });
  test("tooling Dockerfile path is not treated as a runtime", async () => {
    expect(
      (await analyze(rootfs, { dockerfile: "Dockerfile.dev" })).findings.filter(
        (finding) => finding.ruleId === rootfsId,
      ),
    ).toEqual([]);
  });
});

describe("extraction-only copied archive layers", () => {
  test.each([
    ["tar gzip", archive],
    ["plain tar flags", archive.replace("tar -xzf", "tar -xf")],
    ["tar flags without dash", archive.replace("tar -xzf", "tar xzf")],
    ["separate tar operation and file flags", archive.replace("tar -xzf", "tar -x -z -f")],
    [
      "attached short file and directory options",
      archive.replace(
        "tar -xzf /tmp/bundle.tar.gz -C /app",
        "tar -x -z -f/tmp/bundle.tar.gz -C/app",
      ),
    ],
    [
      "get extraction alias",
      archive.replace(
        "tar -xzf /tmp/bundle.tar.gz -C /app",
        "tar --get --file=/tmp/bundle.tar.gz --directory=/app",
      ),
    ],
    [
      "long flags",
      archive.replace(
        "tar -xzf /tmp/bundle.tar.gz -C /app",
        "tar --extract --file=/tmp/bundle.tar.gz --directory=/app",
      ),
    ],
    ["strip-components preserved", archive.replace("-C /app", "-C /app --strip-components=1")],
    [
      "renamed archive",
      archive
        .replace("COPY bundle.tar.gz /tmp/", "COPY bundle.tar.gz /tmp/input.data")
        .replaceAll("/tmp/bundle.tar.gz", "/tmp/input.data"),
    ],
    [
      "relative archive path",
      archive
        .replace("RUN tar", "WORKDIR /tmp\nRUN tar")
        .replaceAll("/tmp/bundle.tar.gz", "bundle.tar.gz"),
    ],
    ["mkdir before extraction", archive.replace("RUN tar", "RUN mkdir -p /app && tar")],
    ["separate cleanup", archive.replace(" && rm", "\nRUN rm")],
    [
      "JSON extraction and cleanup",
      archive.replace(
        "RUN tar -xzf /tmp/bundle.tar.gz -C /app && rm /tmp/bundle.tar.gz",
        'RUN ["tar", "-xf", "/tmp/bundle.tar.gz", "-C", "/app"]\nRUN ["rm", "/tmp/bundle.tar.gz"]',
      ),
    ],
    [
      "ZIP extraction",
      archive
        .replaceAll("bundle.tar.gz", "bundle.zip")
        .replace("tar -xzf /tmp/bundle.zip -C /app", "unzip -q /tmp/bundle.zip -d /app"),
    ],
  ])("warns: %s", async (_name, body) => {
    const report = await analyze(body);
    const findings = report.findings.filter((finding) => finding.ruleId === archiveId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
    expect(findings[0]?.suggestion).toContain("file bind mount");
    expect(findings[0]?.suggestion).toContain("ADD does not auto-extract ZIP");
  });
  test.each([
    ["archive retained for later use", archive.replace(" && rm /tmp/bundle.tar.gz", "")],
    [
      "signature checking is not inferred",
      archive.replace("RUN tar", "RUN verify /tmp/bundle.tar.gz && tar"),
    ],
    ["unrelated command before extraction", archive.replace("RUN tar", "RUN ./prepare.sh && tar")],
    [
      "later reader before removal",
      archive.replace(" && rm", "\nRUN upload /tmp/bundle.tar.gz\nRUN rm"),
    ],
    [
      "export before removal",
      archive.replace(" && rm", "\nCOPY /tmp/bundle.tar.gz /keep.tar.gz\nRUN rm"),
    ],
    ["listing is not extraction", archive.replace("tar -xzf", "tar -tzf")],
    ["creating is not extraction", archive.replace("tar -xzf", "tar -czf")],
    ["stdout extraction", archive.replace("tar -xzf", "tar --to-stdout -xzf")],
    ["rootfs extraction is not inferred", archive.replace("-C /app", "-C /")],
    ["wrong cleanup path", archive.replace("rm /tmp/bundle.tar.gz", "rm /tmp/other.tar.gz")],
    [
      "same basename at a different extraction path",
      archive.replace("tar -xzf /tmp/bundle.tar.gz", "tar -xzf /other/bundle.tar.gz"),
    ],
    [
      "attached file option must reference the copied archive",
      archive.replace("tar -xzf /tmp/bundle.tar.gz", "tar -x -f/other/bundle.tar.gz"),
    ],
    [
      "attached directory option still excludes rootfs extraction",
      archive.replace("-C /app", "-C/"),
    ],
    [
      "stage boundary does not carry a copied archive into an unrelated base",
      archive.replace("RUN tar", "FROM alpine:3.22 AS output\nRUN tar"),
    ],
    [
      "copy without extraction",
      archive.replace("tar -xzf /tmp/bundle.tar.gz -C /app && rm /tmp/bundle.tar.gz", "echo ready"),
    ],
    [
      "cleanup removes other files too",
      archive.replace("rm /tmp/bundle.tar.gz", "rm /tmp/bundle.tar.gz /etc/important"),
    ],
    ["dynamic output", archive.replace("-C /app", "-C $OUTPUT")],
    [
      "copied from another stage",
      archive.replace("COPY bundle.tar.gz", "COPY --from=external /bundle.tar.gz"),
    ],
    [
      "copy ownership flags",
      archive.replace("COPY bundle.tar.gz", "COPY --chown=app bundle.tar.gz"),
    ],
    [
      "multiple copy sources",
      archive.replace("COPY bundle.tar.gz", "COPY bundle.tar.gz bundle.zip"),
    ],
    [
      "archive missing from context",
      archive
        .replace("COPY bundle.tar.gz", "COPY missing.tar.gz")
        .replaceAll("/tmp/bundle.tar.gz", "/tmp/missing.tar.gz"),
    ],
    ["nonarchive source", archive.replaceAll("bundle.tar.gz", "go.mod")],
    ["quoted extraction text", archive.replace("RUN tar", "RUN echo tar")],
    [
      "existing mount hides copied file",
      archive.replace(
        "RUN tar",
        "RUN --mount=type=bind,source=bundle.tar.gz,target=/tmp/bundle.tar.gz tar",
      ),
    ],
    ["conditional shell", archive.replace(" && rm", " || rm")],
    [
      "mounted cleanup does not remove the copied file",
      archive.replace(" && rm", "\nRUN --mount=type=tmpfs,target=/tmp rm"),
    ],
  ])("excludes: %s", async (_name, body) => {
    const report = await analyze(body);
    expect(report.findings.filter((finding) => finding.ruleId === archiveId)).toEqual([]);
  });
  test("archive inputs in unused stages are excluded but explicit targets are inspected", async () => {
    const body = `${archive}\nFROM scratch AS output\nCOPY file /file`;
    expect(
      (await analyze(body)).findings.filter((finding) => finding.ruleId === archiveId),
    ).toEqual([]);
    expect(
      (await analyze(body, { target: "base" })).findings.filter(
        (finding) => finding.ruleId === archiveId,
      ),
    ).toHaveLength(1);
  });
  test("artifact-only builder remains a snapshot/cache opportunity", async () => {
    const body = `${archive}\nFROM scratch\nCOPY --from=base /app /app`;
    const report = await analyze(body);
    const finding = report.findings.find((item) => item.ruleId === archiveId);
    expect(finding?.message).toContain("COPY line 2");
    expect(finding?.why).toContain("only decrease when");
  });
  test("bind input is already temporary", async () => {
    const report = await analyze(
      "FROM alpine:3.22\nRUN --mount=type=bind,source=bundle.tar.gz,target=/tmp/bundle.tar.gz tar -xzf /tmp/bundle.tar.gz -C /app",
    );
    expect(report.findings.filter((finding) => finding.ruleId === archiveId)).toEqual([]);
  });
  test("aggregates independent archives and repeated workflow builds", async () => {
    const body = `${archive}\nCOPY bundle.zip /tmp/\nRUN unzip /tmp/bundle.zip -d /other && rm /tmp/bundle.zip`;
    const report = await analyze(body, { commands: ["docker build .", "docker build ."] });
    const findings = report.findings.filter((finding) => finding.ruleId === archiveId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("bundle.tar.gz");
    expect(findings[0]?.message).toContain("bundle.zip");
  });
});
