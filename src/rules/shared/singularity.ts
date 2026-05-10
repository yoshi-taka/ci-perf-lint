export type SingularityClass = "removable" | "pole" | "essential";

export interface SingularityFailure {
  readonly class: SingularityClass;
  readonly ruleId: string;
  readonly message: string;
  readonly error?: Error;
  readonly triggeredBy?: string;
}

const RECURSION_INDICATORS = [
  "Maximum call stack size exceeded",
  "too much recursion",
  "stack overflow",
  "Recursive",
] as const;

const CATASTROPHIC_REGEX_INDICATORS = [
  "Regex match timeout",
  "catastrophic backtrack",
  "exponential",
  "Runaway regex",
  "regex",
] as const;

const NON_DETERMINISTIC_INDICATORS = [
  "non-deterministic",
  "state corruption",
  "unstable",
  "concurrent modification",
  "race condition",
  "mutation",
] as const;

export function classifySingularity(
  error: unknown,
  ruleId: string,
  triggeredBy?: string,
): SingularityFailure {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "";

  if (error instanceof TypeError || error instanceof ReferenceError) {
    return {
      class: "removable",
      ruleId,
      message: errorMessage,
      error: error instanceof Error ? error : undefined,
      triggeredBy,
    };
  }

  const lowerMsg = errorMessage.toLowerCase();

  for (const indicator of RECURSION_INDICATORS) {
    if (lowerMsg.includes(indicator.toLowerCase())) {
      return {
        class: "pole",
        ruleId,
        message: errorMessage,
        error: error instanceof Error ? error : undefined,
        triggeredBy,
      };
    }
  }

  if (errorName === "RangeError" || lowerMsg.includes("maximum")) {
    return {
      class: "pole",
      ruleId,
      message: errorMessage,
      error: error instanceof Error ? error : undefined,
      triggeredBy,
    };
  }

  for (const indicator of CATASTROPHIC_REGEX_INDICATORS) {
    if (lowerMsg.includes(indicator.toLowerCase())) {
      return {
        class: "pole",
        ruleId,
        message: errorMessage,
        error: error instanceof Error ? error : undefined,
        triggeredBy,
      };
    }
  }

  for (const indicator of NON_DETERMINISTIC_INDICATORS) {
    if (lowerMsg.includes(indicator.toLowerCase())) {
      return {
        class: "essential",
        ruleId,
        message: errorMessage,
        error: error instanceof Error ? error : undefined,
        triggeredBy,
      };
    }
  }

  return {
    class: "pole",
    ruleId,
    message: errorMessage,
    error: error instanceof Error ? error : undefined,
    triggeredBy,
  };
}

export class SingularityTracker {
  readonly #failures: SingularityFailure[] = [];
  readonly #quarantinedRules = new Set<string>();
  readonly #poleTriggers = new Map<string, Set<string>>();

  get failures(): readonly SingularityFailure[] {
    return this.#failures;
  }

  get quarantinedRules(): ReadonlySet<string> {
    return this.#quarantinedRules;
  }

  record(failure: SingularityFailure): void {
    this.#failures.push(failure);

    if (failure.class === "essential") {
      this.#quarantinedRules.add(failure.ruleId);
      return;
    }

    if (failure.class === "pole" && failure.triggeredBy) {
      let triggers = this.#poleTriggers.get(failure.ruleId);
      if (!triggers) {
        triggers = new Set();
        this.#poleTriggers.set(failure.ruleId, triggers);
      }
      triggers.add(failure.triggeredBy);
    }
  }

  isQuarantined(ruleId: string): boolean {
    return this.#quarantinedRules.has(ruleId);
  }

  hasPoleTrigger(ruleId: string, triggerDescriptor: string): boolean {
    const triggers = this.#poleTriggers.get(ruleId);
    if (!triggers) {
      return false;
    }
    for (const t of triggers) {
      if (triggerDescriptor.includes(t) || t.includes(triggerDescriptor)) {
        return true;
      }
    }
    return false;
  }

  formatReport(): string {
    const parts: string[] = [];
    if (this.#quarantinedRules.size > 0) {
      parts.push(`Quarantined rules (essential): ${[...this.#quarantinedRules].join(", ")}`);
    }
    for (const [ruleId, triggers] of this.#poleTriggers) {
      parts.push(`Pole triggers for ${ruleId}: ${[...triggers].join(", ")}`);
    }
    if (this.#failures.length > 0) {
      const byClass = new Map<SingularityClass, SingularityFailure[]>();
      for (const f of this.#failures) {
        let list = byClass.get(f.class);
        if (!list) {
          list = [];
          byClass.set(f.class, list);
        }
        list.push(f);
      }
      for (const [cls, list] of byClass) {
        parts.push(
          `${cls} singularities (${list.length}): ${list.map((f) => f.ruleId).join(", ")}`,
        );
      }
    }
    return parts.join("\n");
  }
}
