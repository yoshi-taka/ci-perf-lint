import type { CircleCiDocument } from "./circleci-workflow.ts";
import { isMap } from "./yaml.ts";

/** CircleCI orb declarations that indicate an Elixir/beam toolchain. */
export function circleCiHasElixirOrbEvidence(doc: CircleCiDocument): boolean {
  const orbs = doc.root?.get("orbs", true);
  if (isMap(orbs)) {
    for (const pair of orbs.items) {
      const value =
        (pair.value as { toJSON?: () => unknown } | undefined)?.toJSON?.() ?? pair.value;
      if (typeof value === "string" && /erlef\/|elixir|beam/i.test(value)) {
        return true;
      }
    }
  }
  return /orbs:[\s\S]*?(?:erlef\/|elixir|beam)/i.test(doc.source ?? "");
}

/** Orb steps that compile dependencies without a visible `mix` command. */
export function circleCiElixirOrbCompilesDeps(doc: CircleCiDocument): boolean {
  return doc.jobs.some((job) =>
    job.steps.some((step) => {
      const type = step.type;
      return /mix_get_and_compile_deps|\/compile\b/i.test(type) && /elixir|mix|beam/i.test(type);
    }),
  );
}
