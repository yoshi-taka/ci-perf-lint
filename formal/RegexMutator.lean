import Init

/- Formal model of the decision rules in `src/mutation/regex-mutator.ts`.

   Scope: Boolean decision rules only. The scanner is not extracted or proved
   equivalent to weapon-regex; parity is bounded differential evidence
   (`docs/internal/mutation-regex-parity-2026-11-17.md`). -/
namespace RegexMutator

inductive Predef where
  | d | D | s | S | w | W
  deriving DecidableEq, Repr

def flipPredef : Predef → Predef
  | .d => .D
  | .D => .d
  | .s => .S
  | .S => .s
  | .w => .W
  | .W => .w

/-- Predefined-class negation is an involution. -/
theorem flipPredef_involutive (p : Predef) : flipPredef (flipPredef p) = p := by
  cases p <;> rfl

/-- Predefined-class negation always changes the class. -/
theorem flipPredef_changes (p : Predef) : flipPredef p ≠ p := by
  cases p <;> decide

def flipUnicode (negative : Bool) : Bool := !negative

theorem flipUnicode_involutive (b : Bool) : flipUnicode (flipUnicode b) = b := by
  cases b <;> rfl

theorem flipUnicode_changes (b : Bool) : flipUnicode b ≠ b := by
  cases b <;> simp [flipUnicode]

/-- BOL/EOL removal length: two when the anchor is the only token of an
    alternative and has an adjacent `|`; otherwise one. -/
def anchorRemovalLength (atAlternativeStart nextPipe prevPipe : Bool) : Nat :=
  if atAlternativeStart && (nextPipe || prevPipe) then 2 else 1

theorem anchorLength_bounds (a n p : Bool) :
    anchorRemovalLength a n p = 1 ∨ anchorRemovalLength a n p = 2 := by
  cases a <;> cases n <;> cases p <;> simp [anchorRemovalLength]

theorem anchorLength_not_zero (a n p : Bool) : 0 < anchorRemovalLength a n p := by
  cases a <;> cases n <;> cases p <;> simp [anchorRemovalLength]

/-- The two-character form is used exactly for a sole anchor with a neighboring
    alternative separator. -/
theorem anchorLength_two_iff (a n p : Bool) :
    anchorRemovalLength a n p = 2 ↔ a = true ∧ (n = true ∨ p = true) := by
  cases a <;> cases n <;> cases p <;> simp [anchorRemovalLength]

/-- Without an alternative-start anchor the removal is always one character. -/
theorem anchorLength_one_when_not_start (n p : Bool) :
    anchorRemovalLength false n p = 1 := by
  simp [anchorRemovalLength]

end RegexMutator
