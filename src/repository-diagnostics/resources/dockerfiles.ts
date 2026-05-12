import type { CollectedDockerfileData, DockerBuildTarget } from "../docker-build-targets.ts";
import type { ResourceId, SemanticResource } from "../semantic-resource.ts";

export const dockerBuildTargetsResourceId = "docker-build-targets" as ResourceId;
export const dockerfileDataResourceId = "dockerfile-data" as ResourceId;

export const dockerBuildTargetsResource: SemanticResource<DockerBuildTarget[]> = {
  id: dockerBuildTargetsResourceId,
  collect: async (ctx) => {
    const { collectDockerBuildTargets } = await import("../docker-build-targets.ts");
    return collectDockerBuildTargets(
      ctx.repoRoot,
      [...ctx.workflows],
      ctx.warnings,
      ctx.scanContext,
    );
  },
};

export const dockerfileDataResource: SemanticResource<
  Map<string, CollectedDockerfileData | undefined>
> = {
  id: dockerfileDataResourceId,
  requires: [dockerBuildTargetsResourceId],
  collect: async (ctx, getResource) => {
    const targets = await getResource<DockerBuildTarget[]>(dockerBuildTargetsResourceId);
    const { collectDockerfileData } = await import("../docker-build-targets.ts");
    const results = new Map<string, CollectedDockerfileData | undefined>();
    const dockerfilePaths = [...new Set(targets.map((t) => t.dockerfilePath))];
    const entries = await Promise.all(
      dockerfilePaths.map(async (path) => {
        const data = await collectDockerfileData(ctx.scanContext, path);
        return [path, data] as const;
      }),
    );
    for (const [path, data] of entries) {
      results.set(path, data);
    }
    return results;
  },
};
