import type { ResourceId } from "./semantic-resource.ts";

export class ResourceCache {
  private readonly store = new Map<ResourceId, Promise<unknown>>();

  get<T>(id: ResourceId): Promise<T> | undefined {
    return this.store.get(id) as Promise<T> | undefined;
  }

  set<T>(id: ResourceId, value: Promise<T>): void {
    this.store.set(id, value);
  }

  has(id: ResourceId): boolean {
    return this.store.has(id);
  }

  clear(): void {
    this.store.clear();
  }
}
