# scheduled-heavy-workflow-without-throttling

Flags heavy scheduled workflows that appear to run more often than every 3 hours.

## Why it matters

Heavy scheduled workflows can consume a lot of runner time without adding proportional value if they run too often. This is especially common for nightly, release, benchmarking, or other expensive recurring workflows.

This rule stays conservative:

- the workflow must be schedule-triggered
- the workflow must look heavy
- the visible cron interval must be under 3 hours

It does not require one fixed policy. It only suggests revisiting very frequent heavy schedules.

## Suggested fix

If the workflow does not need to run this often, either:

- reduce the cron frequency, or
- add a visible no-change skip path

## Measurement hint

Compare scheduled run count, total runner minutes, and useful output before and after reducing frequency or adding a skip path.
