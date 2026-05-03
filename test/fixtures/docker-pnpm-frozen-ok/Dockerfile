FROM node:22
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm fetch --frozen-lockfile
COPY package.json ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --offline
COPY . .
