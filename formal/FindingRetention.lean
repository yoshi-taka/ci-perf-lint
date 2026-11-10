import Lean

/- Projection of repo-finding-utils.ts, severity-promotion.ts and the mode/scope,
   deduplication/cap refiners at 67fd8ce. Tokens stand for complete diagnostics;
   score ordering and reporter aggregation are checked separately in the bridge.
   Caps/locations are finite nonnegative integers; no JS getters or resource model. -/
namespace FindingRetention

inductive Severity where
  | suggestion | warning | error
  deriving DecidableEq, Repr

inductive Scope where
  | missing | workflow | repository
  deriving DecidableEq, Repr

structure Finding where
  token : Nat
  rule : String
  severity : Severity
  scope : Scope
  repositorySource : Bool
  path : String
  line : Nat
  column : Nat
  deriving DecidableEq, Repr

def inMode (d : Finding) (exploratory : Bool) : Bool :=
  exploratory || decide (d.severity ≠ .suggestion)

def inScope (d : Finding) (workflowOnly repositoryOnly : Bool) : Bool :=
  if workflowOnly then decide (d.scope ≠ .repository)
  else if repositoryOnly then decide (d.scope = .repository)
  else true

def fixScope (d : Finding) : Finding :=
  if d.scope = .missing ∧ d.repositorySource then { d with scope := .repository } else d

def selected (xs : List Finding) (exploratory workflowOnly repositoryOnly : Bool) : List Finding :=
  xs.filter fun d => inScope d workflowOnly repositoryOnly && inMode d exploratory

theorem selection_exact (xs : List Finding) (d : Finding) (e w r : Bool) :
    d ∈ selected xs e w r ↔ d ∈ xs ∧ inScope d w r = true ∧ inMode d e = true := by
  simp [selected, Bool.and_eq_true]

theorem exploratory_keeps_all_severities (d : Finding) : inMode d true = true := by
  simp [inMode]

theorem scope_flags_workflow_precedence (d : Finding) : inScope d true true = inScope d true false := by
  rfl

theorem scope_fix_idempotent (d : Finding) : fixScope (fixScope d) = fixScope d := by
  unfold fixScope
  split <;> simp_all

def fallbackRules : List String := [
  "missing-paths-filter", "missing-path-ignore-for-non-code", "missing-concurrency",
  "missing-timeout-minutes", "missing-dependency-cache", "deep-checkout-without-need",
  "deep-checkout-excessive-depth", "prefer-sparse-checkout-for-scoped-workflow"]

def promote (xs : List Finding) (exploratory : Bool) : List Finding :=
  if !exploratory && !(xs.any fun d => decide (d.severity ≠ .suggestion)) then
    xs.map fun d => if d.severity = .suggestion ∧ d.rule ∈ fallbackRules then
      { d with severity := .warning } else d
  else xs

theorem promotion_preserves_tokens (xs : List Finding) (e : Bool) :
    (promote xs e).map Finding.token = xs.map Finding.token := by
  unfold promote
  split
  · simp only [List.map_map]
    congr 1
    funext d
    simp only [Function.comp_apply]
    split <;> rfl
  · rfl

def key (d : Finding) : String := s!"{d.path}:{d.line}"

def dedup (seen : List String) : List Finding → List Finding
  | [] => []
  | d :: rest => if key d ∈ seen then dedup seen rest else d :: dedup (key d :: seen) rest

theorem dedup_no_fabrication (xs : List Finding) (seen : List String) (d : Finding) :
    d ∈ dedup seen xs → d ∈ xs := by
  induction xs generalizing seen with
  | nil => simp [dedup]
  | cons head rest ih =>
    simp only [dedup]
    split
    · intro h; exact List.mem_cons_of_mem head (ih seen h)
    · simp only [List.mem_cons]
      intro h
      rcases h with h | h
      · exact Or.inl h
      · exact Or.inr (ih (key head :: seen) h)

-- The useful completeness guarantee is per path:line CLASS, not per rule.
-- Unlike a subset theorem alone, this rejects an implementation returning [].
theorem dedup_key_coverage (xs : List Finding) (seen : List String) (k : String) :
    k ∈ (dedup seen xs).map key ↔ k ∈ xs.map key ∧ k ∉ seen := by
  induction xs generalizing seen with
  | nil => simp [dedup]
  | cons head rest ih =>
    by_cases h : key head ∈ seen
    · simp only [dedup, ite_eq_left h, List.map_cons, List.mem_cons, ih]
      by_cases equal : k = key head <;> simp_all
    · simp only [dedup, ite_eq_right h, List.map_cons, List.mem_cons, ih]
      by_cases equal : k = key head <;> simp_all

theorem dedup_keys_unique (xs : List Finding) (seen : List String) :
    ((dedup seen xs).map key).Nodup := by
  induction xs generalizing seen with
  | nil => simp [dedup]
  | cons head rest ih =>
    by_cases h : key head ∈ seen
    · simpa [dedup, h] using ih seen
    · simp only [dedup, ite_eq_right h, List.map_cons, List.nodup_cons]
      constructor
      · intro member
        have covered := (dedup_key_coverage rest (key head :: seen) (key head)).mp member
        exact covered.2 (by simp)
      · exact ih _

def lookup : List (String × Nat) → String → Option Nat
  | [], _ => none
  | (key, n) :: rest, rule => if key = rule then some n else lookup rest rule

def increment (counts : List (String × Nat)) (rule : String) : List (String × Nat) :=
  if (lookup counts rule).isSome then
    counts.map fun (key, n) => (key, if key = rule then n + 1 else n)
  else counts ++ [(rule, 1)]

structure Capped where
  kept : List Finding := []
  counts : List (String × Nat) := []
  suppressed : List (String × Nat) := []

def capStep (caps : List (String × Nat)) (implied : List String) (s : Capped) (d : Finding) : Capped :=
  match lookup caps d.rule with
  | none => { s with kept := s.kept ++ [d] }
  | some max =>
    if d.rule ∈ implied then { s with kept := s.kept ++ [d] }
    else if (lookup s.counts d.rule).getD 0 ≥ max then
      { s with suppressed := increment s.suppressed d.rule }
    else { s with kept := s.kept ++ [d], counts := increment s.counts d.rule }

def cap (xs : List Finding) (caps : List (String × Nat)) (implied : List String) : Capped :=
  xs.foldl (capStep caps implied) {}

theorem implied_head_survives (caps : List (String × Nat)) (implied : List String)
    (s : Capped) (d : Finding) (h : d.rule ∈ implied) :
    (capStep caps implied s d).kept = s.kept ++ [d] := by
  simp only [capStep]
  split <;> simp [h]

def suggestion : Finding := ⟨0, "rule-a", .suggestion, .workflow, false, "ci.yml", 1, 1⟩
def warning : Finding := ⟨1, "rule-b", .warning, .workflow, false, "ci.yml", 1, 2⟩

-- Filtering an earlier suggestion AFTER deduplication can erase a later warning.
theorem dedup_mode_counterexample :
    (dedup [] [suggestion, warning]).filter (fun d => inMode d false) = [] ∧
    dedup [] ([suggestion, warning].filter (fun d => inMode d false)) = [warning] := by decide

theorem distinct_rules_same_line_counterexample :
    dedup [] [suggestion, warning] = [suggestion] := by decide

-- Undefined scope is treated as workflow even when source says repository.
theorem scope_fix_order_counterexample :
    let d := { warning with scope := .missing, repositorySource := true }
    inScope d false true = false ∧ inScope (fixScope d) false true = true := by decide

theorem cap_dedup_counterexample :
    let a := { warning with rule := "rule-a" }
    let b := { a with token := 2, line := 2 }
    let xs := [a, a, b]
    dedup [] (cap xs [("rule-a", 2)] []).kept = [a] ∧
      (cap (dedup [] xs) [("rule-a", 2)] []).kept = [a, b] := by decide

def prototypes : List Finding := [
  suggestion, warning,
  ⟨2, "rule-a", .error, .repository, true, "ci.yml", 1, 2⟩,
  ⟨3, "missing-timeout-minutes", .suggestion, .missing, false, "other.yml", 2, 1⟩,
  ⟨4, "rule-a", .warning, .missing, true, "other.yml", 2, 1⟩,
  ⟨5, "rule-a", .suggestion, .repository, false, "other.yml", 2, 3⟩,
  ⟨6, "rule-b", .warning, .workflow, true, "ci.yml", 2, 1⟩,
  ⟨7, "rule-b", .error, .missing, false, "日本語:ci.yml", 1, 1⟩]

def sequences : Nat → List (List Finding)
  | 0 => [[]]
  | n + 1 => (sequences n).flatMap fun xs => prototypes.map fun d => d :: xs

def tokenize (xs : List Finding) : List Finding := xs.zipIdx |>.map fun (d, i) => { d with token := i }
def tokens (xs : List Finding) : List Nat := xs.map Finding.token
def severityName : Severity → String
  | .suggestion => "suggestion" | .warning => "warning" | .error => "error"
def scopeJson : Scope → Lean.Json
  | .missing => .null | .workflow => Lean.toJson "workflow" | .repository => Lean.toJson "repository"

def findingJson (d : Finding) : Lean.Json := Lean.Json.mkObj [
  ("token", Lean.toJson d.token), ("rule", Lean.toJson d.rule),
  ("severity", Lean.toJson (severityName d.severity)), ("scope", scopeJson d.scope),
  ("repositorySource", Lean.toJson d.repositorySource), ("path", Lean.toJson d.path),
  ("line", Lean.toJson d.line), ("column", Lean.toJson d.column)]

end FindingRetention

def main : IO Unit := do
  let out ← IO.getStdout
  for n in List.range 4 do
    for input in FindingRetention.sequences n do
      let xs := FindingRetention.tokenize input
      for exploratory in [false, true] do
        for workflowOnly in [false, true] do
          for repositoryOnly in [false, true] do
            let scopeFiltered := xs.filter fun d => FindingRetention.inScope d workflowOnly repositoryOnly
            let promoted := FindingRetention.promote scopeFiltered exploratory
            let visible := (promoted.map FindingRetention.fixScope).filter fun d => FindingRetention.inMode d exploratory
            for config in List.range 3 do
              let caps := if config == 0 then [] else if config == 1 then [("rule-a", 1), ("rule-b", 0)] else [("rule-a", 0), ("rule-b", 2)]
              let implied := if config == 2 then ["rule-a"] else []
              let capped := FindingRetention.cap xs caps implied
              out.putStrLn (Lean.Json.mkObj [
                ("findings", .arr ((xs.map FindingRetention.findingJson).toArray)),
                ("exploratory", Lean.toJson exploratory), ("workflowOnly", Lean.toJson workflowOnly),
                ("repositoryOnly", Lean.toJson repositoryOnly), ("caps", Lean.toJson caps),
                ("implied", Lean.toJson implied),
                ("fixedScopes", .arr (((xs.map FindingRetention.fixScope).map fun d => FindingRetention.scopeJson d.scope).toArray)),
                ("selected", Lean.toJson (FindingRetention.tokens (FindingRetention.selected xs exploratory workflowOnly repositoryOnly))),
                ("fixedSelected", Lean.toJson (FindingRetention.tokens (FindingRetention.selected (xs.map FindingRetention.fixScope) exploratory workflowOnly repositoryOnly))),
                ("deduplicated", Lean.toJson (FindingRetention.tokens (FindingRetention.dedup [] xs))),
                ("capped", Lean.toJson (FindingRetention.tokens capped.kept)),
                ("suppressed", Lean.toJson capped.suppressed),
                ("promotedSeverities", Lean.toJson (promoted.map fun d => FindingRetention.severityName d.severity)),
                ("visible", Lean.toJson (FindingRetention.tokens visible))]).compress

#print axioms FindingRetention.selection_exact
#print axioms FindingRetention.scope_fix_idempotent
#print axioms FindingRetention.promotion_preserves_tokens
#print axioms FindingRetention.dedup_no_fabrication
#print axioms FindingRetention.dedup_key_coverage
#print axioms FindingRetention.dedup_keys_unique
#print axioms FindingRetention.implied_head_survives
#print axioms FindingRetention.dedup_mode_counterexample
#print axioms FindingRetention.distinct_rules_same_line_counterexample
#print axioms FindingRetention.scope_fix_order_counterexample
#print axioms FindingRetention.cap_dedup_counterexample
