# Async repo methods can't participate in better-sqlite3 transactions

## Status

Open. Working around it by skipping transactions in the runner.

## Symptom

The first end-to-end run failed at the very end with:

```
Transaction function cannot return a promise
```

Round 1 had already been written to disk (the round row existed and `paper_total` had been bumped). The error came from `db.transaction(async tx => ...)` returning a Promise to better-sqlite3, which throws on return.

## Root cause

There is a shape mismatch between two layers:

- **`better-sqlite3`** is fully synchronous. Its `transaction(fn)` API *requires* `fn` to be sync — if `fn` returns a Promise, the driver throws, because it has no way to defer COMMIT until the Promise settles.
- **`RunsRepo` / `RoundsRepo`** in `apps/api/src/db/index.ts` declare every method `async` (return `Promise<T>`). Internally the work is sync (`db.insert(...).run()`), but the type signature forces callers to `await`.

The runner therefore wrote `db.transaction(async tx => { await tx.rounds.insert(...); await tx.runs.bumpProgress(...); })`, which is exactly the shape better-sqlite3 rejects.

## Why the repos were async to begin with

Symmetry with `LLMClient`, which has to be async (network calls). The original scaffold made the DB layer async too so the runner could `await` everything uniformly. That symmetry is what's biting us.

## Current workaround

`apps/api/src/engine/runner.ts` now does the two writes back-to-back **without** wrapping in a transaction:

```ts
await this.db.rounds.insert({ ... });
await this.db.runs.bumpProgress(runId, i, paperSoldThisRound);
```

For a single-process prototype this is fine: better-sqlite3 calls can't interleave with anything, so the only data-loss window is a process kill between the two same-tick sync calls. If that happens, we get a round row whose progress wasn't bumped — easy to reconcile by recomputing `rounds_completed = max(round_index)` and `paper_total = sum(paper_sold)` on boot.

`AppDb.transaction` is still defined on the interface but is unused. Calling it with an async callback will throw the same error.

## Fix options when we care

1. **Make the repos sync.** Drop `async` / `Promise<T>` from the four repo methods and from `AppDb.transaction`. The runner's outer `run()` stays async because of the LLM calls; only the DB layer goes sync. Then `db.transaction(tx => { tx.rounds.insert(...); tx.runs.bumpProgress(...); })` is a normal sync callback, atomic, no fighting the driver. **Recommended** — small refactor, cleanest result, idiomatic for better-sqlite3.

2. **Keep async repos, skip transactions.** What we're doing. Acceptable for the prototype.

3. **Switch to an async SQLite driver** (e.g. `node:sqlite`, `libsql`). Async transactions work naturally. Larger change; only worth it if we need other async-driver features.

## When to revisit

When either is true:

- We start running long experiments and care about partial-write recovery.
- We add a second writer to any table (e.g. event injection, mid-run cancel writes) — at that point true atomicity becomes load-bearing rather than nice-to-have.

## Affected files

- `apps/api/src/db/index.ts` — `RunsRepo`, `RoundsRepo`, `AppDb.transaction`
- `apps/api/src/engine/runner.ts:100` — current workaround
