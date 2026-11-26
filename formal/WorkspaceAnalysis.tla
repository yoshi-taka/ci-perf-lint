---- MODULE WorkspaceAnalysis ----
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Repos, Chunk

ASSUME Chunk \in Nat /\ Chunk > 0
ASSUME IsFiniteSet(Repos)

VARIABLES pending, running, succeeded, failed, merged

vars == <<pending, running, succeeded, failed, merged>>

Init ==
  /\ pending = Repos
  /\ running = {}
  /\ succeeded = {}
  /\ failed = {}
  /\ merged = {}

StartChunk ==
  /\ pending /= {}
  /\ Cardinality(running) < Chunk
  /\ \E chunk \in SUBSET pending :
       /\ chunk /= {}
       /\ Cardinality(chunk) <= Chunk - Cardinality(running)
       /\ running' = running \cup chunk
       /\ pending' = pending \ chunk
       /\ UNCHANGED <<succeeded, failed, merged>>

Complete(r) ==
  /\ r \in running
  /\ \/ /\ succeeded' = succeeded \cup {r}
        /\ failed' = failed
     \/ /\ failed' = failed \cup {r}
        /\ succeeded' = succeeded
  /\ running' = running \ {r}
  /\ UNCHANGED <<pending, merged>>

Merge ==
  /\ \E r \in succeeded \ merged :
       /\ merged' = merged \cup {r}
       /\ UNCHANGED <<pending, running, succeeded, failed>>

MergeMutant ==
  /\ \E r \in failed \ merged :
       /\ merged' = merged \cup {r}
       /\ UNCHANGED <<pending, running, succeeded, failed>>

Finish ==
  /\ pending = {}
  /\ running = {}
  /\ UNCHANGED vars

Next ==
  \/ StartChunk
  \/ \E r \in running : Complete(r)
  \/ Merge
  \/ Finish

NextMutant ==
  \/ StartChunk
  \/ \E r \in running : Complete(r)
  \/ MergeMutant
  \/ Finish

Fairness ==
  /\ WF_vars(StartChunk)
  /\ WF_vars(Merge)
  /\ \A r \in Repos : WF_vars(Complete(r))

FairnessMutant ==
  /\ WF_vars(StartChunk)
  /\ WF_vars(MergeMutant)
  /\ \A r \in Repos : WF_vars(Complete(r))

Spec == Init /\ [][Next]_vars /\ Fairness
SpecMutant == Init /\ [][NextMutant]_vars /\ FairnessMutant

TypeOK ==
  /\ pending \subseteq Repos
  /\ running \subseteq Repos
  /\ succeeded \subseteq Repos
  /\ failed \subseteq Repos
  /\ merged \subseteq Repos

NoOverlap == succeeded \cap failed = {}
NoLost == pending \cup running \cup succeeded \cup failed = Repos
MergedSound == merged \subseteq succeeded
Done == pending = {} /\ running = {}
EventuallyMerged == <>(Done /\ merged = succeeded)

====
