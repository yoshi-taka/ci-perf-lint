----------------------------- MODULE SourceCache -----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Clients, Broken
VARIABLES cache, calls, starts
vars == <<cache, calls, starts>>

\* Each client calls once. Publication of the pending promise is atomic in JS.
\* Completion is assumed enabled eventually (no hanging filesystem/parser call).
Init == /\ cache = "absent"
        /\ calls = [c \in Clients |-> "idle"]
        /\ starts = 0

Call(c) == /\ calls[c] = "idle"
           /\ calls' = [calls EXCEPT ![c] = IF cache = "done" THEN "done" ELSE "waiting"]
           /\ starts' = IF cache = "absent" THEN starts + 1 ELSE starts
           /\ cache' = IF cache = "absent" THEN
                          (IF Broken THEN "absent" ELSE "pending") ELSE cache

Finish == /\ starts > 0
          /\ cache # "done"
          /\ cache' = "done"
          /\ calls' = [c \in Clients |-> IF calls[c] = "waiting" THEN "done" ELSE calls[c]]
          /\ UNCHANGED starts

Next == (\E c \in Clients : Call(c)) \/ Finish
Spec == Init /\ [][Next]_vars /\ WF_vars(Finish)
AtMostOnce == starts <= 1
NoPrematureResult == \A c \in Clients : calls[c] = "done" => cache = "done"
Progress == (\E c \in Clients : calls[c] = "waiting") ~> (cache = "done")
=============================================================================
