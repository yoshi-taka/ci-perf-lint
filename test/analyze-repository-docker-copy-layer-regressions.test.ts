import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rootfsId = "dockerfile-runtime-copies-builder-rootfs";
const archiveId = "dockerfile-extracts-copied-archive";
// Distilled immutable upstream recipes; no network requests or container builds.
const module = "github.com/johan-lejdung/go-microservice-api-guide";
const go =
  'FROM golang:1.15-alpine3.12 as builder\nWORKDIR $GOPATH/src/github.com/johan-lejdung/go-microservice-api-guide\nCOPY ./ .\nRUN GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -v\nRUN cp go-microservice-api-guide /\nFROM alpine:3.12\nCOPY --from=builder / /\nCMD ["/go-microservice-api-guide"]';
const jdk =
  "FROM ubuntu:focal\nRUN mkdir -p /build/software/java\nCOPY OpenJDK11U-jdk_x64_linux_hotspot_11.0.4_11.tar.gz /build/software/java\nRUN tar -xvzf /build/software/java/OpenJDK11U-jdk_x64_linux_hotspot_11.0.4_11.tar.gz --directory /build/software/java && rm /build/software/java/OpenJDK11U-jdk_x64_linux_hotspot_11.0.4_11.tar.gz";
const tardis =
  'FROM node:26.7.0-bookworm-slim AS package\nCOPY publish-artifact/tardis-machine.tgz /tmp/tardis-machine.tgz\nRUN mkdir /tmp/tardis-machine && tar -xzf /tmp/tardis-machine.tgz --strip-components=1 -C /tmp/tardis-machine && node /tmp/tardis-machine/bin/tardis-machine.js --version > /dev/null && node --input-type=module --eval "await import(\'/tmp/tardis-machine/dist/index.js\')" && rm /tmp/tardis-machine.tgz\nFROM node:26.7.0-bookworm-slim\nCOPY --from=package /tmp/tardis-machine /opt/tardis-machine\nENTRYPOINT ["node", "/opt/tardis-machine/bin/tardis-machine.js"]';
const pack =
  'mkdir publish-artifact\nfor attempt in $(seq 1 60); do\n  if npm pack "tardis-machine@$VERSION" --ignore-scripts --pack-destination publish-artifact; then\n    break\n  fi\n  if [ "$attempt" -eq 60 ]; then\n    exit 1\n  fi\n  sleep 10\ndone\nmv publish-artifact/*.tgz publish-artifact/tardis-machine.tgz';
const guppy =
  'FROM busybox AS unpack\nWORKDIR unpack\nCOPY server/dist/guppyflo_x86_64.zip /\nRUN unzip /guppyflo_x86_64.zip\nFROM alpine:latest\nCOPY --from=unpack /unpack/ /guppyflo/\nWORKDIR /guppyflo\nCMD ["/guppyflo/guppyflo"]';

async function findings(
  body: string,
  id: string,
  options: {
    files?: Record<string, string>;
    before?: string;
    after?: string;
    condition?: string;
    workingDirectory?: string;
  } = {},
) {
  const root = await tempDirs.create("apl-copy-real-shapes-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  const run = (text: string) =>
    `      - run: |\n${text
      .split("\n")
      .map((line) => `          ${line}`)
      .join(
        "\n",
      )}${options.condition ? `\n        if: ${options.condition}` : ""}${options.workingDirectory ? `\n        working-directory: ${options.workingDirectory}` : ""}\n`;
  await writeFile(
    path.join(workflows, "build.yml"),
    `name: build\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n${options.before ? run(options.before) : ""}      - uses: docker/build-push-action@v6\n        with:\n          context: .\n${options.after ? run(options.after) : ""}`,
  );
  await writeFile(path.join(root, "Dockerfile"), body);
  for (const [file, text] of Object.entries(
    options.files ?? {
      "go.mod": `module ${module}\n\ngo 1.15\n`,
      "main.go": "package main\nfunc main() {}\n",
    },
  )) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === id);
}

describe("proof-backed builder rootfs coverage", () => {
  test.each([
    ["default Go output copied to root", go],
    [
      "literal GOPATH override",
      go.replace("WORKDIR $GOPATH", "ENV GOPATH=/workspace\nWORKDIR $GOPATH"),
    ],
    ["legacy ENV syntax", go.replace("WORKDIR $GOPATH", "ENV GOPATH /workspace\nWORKDIR $GOPATH")],
    ["cp in the compile RUN", go.replace("\nRUN cp", " && cp")],
    [
      "deleting unrelated temporary files",
      go.replace("FROM alpine:3.12", "RUN rm -rf /tmp/unrelated\nFROM alpine:3.12"),
    ],
  ])("warns: %s", async (_name, body) => {
    const result = await findings(body, rootfsId);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("/go-microservice-api-guide");
    expect(result[0]?.suggestion).toContain("runtime assets");
  });
  test.each([
    ["unknown base environment", go.replace("$GOPATH", "$UNKNOWN")],
    [
      "copied executable is not the compiler output",
      go.replace("RUN cp go-microservice-api-guide", "RUN cp unrelated"),
    ],
    [
      "compiler removed",
      go.replace("FROM alpine:3.12", "RUN rm -rf /usr/local/go\nFROM alpine:3.12"),
    ],
    [
      "compiler partially changed",
      go.replace("FROM alpine:3.12", "RUN ./trim-rootfs.sh\nFROM alpine:3.12"),
    ],
    [
      "copied binary subsequently deleted",
      go.replace("FROM alpine:3.12", "RUN rm /go-microservice-api-guide\nFROM alpine:3.12"),
    ],
    ["context module was not copied", go.replace("COPY ./ .", "COPY other/ .")],
    ["different build mode", go.replace("go build", "go build -buildmode=archive")],
    [
      "opaque output overwrite",
      go.replace(
        "FROM alpine:3.12",
        "COPY replacement /go-microservice-api-guide\nFROM alpine:3.12",
      ),
    ],
  ])("excludes: %s", async (_name, body) => {
    expect(await findings(body, rootfsId)).toEqual([]);
  });
  test("requires a main package and module metadata for default output inference", async () => {
    expect(
      await findings(go, rootfsId, {
        files: { "go.mod": `module ${module}\n`, "lib.go": "package lib\n" },
      }),
    ).toEqual([]);
    expect(await findings(go, rootfsId, { files: { "main.go": "package main\n" } })).toEqual([]);
    expect(
      await findings(go, rootfsId, {
        files: { "go.mod": "module example.com/different\n", "main.go": "package main\n" },
      }),
    ).toEqual([]);
  });
  test("preserves normal flattening exceptions", async () => {
    const runtime =
      'FROM python:3.11-alpine AS build\nRUN apk add --virtual .build gcc && pip install app && apk del .build && rm -rf /tmp/*\nFROM scratch\nCOPY --from=build / /\nENTRYPOINT ["/sbin/tini", "--", "mkdocs"]';
    const toolchain =
      'FROM ubuntu AS build\nRUN install-toolchain\nFROM scratch\nCOPY --from=build / /\nCMD ["/bin/bash"]';
    expect(await findings(runtime, rootfsId)).toEqual([]);
    expect(await findings(toolchain, rootfsId)).toEqual([]);
  });
  test("main-package proof does not come from comments or example strings", async () => {
    for (const source of [
      "/* example:\npackage main\n*/\npackage lib\n",
      "package lib\nvar Example = `\npackage main\n`\n",
    ]) {
      expect(
        await findings(go, rootfsId, {
          files: { "go.mod": `module ${module}\n`, "lib.go": source },
        }),
      ).toEqual([]);
    }
  });
});

describe("proof-backed temporary archive inputs", () => {
  test("JDK COPY into a previously created directory uses a relocated input", async () => {
    const result = await findings(jdk, archiveId, {
      files: { "OpenJDK11U-jdk_x64_linux_hotspot_11.0.4_11.tar.gz": "prepared external input" },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.location.line).toBe(3);
    expect(result[0]?.aiHandoff).toContain("/__ci_perf_lint_archive_3.input");
    expect(result[0]?.aiHandoff).toContain("/build/software/java");
  });
  test("CI npm pack and literal rename establish a generated input before the build", async () => {
    const result = await findings(tardis, archiveId, { files: {}, before: pack });
    expect(result).toHaveLength(1);
    expect(result[0]?.suggestion).toContain("verification");
    expect(result[0]?.aiHandoff).toContain("/tmp/tardis-machine.tgz");
    expect(result[0]?.why).toContain("only decrease when");
  });
  test("existing package payload also permits the preserved Node checks", async () => {
    expect(
      await findings(tardis, archiveId, {
        files: { "publish-artifact/tardis-machine.tgz": "prepared package" },
      }),
    ).toHaveLength(1);
  });
  test.each([
    ["generation after build", { after: pack }],
    ["conditional packaging step", { before: pack, condition: "false" }],
    [
      "dynamic output rename",
      {
        before: pack.replace(
          "mv publish-artifact/*.tgz publish-artifact/tardis-machine.tgz",
          "mv publish-artifact/*.tgz $OUTPUT",
        ),
      },
    ],
    ["dry-run packaging", { before: pack.replace("npm pack", "npm pack --dry-run") }],
    ["working directory changes", { before: `cd other\n${pack}` }],
    ["wrong step directory", { before: pack, workingDirectory: "other" }],
    ["early successful exit", { before: `exit 0\n${pack}` }],
    ["input removed after packaging", { before: `${pack}\nrm -rf publish-artifact` }],
    [
      "inline input removal",
      {
        before: pack.replace(
          "mv publish-artifact/*.tgz publish-artifact/tardis-machine.tgz",
          "mv publish-artifact/*.tgz publish-artifact/tardis-machine.tgz && rm publish-artifact/tardis-machine.tgz",
        ),
      },
    ],
  ])("does not infer missing input: %s", async (_name, options) => {
    expect(await findings(tardis, archiveId, { files: {}, ...options })).toEqual([]);
  });
  test.each([
    [
      "arbitrary eval body",
      tardis.replace(
        "await import('/tmp/tardis-machine/dist/index.js')",
        "await import('/tmp/tardis-machine/dist/index.js'); writeArchive()",
      ),
    ],
    [
      "verification executable outside extraction output",
      tardis.replace(
        "/tmp/tardis-machine/bin/tardis-machine.js --version",
        "/unrelated/check.js --version",
      ),
    ],
    ["redirect can overwrite input", tardis.replace("> /dev/null", "> /tmp/tardis-machine.tgz")],
    [
      "verification after input cleanup",
      tardis
        .replace(" && rm /tmp/tardis-machine.tgz", "")
        .replace(
          " && node /tmp/tardis-machine",
          " && rm /tmp/tardis-machine.tgz && node /tmp/tardis-machine",
        ),
    ],
  ])("excludes uncertain verification: %s", async (_name, body) => {
    expect(await findings(body, archiveId, { files: {}, before: pack })).toEqual([]);
  });
  test("artifact-only ZIP export does not require otherwise unnecessary cleanup", async () => {
    const result = await findings(guppy, archiveId, {
      files: {},
      before: "mkdir -p server/dist\nzip -rq server/dist/guppyflo_x86_64.zip server/bin",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("artifact-only consumers");
    expect(result[0]?.message).not.toContain("undefined");
  });
  test.each([
    [
      "archive itself exported",
      guppy.replace("/unpack/ /guppyflo/", "/guppyflo_x86_64.zip /bundle.zip"),
    ],
    ["whole root exported", guppy.replace("/unpack/ /guppyflo/", "/ /")],
    ["source ancestry inherited", `${guppy}\nFROM unpack AS archive-runtime`],
    [
      "source script may still need archive",
      guppy.replace("FROM alpine:latest", "RUN ./publish.sh\nFROM alpine:latest"),
    ],
  ])("keeps intentional retained inputs: %s", async (_name, body) => {
    expect(
      await findings(body, archiveId, {
        files: { "server/dist/guppyflo_x86_64.zip": "prepared package" },
      }),
    ).toEqual([]);
  });
});

describe("local ADD source classification", () => {
  test.each([
    ["ordinary local file", "ADD file.txt /app/", true],
    ["local directory", "ADD app/ /app/", true],
    ["plain tar", "ADD file.tar /app/", false],
    ["gzip candidate", "ADD file.gz /app/", false],
    ["bzip2 candidate", "ADD file.bz2 /app/", false],
    ["xz candidate", "ADD file.xz /app/", false],
    ["zstd tar", "ADD file.tar.zst /app/", false],
    ["tgz alias", 'ADD "file.tgz" /app/', false],
    ["tbz alias", "ADD file.tbz /app/", false],
    ["tbz2 alias", "ADD file.tbz2 /app/", false],
    ["txz alias", "ADD file.txz /app/", false],
    ["tzst alias", "ADD file.tzst /app/", false],
    ["ZIP is not auto-extracted", "ADD file.zip /app/", true],
    ["quoted ZIP", 'ADD "file.zip" /app/', true],
    ["archive suffix must end the source", "ADD file.tar.gz.txt /app/", true],
    ["HTTP download", "ADD http://example.com/file.txt /app/", false],
    ["quoted HTTPS download", 'ADD "https://example.com/file.zip" /app/', false],
    ["Git URL", "ADD git://example.com/repo.git /app/", false],
    ["SSH Git URL", "ADD ssh://git@example.com/repo.git /app/", false],
    ["SCP-style Git URL", "ADD git@example.com:team/repo.git /app/", false],
    ["remote URL with flag", "ADD --checksum=sha256:abc https://example.com/file.txt /app/", false],
    ["archive with ownership flag", "ADD --chown=app:app file.tar.gz /app/", false],
    ["local file with mode flag", "ADD --chmod=0644 file.txt /app/", true],
    ["all sources are archives", "ADD file.tar.gz file.tar.xz /app/", false],
    ["local file mixed with archive", "ADD file.tar.gz file.txt /app/", true],
    ["local file mixed with remote URL", "ADD https://example.com/file.txt local.txt /app/", true],
    ["JSON local file with spaces", 'ADD ["file name.txt", "/app/"]', true],
    ["JSON archive", 'ADD ["file.tar.gz", "/app/"]', false],
    ["dynamic source", "ADD ${SOURCE} /app/", false],
    ["ONBUILD local file", "ONBUILD ADD file.txt /app/", true],
    ["ONBUILD archive", "ONBUILD ADD file.tar.gz /app/", false],
    ["ONBUILD JSON ZIP", 'ONBUILD ADD ["file.zip", "/app/"]', true],
    ["COPY already explicit", "COPY file.txt /app/", false],
  ] as const)("%s", async (_name, instruction, flagged) => {
    const result = await findings(
      `FROM alpine:3.22\n${instruction}`,
      "dockerfile-add-without-clear-need",
      { files: {} },
    );
    expect(result).toHaveLength(flagged ? 1 : 0);
    if (flagged) {
      expect(result[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
      expect(result[0]?.suggestion).toContain("COPY");
    }
  });
});
