import Lean

/- Abstract model of src/circleci-workflow-graph.ts trigger comparison.
   Regexes are represented by the finite set of representative branch/tag names
   they match; the TypeScript bridge uses the same universe. No full regex
   parsing, CircleCI API, or workflow execution is modeled. -/
namespace CircleCiFilters

inductive Pattern where
  | lit (value : String) : Pattern
  | regex (matching : List String) : Pattern
  deriving DecidableEq, Repr

structure FilterSet where
  only : List Pattern := []
  ignore : List Pattern := []
  deriving DecidableEq, Repr

structure Filters where
  branches : FilterSet := {}
  tags : FilterSet := {}
  deriving DecidableEq, Repr

def matchesPattern : Pattern → String → Bool
  | .lit value, candidate => value == candidate
  | .regex matching, candidate => matching.contains candidate

def allows (set : FilterSet) (candidate : String) : Bool :=
  !set.ignore.any (fun pattern => matchesPattern pattern candidate) &&
  (set.only.isEmpty || set.only.any (fun pattern => matchesPattern pattern candidate))

def literals : List Pattern → List String
  | [] => []
  | .lit value :: rest => value :: literals rest
  | .regex _ :: rest => literals rest

def candidateUniverse : List String :=
  ["main", "develop", "feature-1", "v1", "v1.0", "v11", "v2.0", "release-1", "feature-foo"]

def candidates (a b : FilterSet) : List String :=
  candidateUniverse ++ literals a.only ++ literals b.only

def overlap (a b : FilterSet) : Bool :=
  (candidates a b).any (fun candidate => allows a candidate && allows b candidate)

def enabled (set : FilterSet) : Bool :=
  !set.only.isEmpty || !set.ignore.isEmpty

def triggerOverlap (a b : FilterSet) (enabledByDefault : Bool) : Bool :=
  if !enabledByDefault && (!enabled a || !enabled b) then
    false
  else
    overlap a b

def coRun (a b : Filters) : Bool :=
  triggerOverlap a.branches b.branches true || triggerOverlap a.tags b.tags false

theorem allows_ignore_wins (set : FilterSet) (value : String)
    (h : (.lit value) ∈ set.ignore) : allows set value = false := by
  have hit : set.ignore.any (fun pattern => matchesPattern pattern value) = true := by
    exact List.any_eq_true.mpr ⟨.lit value, h, by simp [matchesPattern]⟩
  simp [allows, hit]

theorem allows_only_restricts (set : FilterSet) (value : String)
    (hOnly : (!set.only.isEmpty) = true)
    (hMiss : (!set.only.any (fun pattern => matchesPattern pattern value)) = true) :
    allows set value = false := by
  have hit : set.only.any (fun pattern => matchesPattern pattern value) = false := by
    simpa using hMiss
  have nonempty : set.only.isEmpty = false := by
    simpa using hOnly
  simp [allows, hit, nonempty]

theorem candidate_mem_comm (a b : FilterSet) (value : String) :
    value ∈ candidates a b ↔ value ∈ candidates b a := by
  simp [candidates, List.mem_append, or_comm]

theorem overlap_symmetric (a b : FilterSet) : overlap a b = overlap b a := by
  apply Bool.eq_iff_iff.mpr
  rw [overlap, overlap, List.any_eq_true, List.any_eq_true]
  constructor
  · rintro ⟨value, hmem, hallows⟩
    exact ⟨value, (candidate_mem_comm a b value).mp hmem, by simpa [Bool.and_comm] using hallows⟩
  · rintro ⟨value, hmem, hallows⟩
    exact ⟨value, (candidate_mem_comm b a value).mp hmem, by simpa [Bool.and_comm] using hallows⟩

theorem triggerOverlap_symmetric (a b : FilterSet) (enabledByDefault : Bool) :
    triggerOverlap a b enabledByDefault = triggerOverlap b a enabledByDefault := by
  unfold triggerOverlap
  by_cases h : !enabledByDefault && (!enabled a || !enabled b)
  · have h' : !enabledByDefault && (!enabled b || !enabled a) := by simpa [or_comm] using h
    simp [h, h']
  · have h' : ¬(!enabledByDefault && (!enabled b || !enabled a)) := by
      simpa [or_comm] using h
    simp [h, h', overlap_symmetric]

theorem coRun_symmetric (a b : Filters) : coRun a b = coRun b a := by
  simp [coRun, triggerOverlap_symmetric]

theorem tag_filter_required (a b : Filters)
    (hA : (!enabled a.tags) = true) : coRun a b = overlap a.branches b.branches := by
  simp [coRun, triggerOverlap, hA]

theorem all_branch_ignore_does_not_block_tags (a b : Filters)
    (hBranch : overlap a.branches b.branches = false)
    (hTag : overlap a.tags b.tags = true)
    (hA : enabled a.tags = true) (hB : enabled b.tags = true) : coRun a b = true := by
  unfold coRun triggerOverlap
  simp [hBranch, hTag, hA, hB]

-- Deliberately wrong rule: intersect `only` sets and ignore `ignore` entirely.
def naiveOverlap (a b : FilterSet) : Bool :=
  !a.only.isEmpty && !b.only.isEmpty &&
  a.only.any (fun p => b.only.any (fun q => p == q))

theorem naive_missed_ignore :
    naiveOverlap
      { only := [.lit "main"], ignore := [.lit "main"] }
      { only := [.lit "main"], ignore := [] } = true ∧
    overlap
      { only := [.lit "main"], ignore := [.lit "main"] }
      { only := [.lit "main"], ignore := [] } = false := by
  decide

def allRegex : Pattern := .regex candidateUniverse
def vRegex : Pattern := .regex ["v1", "v1.0", "v11", "v2.0"]
def v1Regex : Pattern := .regex ["v1", "v1.0", "v11"]
def v2Regex : Pattern := .regex ["v2.0"]
def featureRegex : Pattern := .regex ["feature-1", "feature-foo"]

structure Case where
  id : String
  a : Filters
  b : Filters
  expected : Bool

def cases : List Case :=
  [ { id := "ignore-main-only-main",
      a := { branches := { ignore := [.lit "main"] } },
      b := { branches := { only := [.lit "main"] } }, expected := false },
    { id := "ignore-main-array-only-main-array",
      a := { branches := { ignore := [.lit "main"] } },
      b := { branches := { only := [.lit "main"] } }, expected := false },
    { id := "only-develop-ignore-develop",
      a := { branches := { only := [.lit "develop"] } },
      b := { branches := { ignore := [.lit "develop"] } }, expected := false },
    { id := "ignore-all-ignore-all",
      a := { branches := { ignore := [allRegex] } },
      b := { branches := { ignore := [allRegex] } }, expected := false },
    { id := "tag-regex-both",
      a := { branches := { ignore := [allRegex] }, tags := { only := [vRegex] } },
      b := { branches := { ignore := [allRegex] }, tags := { only := [vRegex] } }, expected := true },
    { id := "all-branches-tag-vs-tag-only",
      a := { tags := { only := [vRegex] } },
      b := { branches := { ignore := [allRegex] }, tags := { only := [v1Regex] } }, expected := true },
    { id := "tag-only-vs-no-tag",
      a := { branches := { ignore := [allRegex] }, tags := { only := [vRegex] } },
      b := { branches := { ignore := [allRegex] } }, expected := false },
    { id := "feature-regex-vs-main",
      a := { branches := { only := [featureRegex] } },
      b := { branches := { only := [.lit "main"] } }, expected := false },
    { id := "feature-regex-vs-feature-foo",
      a := { branches := { only := [featureRegex] } },
      b := { branches := { only := [.lit "feature-foo"] } }, expected := true },
    { id := "main-vs-main",
      a := { branches := { only := [.lit "main"] } },
      b := { branches := { only := [.lit "main"] } }, expected := true },
    { id := "main-vs-develop",
      a := { branches := { only := [.lit "main"] } },
      b := { branches := { only := [.lit "develop"] } }, expected := false },
    { id := "ignore-main-only-develop",
      a := { branches := { ignore := [.lit "main"] } },
      b := { branches := { only := [.lit "develop"] } }, expected := true },
    { id := "ignore-all-only-main",
      a := { branches := { ignore := [allRegex] } },
      b := { branches := { only := [.lit "main"] } }, expected := false },
    { id := "main-and-tag-overlap",
      a := { branches := { only := [.lit "main"] }, tags := { only := [v1Regex] } },
      b := { branches := { only := [.lit "main"] }, tags := { only := [v1Regex] } }, expected := true },
    { id := "disjoint-tags",
      a := { branches := { ignore := [allRegex] }, tags := { only := [v1Regex] } },
      b := { branches := { ignore := [allRegex] }, tags := { only := [v2Regex] } }, expected := false },
    { id := "ignore-array-only-array",
      a := { branches := { ignore := [.lit "main"] } },
      b := { branches := { only := [.lit "main"] } }, expected := false },
    { id := "no-filters",
      a := {}, b := {}, expected := true } ]

end CircleCiFilters

def main : IO Unit := do
  let out ← IO.getStdout
  for item in CircleCiFilters.cases do
    out.putStrLn (Lean.Json.mkObj [
      ("id", Lean.toJson item.id),
      ("expected", Lean.toJson item.expected),
      ("actual", Lean.toJson (CircleCiFilters.coRun item.a item.b))]).compress

#print axioms CircleCiFilters.allows_ignore_wins
#print axioms CircleCiFilters.allows_only_restricts
#print axioms CircleCiFilters.overlap_symmetric
#print axioms CircleCiFilters.coRun_symmetric
#print axioms CircleCiFilters.tag_filter_required
#print axioms CircleCiFilters.all_branch_ignore_does_not_block_tags
#print axioms CircleCiFilters.naive_missed_ignore
