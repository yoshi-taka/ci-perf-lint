import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { collectDockerfileInstructions } from "../src/repository-diagnostics/dockerfile-parser.ts";

const small = [
  "FROM node:22 AS build",
  "WORKDIR /app",
  'COPY ["package.json", "bun.lock", "./"]',
  "RUN --mount=type=cache,target=/root/.bun/install/cache bun ci",
  "COPY . .",
  "RUN bun run build",
];
const large = [
  "FROM alpine:3.22",
  ...Array.from({ length: 1000 }, (_, i) => `RUN --mount=type=cache,target=/cache echo step${i}`),
];
const heredoc = [
  "FROM alpine:3.22",
  "RUN cat <<EOF",
  ...Array.from({ length: 2000 }, (_, i) => `COPY literal${i} /data`),
  "EOF",
  'CMD ["sh"]',
];

const bench = withCodSpeed(new Bench({ iterations: 25, time: 0, warmup: false }));
bench
  .add("Dockerfile extraction > small build", () => {
    collectDockerfileInstructions(small);
  })
  .add("Dockerfile extraction > 1001 instructions", () => {
    collectDockerfileInstructions(large);
  })
  .add("Dockerfile extraction > 2000-line heredoc", () => {
    collectDockerfileInstructions(heredoc);
  });

export { bench };
