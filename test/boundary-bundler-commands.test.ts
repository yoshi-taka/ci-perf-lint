import { describe, expect, test } from "bun:test";
import { textRunsBundlerInstall } from "../src/rules/shared/bundler-commands.ts";

describe("Bundler install command boundaries", () => {
  test.each([
    ["bundle install", true],
    ["bundle check || bundle install", true],
    ["bundle install && bundle exec rspec", true],
    ["bundle exec rspec; bundle install", true],
    ["bundle install --no-cache", true],
    ["bundle install --jobs 4 --no-cache", true],
    ["bundle --no-cache install", true],
    ["bundle --no-cache=false install", true],
    ["echo --no-cache && bundle install", true],
    ["bundle check --no-cache || bundle install", true],
    ["bundle _2.5.0_ install", true],
    ["bundle", true],
    ["bundle --quiet", true],
    ["bundler install", true],
    ["ruby -S bundle install", true],
    ["env BUNDLE_GEMFILE=gemfiles/test.gemfile bundle install", true],
    ["BUNDLE_WITHOUT=development bundle install", true],
    ["/opt/ruby/bin/bundle install", true],
    ["bundle --gemfile Gemfile install", true],
    ["bundle install \\\n  --jobs 4", true],
    ["bundle install # bundle exec rspec", true],
    ["bundle --gemfile 'bundle install' check", false],
    ["bundle --gemfile", false],
    ["bundle install --gemfile", false],
    ["bundle --unknown install", false],
    ["bundle check", false],
    ["bundle outdated", false],
    ["bundle audit", false],
    ["bundle exec bundle install", false],
    ["bundle help install", false],
    ["bundle install --help", false],
    ["bundle --version", false],
    ["bundle -v", false],
    ["echo 'bundle install'", false],
    ['printf "%s" "bundle install"', false],
    ["# bundle install", false],
    ["notbundle install", false],
    ["cat <<EOF\nbundle install\nEOF", false],
    ["sh -c 'bundle install'", false],
  ] as const)("%s", (command, expected) => {
    expect(textRunsBundlerInstall(command)).toBe(expected);
  });
});
