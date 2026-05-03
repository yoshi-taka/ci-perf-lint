// @ts-nocheck
export class DeploymentStack {
  constructor() {
    new BucketDeployment(this, "WebsiteDeployment", {
      sources: [Source.asset("./dist")],
      destinationBucket: this.bucket,
      memoryLimit: 1024,
    });
  }
}
