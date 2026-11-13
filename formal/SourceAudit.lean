import Lean

/- Source policy model. Typed post-parse facts and mathematical naturals only.
   Does not prove AST extraction, filesystem resolution, JS execution or scope analysis. -/
namespace SourceAudit

def restricted (runtime bindings suppressed : Bool) : Bool :=
  runtime && bindings && !suppressed

def extensions (runtime relative extension query suppressed : Bool) : Bool :=
  runtime && relative && !extension && !query && !suppressed

theorem restricted_exact (r b s : Bool) :
    restricted r b s = true ↔ r = true ∧ b = true ∧ s = false := by
  cases r <;> cases b <;> cases s <;> decide

theorem extensions_exact (r p e q s : Bool) :
    extensions r p e q s = true ↔
      r = true ∧ p = true ∧ e = false ∧ q = false ∧ s = false := by
  cases r <;> cases p <;> cases e <;> cases q <;> cases s <;> decide

-- The bounded counter stops at limit+1, preserving the > predicate for any count.
def cappedCount (count limit : Nat) : Nat := min count (limit + 1)

theorem capped_exact (count limit : Nat) :
    cappedCount count limit > limit ↔ count > limit := by
  unfold cappedCount
  omega

theorem capped_bound (count limit : Nat) : cappedCount count limit ≤ limit + 1 := by
  unfold cappedCount
  omega

theorem threshold_monotone (count larger limit : Nat) (h : count ≤ larger)
    (large : count > limit) : larger > limit := by omega

-- A unique-reference model, not an edge count: a root is removed before deduplication.
def references (root : Nat) (targets : List Nat) : List Nat :=
  (targets.filter (· != root)).eraseDups

theorem root_excluded (root : Nat) (targets : List Nat) :
    root ∉ references root targets := by
  simp [references]

theorem duplicate_invariant (root : Nat) (targets : List Nat) (x : Nat) :
    x ∈ references root (targets ++ targets) ↔ x ∈ references root targets := by
  simp [references]

#print axioms restricted_exact
#print axioms extensions_exact
#print axioms capped_exact
#print axioms capped_bound
#print axioms threshold_monotone
#print axioms root_excluded
#print axioms duplicate_invariant

def main : IO Unit := do
  for bits in List.range 128 do
    let b := fun n => bits / 2^n % 2 == 1
    IO.println (Lean.Json.compress (Lean.Json.mkObj [
      ("bits", Lean.toJson bits),
      ("restricted", Lean.toJson (restricted (b 0) (b 1) (b 5))),
      ("extensions", Lean.toJson (extensions (b 0) (b 2) (b 3) (b 4) (b 6)))]))
  for limit in [50, 100, 300] do
    for count in List.range 302 do
      IO.println (Lean.Json.compress (Lean.Json.mkObj [
        ("count", Lean.toJson count), ("limit", Lean.toJson limit),
        ("large", Lean.toJson (decide (count > limit))),
        ("capped", Lean.toJson (cappedCount count limit))]))

end SourceAudit

def main := SourceAudit.main
