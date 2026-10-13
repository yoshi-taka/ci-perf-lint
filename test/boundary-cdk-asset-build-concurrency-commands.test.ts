import { expect, test } from "bun:test";
import { textDeploysCdkWithoutAssetBuildConcurrency } from "../src/rules/shared/cdk-express.ts";

test.each([
  ["cdk deploy", true],
  ["npx cdk deploy", true],
  ["npx --yes cdk deploy", true],
  ["npx aws-cdk@2.1138.0 deploy", true],
  ["pnpm exec cdk deploy", true],
  ["./node_modules/.bin/cdk deploy", true],
  ["cdk --profile dev deploy", true],
  ["CI=true cdk deploy", true],
  ["cdk deploy --asset-build-concurrency 4", false],
  ["cdk deploy --asset-build-concurrency=4", false],
  ["cdk deploy --asset-build-concurrency=1", false],
  ["cdk deploy --asset-publishing-concurrency=4", true],
  ["cdk deploy && echo --asset-build-concurrency=4", true],
  ["cdk deploy --asset-build-concurrency=4 && cdk deploy", true],
  ["cdk deploy && cdk deploy --asset-build-concurrency=4", true],
  ["cdk deploy # --asset-build-concurrency=4", true],
  ['cdk deploy --app "node app.js --asset-build-concurrency=4"', true],
  ['cdk deploy --context "notice=value --asset-build-concurrency=4"', true],
  ["cdk deploy -- --asset-build-concurrency=4", true],
  ["cdk deploy --express --method=direct", true],
  ["echo 'cdk deploy'", false],
  ["cdk synth --app 'cdk deploy'", false],
  ["cdk destroy", false],
  ["cdk bootstrap", false],
  ["cdk deploy --help", false],
  ["cdk deploy --version", false],
  ["cat <<EOF\ncdk deploy\nEOF", false],
  ["cdk deploy $OPTIONS", false],
  ["cdk deploy --asset-build-concurrency=$WORKERS", false],
  ["cdk deploy --asset-build-concurrency", false],
] as const)("CDK asset-build concurrency belongs to each deploy: %s", (text, expected) => {
  expect(textDeploysCdkWithoutAssetBuildConcurrency(text)).toBe(expected);
});
