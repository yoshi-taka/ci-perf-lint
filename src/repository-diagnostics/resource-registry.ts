import type { ResourceId, SemanticResource } from "./semantic-resource.ts";

export class ResourceRegistry {
  private readonly defs = new Map<ResourceId, SemanticResource<unknown>>();

  register<T>(def: SemanticResource<T>): void {
    this.defs.set(def.id, def as SemanticResource<unknown>);
  }

  get<T>(id: ResourceId): SemanticResource<T> | undefined {
    return this.defs.get(id) as SemanticResource<T> | undefined;
  }

  ids(): readonly ResourceId[] {
    return [...this.defs.keys()];
  }

  has(id: ResourceId): boolean {
    return this.defs.has(id);
  }

  prerequisites(): Partial<Record<ResourceId, ResourceId[]>> {
    const prereqs: Partial<Record<ResourceId, ResourceId[]>> = {};
    for (const [id, def] of this.defs) {
      if (def.requires && def.requires.length > 0) {
        prereqs[id] = [...def.requires];
      }
    }
    return prereqs;
  }
}
