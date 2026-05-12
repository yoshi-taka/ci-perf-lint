import { topologicalSort } from "../rules/shared/topo-sort.ts";
import type { ResourceCache } from "./resource-cache.ts";
import type { ResourceRegistry } from "./resource-registry.ts";
import type {
  ResourceEvaluationObservability,
  ResourceGetter,
  ResourceId,
} from "./semantic-resource.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

export class ResourceEvaluationError extends Error {
  constructor(
    public readonly resourceId: ResourceId,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ResourceEvaluationError";
    this.cause = cause;
  }
}

export interface ResourceEvaluationOptions {
  observability?: ResourceEvaluationObservability;
}

function buildResourceDag(
  registry: ResourceRegistry,
  needed: readonly ResourceId[],
): {
  successors: Map<ResourceId, readonly ResourceId[]>;
  allNodes: Set<ResourceId>;
} {
  const allNodes = new Set<ResourceId>();
  const successors = new Map<ResourceId, ResourceId[]>();

  function addDeps(id: ResourceId): void {
    if (allNodes.has(id)) {
      return;
    }
    allNodes.add(id);

    const def = registry.get(id);
    if (!def) {
      return;
    }

    const deps = def.requires ?? [];
    for (const dep of deps) {
      addDeps(dep);
      const succList = successors.get(dep) ?? [];
      if (!succList.includes(id)) {
        succList.push(id);
      }
      successors.set(dep, succList);
    }

    if (!successors.has(id)) {
      successors.set(id, []);
    }
  }

  for (const id of needed) {
    addDeps(id);
  }

  return {
    successors: successors as Map<ResourceId, readonly ResourceId[]>,
    allNodes,
  };
}

function batchedLevels<T extends string>(
  order: readonly T[],
  successors: Map<T, readonly T[]>,
): T[][] {
  const depth = new Map<T, number>();
  let maxDepth = 0;

  for (const node of order) {
    const d = depth.get(node) ?? 0;
    const succs = successors.get(node) ?? [];
    for (const succ of succs) {
      const nextDepth = d + 1;
      const existing = depth.get(succ) ?? 0;
      if (nextDepth > existing) {
        depth.set(succ, nextDepth);
      }
    }
    maxDepth = Math.max(maxDepth, d);
  }

  const levels: T[][] = [];
  for (let i = 0; i <= maxDepth; i++) {
    levels.push([]);
  }

  for (const [node, d] of depth) {
    levels[d]!.push(node);
  }

  for (const node of order) {
    if (!depth.has(node)) {
      levels[0]!.push(node);
    }
  }

  return levels;
}

export class ResourceEvaluator {
  constructor(
    private readonly registry: ResourceRegistry,
    private readonly cache: ResourceCache,
  ) {}

  async evaluate(
    ctx: RepositoryDiagnosticContext,
    needed: readonly ResourceId[],
    options?: ResourceEvaluationOptions,
  ): Promise<ResourceGetter> {
    if (needed.length === 0) {
      return makeGetter(new Map(), this.registry, this.cache, ctx);
    }

    const { successors, allNodes } = buildResourceDag(this.registry, needed);
    const order = topologicalSort(
      allNodes as Set<string>,
      successors as Map<string, readonly string[]>,
    );

    const obs = options?.observability ?? {
      resources: [],
      evaluationOrder: [],
      cacheHits: 0,
      cacheMisses: 0,
    };
    obs.evaluationOrder = order as ResourceId[];
    const resolved = new Map<ResourceId, unknown>();

    const batched = batchedLevels(order as string[], successors as Map<string, readonly string[]>);

    for (const level of batched) {
      await Promise.all(
        level.map(async (id) => {
          const resourceId = id as ResourceId;
          const cached = this.cache.get(resourceId);
          if (cached !== undefined) {
            const value = await cached;
            resolved.set(resourceId, value);
            obs.cacheHits++;
            const durationMs = 0;
            obs.resources.push({
              id: resourceId,
              value: value,
              status: "cached",
              durationMs,
            });
            return;
          }

          const def = this.registry.get(resourceId);
          if (!def) {
            throw new ResourceEvaluationError(
              resourceId,
              `Resource "${resourceId}" is not registered`,
            );
          }

          const startedAt = performance.now();
          try {
            const getter = makeGetter(resolved, this.registry, this.cache, ctx);
            const result = await def.collect(ctx, getter);
            const durationMs = performance.now() - startedAt;
            resolved.set(resourceId, result);
            this.cache.set(resourceId, Promise.resolve(result));
            obs.cacheMisses++;
            obs.resources.push({
              id: resourceId,
              value: result,
              status: "resolved",
              durationMs,
            });
            if (timingsEnabled()) {
              const label = def.requires?.length
                ? `resource ${resourceId} (deps:${def.requires.join(",")})`
                : `resource ${resourceId}`;
              process.stderr.write(`[timing] ${label}=${durationMs.toFixed(1)}ms\n`);
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new ResourceEvaluationError(resourceId, detail, error);
          }
        }),
      );
    }

    return makeGetter(resolved, this.registry, this.cache, ctx);
  }
}

function makeGetter(
  resolved: Map<ResourceId, unknown>,
  registry: ResourceRegistry,
  cache: ResourceCache,
  ctx: RepositoryDiagnosticContext,
): ResourceGetter {
  return async <T>(id: ResourceId): Promise<T> => {
    if (resolved.has(id)) {
      return resolved.get(id) as T;
    }

    const cached = cache.get<T>(id);
    if (cached !== undefined) {
      const value = await cached;
      resolved.set(id, value);
      return value as T;
    }

    const def = registry.get<T>(id);
    if (!def) {
      throw new ResourceEvaluationError(id, `Resource "${id}" is not registered`);
    }

    const startedAt = performance.now();
    const result = await def.collect(ctx, makeGetter(resolved, registry, cache, ctx));
    const durationMs = performance.now() - startedAt;
    cache.set(id, Promise.resolve(result));
    resolved.set(id, result);
    if (timingsEnabled()) {
      process.stderr.write(`[timing] resource ${id}=${durationMs.toFixed(1)}ms\n`);
    }
    return result;
  };
}
