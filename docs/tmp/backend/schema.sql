-- work-sim — initial-prototype schema (SQLite)
--
-- Two tables only: runs and rounds. Append-only in v1 — no UPDATE through the
-- API surface beyond the runner mutating its own runs row. Agents and presets
-- are NOT tables; agent profiles live as snapshots inside runs.config_json.
--
-- See docs/initial-prototype/data-model.md for column-by-column rationale.

PRAGMA journal_mode = WAL;     -- readers don't block during runner writes
PRAGMA foreign_keys = ON;      -- enforce rounds.run_id integrity

-- One row per simulation. Created with status='pending' by POST /runs;
-- transitions to 'running' once the runner picks it up; terminal states are
-- 'completed', 'failed', and (reserved) 'cancelled'.
CREATE TABLE IF NOT EXISTS runs (
    -- UUID generated server-side. PK.
    id                TEXT PRIMARY KEY NOT NULL,

    -- Unix milliseconds; set once on insert. Drives runs-list ordering.
    created_at        INTEGER NOT NULL,

    -- State-machine column: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'.
    -- Indexed because future crash recovery does `WHERE status = 'running'`.
    status            TEXT NOT NULL,

    -- Configured round count (immutable after insert).
    rounds_total      INTEGER NOT NULL,

    -- Updated by the runner inside the per-round transaction.
    rounds_completed  INTEGER NOT NULL DEFAULT 0,

    -- Manager-only goal across the whole run. Used by buildManagerPrompt.
    target_paper      INTEGER NOT NULL,

    -- Running sum of paper_sold across completed rounds.
    paper_total       INTEGER NOT NULL DEFAULT 0,

    -- Nullable for sandbox runs (the v1 default). Reserved for the future
    -- experiments view; will be a hash of replicate-conditions.
    experiment_id     TEXT,

    -- Full immutable snapshot of agent profiles, model params, prompt
    -- template version, situation_tag_seed, sim_engine_version. JSON text.
    -- Editing a preset later cannot contaminate historical runs.
    config_json       TEXT NOT NULL,

    -- Populated only when status='failed'. Human-readable, surfaced to UI.
    error_message     TEXT,

    -- Round index where the run failed (no rounds row was written for it).
    failed_at_round   INTEGER
);

-- Runner crash-recovery query.
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);

-- Future experiments view: GROUP BY experiment_id.
CREATE INDEX IF NOT EXISTS runs_experiment_idx ON runs(experiment_id);

-- Runs-list pagination (newest first).
CREATE INDEX IF NOT EXISTS runs_created_idx ON runs(created_at);

-- One row per *successfully completed* round. Failed rounds produce no row;
-- the run just transitions to 'failed'. Append-only.
CREATE TABLE IF NOT EXISTS rounds (
    id                       TEXT PRIMARY KEY NOT NULL,

    -- FK to the parent run. Cascade is defensive — we don't delete in v1.
    run_id                   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

    -- 1-based; unique per run. Drives transcript ordering.
    round_index              INTEGER NOT NULL,

    -- Deterministically picked from situation_tag_seed + round_index.
    -- E.g. 'routine_check_in', 'missed_target', 'big_client_won'.
    situation_tag            TEXT NOT NULL,

    -- Free-text manager turn (LLMClient.complete).
    manager_message          TEXT NOT NULL,

    -- The 'message' field of the worker's structured response.
    worker_message           TEXT NOT NULL,

    -- The worker's updated_self_perception. Private inner monologue —
    -- next round's worker prompt reads this; manager prompts never see it.
    worker_self_perception   TEXT NOT NULL,

    -- 0–100; validated by Zod after the LLM response is parsed.
    morale                   INTEGER NOT NULL,

    -- round(baseline_output * morale / 50). Computed by the engine.
    paper_sold               INTEGER NOT NULL,

    created_at               INTEGER NOT NULL
);

-- Drives "rounds for this run, in order" reads and prevents double-writes.
CREATE UNIQUE INDEX IF NOT EXISTS rounds_run_round_idx
    ON rounds(run_id, round_index);
