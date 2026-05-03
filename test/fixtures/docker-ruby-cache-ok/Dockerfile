FROM ruby:3.4 AS build
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN --mount=type=cache,target=/usr/local/bundle/cache \
    --mount=type=cache,target=/app/vendor/cache \
    bundle cache && bundle install && bundle clean --force
COPY . .
