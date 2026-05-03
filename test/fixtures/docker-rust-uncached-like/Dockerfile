FROM rust:1.90 AS build
WORKDIR /app
RUN cargo install cargo-chef sccache
COPY Cargo.toml Cargo.lock ./
COPY . .
RUN cargo build --release
