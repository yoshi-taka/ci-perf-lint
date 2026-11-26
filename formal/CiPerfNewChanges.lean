import Init

/-!
Models for the repository/workspace, Gradle module-count, JavaScript gate,
and Docker stage-reachability changes. These are specifications, not a proof
that the TypeScript implementation is equivalent.
-/

namespace CiPerfNewChanges

/- Workspace merging: each repository contributes one path segment. -/
def prefixed (repo : String) (path : List String) : List String := repo :: path

theorem prefixed_injective {r1 r2 : String} {p1 p2 : List String} (h : r1 ≠ r2) :
    prefixed r1 p1 ≠ prefixed r2 p2 := by
  intro heq
  injection heq with hhead _
  exact h hhead

/- Gradle modules: root project plus unique included projects that are not
build-logic containers. -/
def isBuildScriptModule (m : String) : Bool :=
  m == "buildSrc" || m == "build-logic"

def validModules (includes : List String) : List String :=
  (includes.filter (fun m => !isBuildScriptModule m)).eraseDups

def countModules (includes : List String) : Nat :=
  (validModules includes).length + 1

theorem multiModule_iff (includes : List String) :
    2 ≤ countModules includes ↔ validModules includes ≠ [] := by
  unfold countModules
  constructor
  · intro h hnil
    have hlen : (validModules includes).length = 0 := List.length_eq_zero_iff.mpr hnil
    omega
  · intro h
    have hpos : 0 < (validModules includes).length := by
      cases hmod : validModules includes with
      | nil => exact False.elim (h hmod)
      | cons x xs => simp
    omega

theorem buildSrc_not_counted (includes : List String) :
    "buildSrc" ∉ validModules includes := by
  simp [validModules, isBuildScriptModule]

theorem buildLogic_not_counted (includes : List String) :
    "build-logic" ∉ validModules includes := by
  simp [validModules, isBuildScriptModule]

/- The JavaScript framework gate does not read the Gradle signal. -/
structure JsSignals where
  next : Bool := false
  storybook : Bool := false
  turbo : Bool := false
  nx : Bool := false
  lerna : Bool := false
  angular : Bool := false
  babel : Bool := false
  typescript : Bool := false
  jest : Bool := false
  webpack : Bool := false
  gradle : Bool := false

def jsFrameworkGate (s : JsSignals) : Bool :=
  s.next || s.storybook || s.turbo || s.nx || s.lerna || s.angular || s.babel ||
    s.typescript || s.jest || s.webpack

theorem gradle_signal_irrelevant (s : JsSignals) (g : Bool) :
    jsFrameworkGate { s with gradle := g } = jsFrameworkGate s := rfl

theorem gradle_only_not_js_framework :
    jsFrameworkGate
        { next := false, storybook := false, turbo := false, nx := false, lerna := false,
          angular := false, babel := false, typescript := false, jest := false,
          webpack := false, gradle := true } = false := rfl

/- Docker stage reachability is the reflexive-transitive closure of stage
references from the requested output stage. -/
def StageEdge (edges : List (Nat × Nat)) (a b : Nat) : Prop :=
  (a, b) ∈ edges

inductive Reachable (edges : List (Nat × Nat)) (start : Nat) : Nat → Prop
  | refl : Reachable edges start start
  | step {a b : Nat} : Reachable edges start a → StageEdge edges a b → Reachable edges start b

theorem reachable_refl (edges : List (Nat × Nat)) (start : Nat) :
    Reachable edges start start :=
  Reachable.refl

theorem reachable_step {edges : List (Nat × Nat)} {start a b : Nat}
    (hReach : Reachable edges start a) (hEdge : StageEdge edges a b) :
    Reachable edges start b :=
  Reachable.step hReach hEdge

theorem reachable_trans {edges : List (Nat × Nat)} {start a b : Nat}
    (h1 : Reachable edges start a) (h2 : Reachable edges a b) :
    Reachable edges start b := by
  induction h2 with
  | refl => exact h1
  | step hPrev hEdge ih => exact Reachable.step ih hEdge

#print axioms prefixed_injective
#print axioms multiModule_iff
#print axioms buildSrc_not_counted
#print axioms buildLogic_not_counted
#print axioms gradle_signal_irrelevant
#print axioms gradle_only_not_js_framework
#print axioms reachable_refl
#print axioms reachable_step
#print axioms reachable_trans

end CiPerfNewChanges
