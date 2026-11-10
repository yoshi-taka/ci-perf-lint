import Lean

/- Faithful model of src/rules/shared/evidence.ts at
   6d16a3ef435fd6b9c69682b8e88e63a3d2903b33, lines 36–69.
   Domain: well-typed EvidenceStrength values and finite, immutable arrays.
   JS getters/proxies, invalid runtime inputs and resource exhaustion are excluded. -/
namespace Evidence

inductive Strength where
  | strong | medium | weak
  deriving DecidableEq, Repr

def priority : Strength → Nat
  | .strong => 3
  | .medium => 2
  | .weak => 1

structure Graded where
  value : Bool
  strength : Strength
  signals : List String
  deriving DecidableEq, Repr

def meetsMinimum (evidence : Graded) (minimum : Strength) : Graded :=
  let passes := evidence.value && decide (priority evidence.strength ≥ priority minimum)
  { value := passes, strength := evidence.strength, signals := evidence.signals }

def updateBest (best s : Strength) : Strength :=
  if priority s > priority best then s else best

def combineStrength (strengths : List Strength) : Strength :=
  strengths.foldl updateBest .weak

-- Independent specification: threshold acceptance by explicit cases, not ranks.
def allowed : Strength → Strength → Bool
  | .strong, _ => true
  | .medium, .strong => false
  | .medium, _ => true
  | .weak, .weak => true
  | .weak, _ => false

theorem minimum_exact (e : Graded) (m : Strength) :
    (meetsMinimum e m).value = (e.value && allowed e.strength m) := by
  cases e with | mk v s signals =>
    cases v <;> cases s <;> cases m <;> rfl

theorem minimum_preserves_metadata (e : Graded) (m : Strength) :
    (meetsMinimum e m).strength = e.strength ∧
    (meetsMinimum e m).signals = e.signals := by
  exact ⟨rfl, rfl⟩

-- Raising the threshold cannot turn rejection into acceptance.
theorem minimum_monotone (e : Graded) (lo hi : Strength)
    (h : priority lo ≤ priority hi)
    (accepted : (meetsMinimum e hi).value = true) :
    (meetsMinimum e lo).value = true := by
  cases e with | mk v s signals =>
    cases v <;> cases s <;> cases lo <;> cases hi <;>
      simp_all [meetsMinimum, priority]

-- All finite lists, not just the enumerated differential test cases.
theorem fold_priority (xs : List Strength) (best : Strength) :
    priority (xs.foldl updateBest best) =
      xs.foldl (fun n s => max n (priority s)) (priority best) := by
  induction xs generalizing best with
  | nil => rfl
  | cons s xs ih =>
    simp only [List.foldl_cons]
    rw [ih]
    have step : priority (updateBest best s) = max (priority best) (priority s) := by
      cases best <;> cases s <;> decide
    rw [step]

-- Independent specification: strongest present value, with weak for empty input.
def strongestPresent (xs : List Strength) : Strength :=
  if .strong ∈ xs then .strong else if .medium ∈ xs then .medium else .weak

theorem fold_present (xs : List Strength) (best : Strength) :
    xs.foldl updateBest best = strongestPresent (best :: xs) := by
  induction xs generalizing best with
  | nil => cases best <;> simp [strongestPresent]
  | cons s xs ih =>
    simp only [List.foldl_cons]
    rw [ih]
    cases best <;> cases s <;>
      simp [updateBest, priority, strongestPresent, List.mem_cons]

theorem combine_exact (xs : List Strength) :
    combineStrength xs = strongestPresent xs := by
  rw [combineStrength, fold_present]
  simp [strongestPresent]

-- Concrete counterexample to a common mutation: changing >= to >.
theorem equal_threshold_accepted :
    (meetsMinimum ⟨true, .medium, []⟩ .medium).value = true := by rfl

def name : Strength → String
  | .strong => "strong"
  | .medium => "medium"
  | .weak => "weak"

def strengths : List Strength := [.weak, .medium, .strong]

def listsOfLength : Nat → List (List Strength)
  | 0 => [[]]
  | n + 1 => (listsOfLength n).flatMap fun xs => strengths.map fun s => s :: xs

def gradedJson (e : Graded) : Lean.Json := Lean.Json.mkObj [
  ("value", Lean.toJson e.value),
  ("strength", Lean.toJson (name e.strength)),
  ("signals", Lean.toJson e.signals)]

end Evidence

-- JSONL bridge. The verifier compares these actual Lean executions with TS.
def main : IO Unit := do
  let out ← IO.getStdout
  for value in [false, true] do
    for strength in Evidence.strengths do
      for minimum in Evidence.strengths do
        for signals in [[], ["cache"], ["", "日本語", "cache", "cache"]] do
          let e : Evidence.Graded := ⟨value, strength, signals⟩
          out.putStrLn (Lean.Json.mkObj [
            ("kind", Lean.toJson "minimum"),
            ("evidence", Evidence.gradedJson e),
            ("minimum", Lean.toJson (Evidence.name minimum)),
            ("result", Evidence.gradedJson (Evidence.meetsMinimum e minimum))]).compress
  for n in List.range 9 do
    for xs in Evidence.listsOfLength n do
      out.putStrLn (Lean.Json.mkObj [
        ("kind", Lean.toJson "combine"),
        ("strengths", Lean.toJson (xs.map Evidence.name)),
        ("result", Lean.toJson (Evidence.name (Evidence.combineStrength xs)))]).compress

#print axioms Evidence.minimum_exact
#print axioms Evidence.minimum_preserves_metadata
#print axioms Evidence.minimum_monotone
#print axioms Evidence.fold_priority
#print axioms Evidence.combine_exact
#print axioms Evidence.equal_threshold_accepted
