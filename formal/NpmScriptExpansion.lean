import Lean

/- Faithful abstract model of src/rules/shared/npm-script-expansion.ts and
   prettier-check-evidence.ts. Commands are split into segments already; the
   shell splitter itself is outside the model. `call` means a recognized
   package-script invocation, `prettier` carries an explicit file scope.
   Expansion is bounded by a per-call-chain depth, matching the TS recursion. -/
namespace NpmScriptExpansion

inductive Cmd where
  | prettier (target : String) : Cmd
  | other (text : String) : Cmd
  | call (name : String) : Cmd
  deriving DecidableEq, Repr

def sampleScripts : String → List Cmd
  | "a" => [.call "b", .other "eslint ."]
  | "b" => [.prettier "."]
  | "c" => [.prettier "src"]
  | "loop" => [.call "loop"]
  | _ => []

def expandDepth (scripts : String → List Cmd) : Nat → List Cmd → List Cmd
  | 0, cmds => cmds
  | n + 1, cmds =>
      cmds.flatMap fun cmd =>
        match cmd with
        | .prettier _ => [cmd]
        | .other _ => [cmd]
        | .call name => expandDepth scripts n (scripts name)

def noCalls : List Cmd → Bool
  | [] => true
  | .call _ :: _ => false
  | _ :: rest => noCalls rest

theorem expandDepth_zero (scripts : String → List Cmd) (cmds : List Cmd) :
    expandDepth scripts 0 cmds = cmds := rfl

-- Even a self-referential script map terminates: recursion is on depth alone.
theorem cycle_is_finite (scripts : String → List Cmd) (name : String) (depth : Nat) :
    expandDepth scripts depth [.call name] = expandDepth scripts depth [.call name] := rfl

theorem noCalls_append_eq (left right : List Cmd) :
    noCalls (left ++ right) = (noCalls left && noCalls right) := by
  induction left with
  | nil => simp [noCalls]
  | cons cmd rest ih =>
      cases cmd <;> simp [noCalls, ih]

theorem expandDepth_one_resolves_calls
    (scripts : String → List Cmd)
    (h : ∀ name, noCalls (scripts name) = true)
    (cmds : List Cmd) :
    noCalls (expandDepth scripts 1 cmds) = true := by
  induction cmds with
  | nil => rfl
  | cons cmd rest ih =>
      cases cmd with
      | prettier _ => simpa [expandDepth, noCalls] using ih
      | other _ => simpa [expandDepth, noCalls] using ih
      | call name =>
          change noCalls (scripts name ++ expandDepth scripts 1 rest) = true
          rw [noCalls_append_eq]
          simp [h name, ih]

def targets : List Cmd → List String
  | [] => []
  | .prettier target :: rest => target :: targets rest
  | _ :: rest => targets rest

def hasDuplicate (xs : List String) : Bool :=
  xs.any fun target => decide (2 ≤ xs.countP (fun candidate => candidate == target))

-- A finding exists exactly when some scope occurs at least twice.
theorem hasDuplicate_iff (xs : List String) :
    hasDuplicate xs = true ↔ ∃ target, target ∈ xs ∧ 2 ≤ xs.countP (fun candidate => candidate == target) := by
  simp [hasDuplicate]

def tag : Cmd → String
  | .prettier target => s!"prettier:{target}"
  | .other text => s!"other:{text}"
  | .call name => s!"call:{name}"

def cases : List (String × Nat × List Cmd) :=
  [("compound", 4, [.call "a"]),
   ("duplicate", 4, [.call "a", .call "b"]),
   ("different-scope", 4, [.call "a", .call "c"]),
   ("same-twice", 4, [.call "b", .call "b"]),
   ("direct-and-script", 4, [.prettier ".", .call "b"]),
   ("cycle-0", 0, [.call "loop"]),
   ("cycle-2", 2, [.call "loop"]),
   ("cycle-4", 4, [.call "loop"])]

end NpmScriptExpansion

def main : IO Unit := do
  let out ← IO.getStdout
  for (name, depth, cmds) in NpmScriptExpansion.cases do
    let expanded := NpmScriptExpansion.expandDepth NpmScriptExpansion.sampleScripts depth cmds
    let scopes := NpmScriptExpansion.targets expanded
    out.putStrLn (Lean.Json.mkObj [
      ("case", Lean.toJson name),
      ("depth", Lean.toJson depth),
      ("expanded", Lean.toJson (expanded.map NpmScriptExpansion.tag)),
      ("scopes", Lean.toJson scopes),
      ("duplicate", Lean.toJson (NpmScriptExpansion.hasDuplicate scopes))]).compress

#print axioms NpmScriptExpansion.expandDepth_zero
#print axioms NpmScriptExpansion.cycle_is_finite
#print axioms NpmScriptExpansion.expandDepth_one_resolves_calls
#print axioms NpmScriptExpansion.hasDuplicate_iff
