export function normalizeWorkflowText(text: string, workflow: string): string {
  return text.split(workflow).join("<workflow>");
}

export function mergeSingleJobCrossWorkflowEntries<
  T extends {
    workflow: string;
    ruleId: string;
    workflows: string[];
    jobs: string[];
    firstIndex: number;
    scope?: "workflow" | "repository";
  },
>(
  entries: T[],
  buildSharedKey: (entry: T) => string,
  mergeEntries: (target: T, source: T) => void,
  shouldMergeEntry: (entry: T) => boolean = (entry) =>
    entry.scope !== "repository" && entry.jobs.length === 1,
): T[] {
  const merged = new Map<string, T>();

  for (const entry of entries) {
    if (!shouldMergeEntry(entry)) {
      merged.set(`${entry.workflow}::${entry.ruleId}::${entry.firstIndex}`, entry);
      continue;
    }

    const key = buildSharedKey(entry);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }

    mergeEntries(existing, entry);
    existing.firstIndex = Math.min(existing.firstIndex, entry.firstIndex);
  }

  return [...merged.values()].sort((left, right) => left.firstIndex - right.firstIndex);
}
