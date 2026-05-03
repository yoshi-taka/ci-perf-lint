FROM rust:1.90 AS build
WORKDIR /app
RUN cargo install cargo-chef sccache --locked
RUN cargo install --path .
COPY Cargo.toml Cargo.lock ./
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    cargo build --release
