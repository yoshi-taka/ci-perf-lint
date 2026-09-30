// @ts-nocheck
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";

export class Stack {
  build() {
    new DockerImageFunction(this, "A", { code: DockerImageCode.fromImageAsset("./a") });
    new DockerImageFunction(this, "B", { code: DockerImageCode.fromImageAsset("./b") });
  }
}
