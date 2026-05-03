FROM ruby:3.4 AS build
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .
