-- Canonical SQL DDL for the many-workers iteration. The Drizzle schema in
-- apps/api/src/db/schema.ts mirrors this 1:1; the Drizzle file is what the
-- application talks to, this file is the migration artifact.
--
-- Greenfield: drops and recreates. Prototype tables (`runs`, `rounds`) are
-- gone — singular table names everywhere now.
--
-- See docs/many-workers/data-model.md for full rationale.

-- ---------------------------------------------------------------------------
-- run
-- One row per simulation. Status state machine enforced in the runner, not
-- by triggers. Legal transitions: pending → running → (completed | failed | cancelled).
-- ---------------------------------------------------------------------------
CREATE TABLE run (
    -- Server-generated uuid.
    id                TEXT PRIMARY KEY,

    -- Unix milliseconds. Set once on insert.
    created_at        INTEGER NOT NULL,

    -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'.
    -- Indexed for the future "pick up running rows on boot" query.
    status            TEXT    NOT NULL,

    -- Configured round count; immutable.
    rounds_total      INTEGER NOT NULL,

    -- Bumped by runner during settle.
    rounds_completed  INTEGER NOT NULL DEFAULT 0,

    -- Team-level goal across the run.
    target_paper      INTEGER NOT NULL,

    -- Sum of round_avatar.paper_sold across workers across all completed rounds.
    paper_total       INTEGER NOT NULL DEFAULT 0,

    -- Reserved for future experiments view.
    experiment_id     TEXT,

    -- Full input snapshot — JSON-stringified RunConfig (incl. avatars w/ uuids).
    -- Immutable post-insert; used for reproducibility even if avatar rows are
    -- mutated/inspected later.
    config_json       TEXT    NOT NULL,

    -- Populated only when status='failed'.
    error_message     TEXT,

    -- Round index where the run failed (no round row written for it).
    failed_at_round   INTEGER
);

CREATE INDEX run_status_idx     ON run(status);
CREATE INDEX run_experiment_idx ON run(experiment_id);
CREATE INDEX run_created_idx    ON run(created_at);

-- ---------------------------------------------------------------------------
-- avatar
-- One row per persona per run. Materialized so foreign keys from interaction
-- and round_avatar are stable strings rather than JSON paths. Profile is
-- ALSO snapshotted in run.config_json — that snapshot is immutable; this
-- table is the queryable canonical for FKs.
-- ---------------------------------------------------------------------------
CREATE TABLE avatar (
    -- uuid; same id stored in config_json.avatars[].id.
    id              TEXT PRIMARY KEY,

    run_id          TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,

    -- 'manager' | 'worker'.
    role_in_sim     TEXT NOT NULL,

    name            TEXT NOT NULL,
    role_label      TEXT NOT NULL,
    personality     TEXT NOT NULL,
    "values"        TEXT NOT NULL,           -- quoted: SQL reserved word.

    -- Used in paper-sold formula for workers; ignored for managers in v1.
    baseline_output INTEGER NOT NULL
);

CREATE INDEX avatar_run_idx      ON avatar(run_id);
CREATE INDEX avatar_run_role_idx ON avatar(run_id, role_in_sim);

-- ---------------------------------------------------------------------------
-- round
-- One row per "day." Slim — per-worker fields moved to round_avatar. The
-- runner inserts one row at the start of each round; subsequent interactions
-- and round_avatar rows reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE round (
    id              TEXT PRIMARY KEY,
    run_id          TEXT    NOT NULL REFERENCES run(id) ON DELETE CASCADE,

    -- 1-based; UNIQUE per run. Drives ordering.
    round_index     INTEGER NOT NULL,

    -- Deterministic from (situation_tag_seed, round_index). Shared by all
    -- interactions in this round; denormalized onto interaction rows for
    -- filter convenience.
    situation_tag   TEXT    NOT NULL,

    created_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX round_run_round_idx ON round(run_id, round_index);

-- ---------------------------------------------------------------------------
-- round_avatar
-- One row per (round, avatar). Captures end-of-round running state. Written
-- during settle. Manager rows have NULL morale and paper_sold in v1; schema
-- is symmetric for the future bidirectional case.
-- ---------------------------------------------------------------------------
CREATE TABLE round_avatar (
    id                TEXT PRIMARY KEY,

    run_id            TEXT    NOT NULL REFERENCES run(id) ON DELETE CASCADE,
    round_id          TEXT    NOT NULL REFERENCES round(id) ON DELETE CASCADE,

    -- Denormalized to avoid a join when querying an avatar's curve.
    round_index       INTEGER NOT NULL,

    avatar_id         TEXT    NOT NULL REFERENCES avatar(id) ON DELETE CASCADE,

    -- 0–100 for workers; NULL for manager in v1.
    morale            INTEGER,
    morale_rationale  TEXT,

    -- Avatar's last-emitted self_perception this round; NULL for manager.
    self_perception   TEXT,

    -- round(baseline_output * morale / 50) for workers; NULL for manager.
    paper_sold        INTEGER,

    created_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX round_avatar_unique_idx ON round_avatar(run_id, round_id, avatar_id);
-- Drives "avatar's morale-over-rounds" query for the dashboard sparkline and
-- the drilldown morale chart.
CREATE INDEX        round_avatar_feed_idx   ON round_avatar(run_id, avatar_id, round_index);

-- ---------------------------------------------------------------------------
-- interaction
-- One row per LLM exchange. Append-only audit trail powering the avatar feed
-- and pair filter. Manager-vs-peer is DERIVED from participants' role_in_sim;
-- there is no `phase` column. The engine assigns 0-based order_in_round so
-- 1:1s are 0..N-1 and peer convos N..2N-1 within a round.
-- ---------------------------------------------------------------------------
CREATE TABLE interaction (
    id                            TEXT    PRIMARY KEY,

    run_id                        TEXT    NOT NULL REFERENCES run(id) ON DELETE CASCADE,
    round_id                      TEXT    NOT NULL REFERENCES round(id) ON DELETE CASCADE,

    -- Denormalized for sort.
    round_index                   INTEGER NOT NULL,

    -- 0-based position within the round. UNIQUE with round_id.
    order_in_round                INTEGER NOT NULL,

    -- Denormalized for filter convenience (no round join required).
    situation_tag                 TEXT    NOT NULL,

    initiator_avatar_id           TEXT    NOT NULL REFERENCES avatar(id),
    responder_avatar_id           TEXT    NOT NULL REFERENCES avatar(id),

    initiator_message             TEXT    NOT NULL,
    responder_message             TEXT    NOT NULL,

    -- Initiator-side morale/rationale/self_perception is NULL when the
    -- initiator is the manager (v1: managers don't emit morale state).
    initiator_morale              INTEGER,
    initiator_morale_rationale    TEXT,
    initiator_self_perception     TEXT,

    -- Responder is always a worker in v1 (manager → worker 1:1, or peer).
    -- These are NOT NULL.
    responder_morale              INTEGER NOT NULL,
    responder_morale_rationale    TEXT    NOT NULL,
    responder_self_perception     TEXT    NOT NULL,

    created_at                    INTEGER NOT NULL
);

-- Render-in-order across a run.
CREATE UNIQUE INDEX interaction_order_idx     ON interaction(run_id, round_index, order_in_round);
-- Per-avatar feeds.
CREATE INDEX        interaction_initiator_idx ON interaction(run_id, initiator_avatar_id);
CREATE INDEX        interaction_responder_idx ON interaction(run_id, responder_avatar_id);
-- Pair filter (combined with reverse-direction query).
CREATE INDEX        interaction_pair_idx      ON interaction(run_id, initiator_avatar_id, responder_avatar_id);
