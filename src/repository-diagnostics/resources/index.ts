import type { ResourceRegistry } from "../resource-registry.ts";
import { dockerBuildTargetsResource, dockerfileDataResource } from "./dockerfiles.ts";

export function registerDefaultResources(registry: ResourceRegistry): void {
  registry.register(dockerBuildTargetsResource);
  registry.register(dockerfileDataResource);
}
