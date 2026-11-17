import Init

/- Model of the coverage-retention rule in `src/fuzz/retention.ts`.

   Scope: an input is represented only by the set of coverage keys it reaches.
   The boolean decision is bridged to `retainCoverage` by `formal/fuzz-models.ts`;
   mutation quality, execution, timeouts and worker restarts are not modeled. -/
namespace FuzzCoverage

abbrev Key := Nat
abbrev Coverage := List Key

structure State where
  seen : Coverage
  corpus : List Coverage

inductive Decision where
  | retain
  | skip
  deriving DecidableEq, Repr

def step (state : State) (coverage : Coverage) : Decision → State
  | .retain => { seen := coverage ++ state.seen, corpus := coverage :: state.corpus }
  | .skip => state

theorem skipped_unchanged (state : State) (coverage : Coverage) :
    step state coverage .skip = state := rfl

theorem retained_in_corpus (state : State) (coverage : Coverage) :
    coverage ∈ (step state coverage .retain).corpus := by
  simp [step]

theorem retained_seen_contains_new (state : State) (coverage : Coverage) :
    ∀ key, key ∈ coverage → key ∈ (step state coverage .retain).seen := by
  intro key member
  exact List.mem_append.mpr (Or.inl member)

theorem seen_monotone (state : State) (coverage : Coverage) (decision : Decision) :
    ∀ key, key ∈ state.seen → key ∈ (step state coverage decision).seen := by
  intro key member
  cases decision with
  | retain => exact List.mem_append.mpr (Or.inr member)
  | skip => exact member

theorem corpus_monotone (state : State) (coverage : Coverage) (decision : Decision) :
    ∀ entry, entry ∈ state.corpus → entry ∈ (step state coverage decision).corpus := by
  intro entry member
  cases decision with
  | retain => exact List.mem_cons_of_mem coverage member
  | skip => exact member

end FuzzCoverage
