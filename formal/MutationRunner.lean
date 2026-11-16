import Init

/- Model of the mutation application in `src/mutation/runner.ts`:

     mutated = source.slice(0, start) + replacement + source.slice(end)

   Scope: `List Char` (Unicode code points). The TypeScript implementation
   slices UTF-16 code units, so astral characters are outside this model.
   Mutant generation, parsing, process execution and scheduling are NOT modeled
   here; concrete generated mutants are checked separately by the Z3 bridge. -/
namespace MutationRunner

def splice (src replacement : List Char) (start stop : Nat) : List Char :=
  src.take start ++ replacement ++ src.drop stop

/-- The bytes before the mutation are untouched when `start` is in range. -/
theorem splice_prefix (src replacement : List Char) (start stop : Nat)
    (hstart : start ≤ src.length) :
    (splice src replacement start stop).take start = src.take start := by
  unfold splice
  simp only [List.take_append, List.take_take, List.length_take, Nat.min_eq_left hstart,
    Nat.min_self, Nat.sub_self, List.take_zero, List.length_append]
  rw [Nat.sub_eq_zero_of_le (Nat.le_add_right start replacement.length), List.take_zero]
  simp

/-- The bytes after the replaced range are preserved. -/
theorem splice_suffix (src replacement : List Char) (start stop : Nat)
    (hstart : start ≤ src.length) :
    (splice src replacement start stop).drop (start + replacement.length) =
      src.drop stop := by
  unfold splice
  have hlen : (src.take start).length = start := by
    rw [List.length_take, Nat.min_eq_left hstart]
  rw [List.drop_append, List.length_append, hlen]
  rw [Nat.sub_self]
  rw [List.drop_append, hlen, List.drop_eq_nil_of_le (by omega)]
  rw [Nat.add_sub_cancel_left, List.drop_eq_nil_of_le (by simp)]
  simp

/-- A mutation is a no-op exactly when the replacement equals the replaced slice. -/
theorem splice_eq_self_iff (src replacement : List Char) (start stop : Nat)
    (hstart : start ≤ src.length) (horder : start ≤ stop) :
    splice src replacement start stop = src ↔
      replacement = (src.drop start).take (stop - start) := by
  have hlen : (src.take start).length = start := by
    rw [List.length_take, Nat.min_eq_left hstart]
  have hslice : (src.drop start).take (stop - start) ++ src.drop stop = src.drop start := by
    have h := List.take_append_drop (stop - start) (src.drop start)
    rw [List.drop_drop, Nat.add_sub_cancel' horder] at h
    exact h
  constructor
  · intro h
    have hdrop : replacement ++ src.drop stop = src.drop start := by
      have hh := congrArg (List.drop start) h
      unfold splice at hh
      rw [List.drop_append, List.length_append, hlen] at hh
      rw [Nat.sub_eq_zero_of_le (Nat.le_add_right start replacement.length),
        List.drop_zero] at hh
      rw [List.drop_append, hlen, List.drop_eq_nil_of_le (by omega), Nat.sub_self,
        List.drop_zero, List.nil_append] at hh
      exact hh
    exact List.append_cancel_right (hdrop.trans hslice.symm)
  · intro h
    unfold splice
    rw [h]
    rw [List.append_assoc, hslice]
    exact List.take_append_drop start src

end MutationRunner

/- Temporary-directory and cleanup model.

   The runner creates `tempRoot/tmp/worker-W/INDEX` for each mutant and removes
   it in `finally`. Tests may create arbitrary files under that path; removing
   the root covers all of them. Paths are modeled as segment lists (the
   implementation joins decimal strings; injectivity of the decimal join is
   checked concretely by the Z3 bridge). This model assumes the child process
   honors TMPDIR and that the runner executes its cleanup path (success,
   timeout and caught errors). A SIGKILL of the runner itself is covered only
   by the next run removing the stale root. -/
namespace TempPaths

abbrev Path := List Nat

def under : Path → Path → Bool
  | [], _ => true
  | _ :: _, [] => false
  | a :: as, b :: bs => (a == b) && under as bs

/-- Every suffix of a root is under that root. -/
theorem under_append (root rest : Path) : under root (root ++ rest) = true := by
  induction root with
  | nil => rfl
  | cons _ _ ih => simp [under, ih]

/-- Two different worker sandboxes are disjoint (neither is under the other). -/
theorem worker_disjoint (root : Path) (w1 w2 : Nat) (h : w1 ≠ w2) :
    under (root ++ [w1]) (root ++ [w2, 0]) = false := by
  induction root with
  | nil =>
    simp [under]
    exact h
  | cons a as ih =>
    simp only [List.cons_append] at ih ⊢
    simp [under, ih]

/-- Mutant temp paths are injective in (worker, index). -/
theorem temp_path_injective (root : Path) (w1 i1 w2 i2 : Nat)
    (h : (w1, i1) ≠ (w2, i2)) :
    root ++ [w1, i1] ≠ root ++ [w2, i2] := by
  intro heq
  have hsuffix : [w1, i1] = [w2, i2] := List.append_cancel_left heq
  simp at hsuffix
  exact h (Prod.ext hsuffix.1 hsuffix.2)

/-- A mutant temp dir lives under the worker temp root
    (`root/tmp/worker-W`; `tmp` is encoded as the segment 0). -/
theorem temp_under_worker (root : Path) (w i : Nat) :
    under (root ++ [0, w]) (root ++ [0, w, i]) = true := by
  have := under_append (root ++ [0, w]) [i]
  simpa [List.append_assoc] using this

def cleanup (root : Path) (files : List Path) : List Path :=
  files.filter fun p => !under root p

/-- After cleanup no owned path remains, regardless of how many files a child
    process created under the root. -/
theorem cleanup_removes_owned (root : Path) (files : List Path)
    (h : ∀ p ∈ files, under root p = true) : cleanup root files = [] := by
  unfold cleanup
  rw [List.filter_eq_nil_iff]
  intro p hp
  simp [h p hp]

end TempPaths
