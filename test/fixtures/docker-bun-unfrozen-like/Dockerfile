FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun i --production
COPY . .
