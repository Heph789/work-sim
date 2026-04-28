# Locked Decisions — Initial Prototype

This is the decision log from the architecture grilling that preceded any code.
Each entry records *what* was chosen and *why*, so future-us can tell which
decisions are load-bearing and which were prototype-expedient.

For higher-level system structure, see `high-level-arch.md`. For per-component
detail, see the other files in this directory.

---

## 1. Round shape: single 1:1 manager→worker exchange

A "round" is one manager message → one worker response. Two LLM calls per
round per agent pair.

**Why:** The prototype's scope is two agents over tens of rounds. The interesting
question is *does manager style × worker values change the output number?*, which
can be demonstrated with one exchange per round. Multi-turn rounds and "work day"
schedulers (à la generative_agents) only start paying off at 4+ agents where
emergent dynamics matter.

**Forward path:** Richer round structures (multi-turn within round, parallel peer
interactions, scheduled work blocks) are additive — they don't invalidate this
shape.

---

## 2. Agent state: stateless profile + full history + mutable self-perception

An agent is a row of static profile fields plus a mutable `self_perception`
string. Each round's prompt is built from `profile + entire prior transcript +
self_perception + this round's inputs`. No vector store, no retrieval, no
reflection cycles.

**Why:** With 2 agents over tens of rounds, the entire history fits in a single
prompt comfortably. Building memory primitives (embeddings, importance scoring,
reflection) before validating that the core loop is interesting is the classic
"designing for hypothetical future requirements" trap. The mutable
self-perception string buys most of the *feel* of memory at one extra LLM call
per agent per round, with zero infrastructure.

**Forward path:** When team size or round count grows enough that history bloats
prompts, swap full-transcript inclusion for summarization or vector-retrieval —
the agent shape (`{ profile, history, self_perception }`) stays the same; only
the prompt builder changes.

---

## 3. Personality & values: free-form strings

Personality and values are unstructured text fields, not a fixed taxonomy.

**Why:** A taxonomy (and especially a hand-authored compatibility matrix) forces
us to commit to a worldview about what makes work good *before* we've seen what
the LLM actually does with these inputs. Free-form first lets us observe what
emerges; we can extract a taxonomy later if patterns are worth crystallizing.
There may also be established psychology research worth adopting — easier to
pick the right framework after seeing what's missing.

**Forward path:** Add a structured `traits[]` and `values[]` field alongside
the free-form ones once a taxonomy is chosen. The free-form text can become the
"flavor" field on top of structured tags.

---

## 4. Productivity: worker emits morale; deterministic formula → paper sold

Each round, the worker emits a `morale` integer (0–100) as part of their
structured response. The simulation engine then computes
`paper_sold = round(baseline * morale / 50)` deterministically. The LLM never
emits a paper-sold number directly.

**Why:** Three reasons. (1) The LLM has no idea what realistic paper-sales
numbers look like, so asking it to emit them couples narrative quality to game
balance. With a formula, tuning is a code change in one place. (2) Morale is
inspectable — the UI can plot it round-over-round and the user can *see*
personality dynamics expressed as a curve. (3) This pattern (LLM emits
subjective signal → deterministic engine consumes it) matches the only place
generative_agents has the LLM emit numbers: the poignancy/importance score on
memories, used by deterministic retrieval logic — never as a final output.

**Forward path:** The formula can grow more interesting (peer-interaction
modifiers, fatigue, learning curves) without changing the basic shape.

---

## 5. Frontend interaction: configure-and-batch + polling; rounds persisted as they complete

User configures agents, hits Run, and the frontend polls `/runs/:id` every ~2s
to render rounds as they appear. **The runner persists each round to the DB the
moment it completes.**

**Why:** A 10-round 2-agent run is ~30 LLM calls / ~30–60s wall time —
poll-based is enough to feel live without SSE/websocket complexity.

The "persist each round as it completes" rule is the most important
architectural commitment in the whole prototype. With it:
- Polling now → SSE later is just adding a pub/sub on writes.
- Pause/resume later is just a `status` flag the runner checks before each round.
- Crash recovery later is "find runs in `running` state and resume them."
- Inject-events later is "append to a sibling table; prompt builder picks them up."

Without it, all of those become rewrites.

**Forward path:** SSE, pause/resume, mid-run injection, all enabled by the
write discipline.

---

## 6. Manager mechanics: static foil for v1; data model symmetric

In the prototype, the manager is a one-way prop: their personality affects the
worker's morale, but they have no morale of their own and no quantified output.
**However**, the agent schema includes `morale` and `self_perception` columns
on every agent (manager and worker alike) — they're just not updated for
managers in v1.

**Why:** Static-foil is the simpler v1; bidirectional manager↔worker dynamics
(the more interesting case) are an immediate follow-on. Keeping the schema
symmetric means turning on manager-side state is a code-path flip, not a
migration.

**Forward path:** Wire the same per-round update loop for managers; their
"output" becomes the sum of their direct reports' paper-sold.

---

## 7. Round anatomy: deterministic situation tag → manager turn → worker turn

Each round, the engine deterministically picks a `situation_tag` from a small
fixed list (e.g., `routine_check_in`, `missed_target`, `big_client_won`,
`tight_deadline`, `peer_conflict`, `quiet_week`). The manager's prompt
incorporates the tag as the day's context. Single exchange per round (one
manager message, one worker response). Manager sees their profile + full
transcript; **does not see the worker's `self_perception`** (private inner
monologue).

**Why:** Without a per-round pretext, conversations devolve into "how are you
doing?" / "fine." The tag costs zero extra LLM calls and adds the variability
that makes rounds feel distinct. Hiding the worker's self-perception from the
manager preserves the asymmetry that makes the sim interesting — the manager
has to *infer* internal state from observable behavior, just like in life.

**Forward path:** Replace deterministic tag picking with a stochastic process
seeded by `situation_tag_seed` (already in the config snapshot). Add tags. Make
tags context-aware (e.g., "missed_target" is more likely when behind pace).

---

## 8. Manager target: total paper goal; manager-only visibility

The simulation has a `target_paper` value (total over all rounds). The
manager's prompt sees `{ target, current_total, rounds_remaining,
on_pace_description }`. The worker does **not** see the target.

**Why:** Hiding the target from the worker forces the manager's communication
style to be the *channel* through which target pressure reaches the worker. A
direct manager broadcasts urgency clearly; a passive-aggressive manager turns it
into guilt; a hands-off manager fails to transmit it at all. That's exactly the
personality-mismatch dynamic worth simulating. Letting the worker see the target
collapses that variance.

**Forward path:** Optionally make target visibility a per-agent toggle for
researchers wanting to A/B that exact lever.

---

## 9. Stack

- **Backend:** Node + TypeScript + Fastify
- **DB:** SQLite via `better-sqlite3` + Drizzle ORM
- **LLM:** OpenAI (`gpt-4.1` or `gpt-4o`) behind a `LLMClient` abstraction so
  providers swap by changing one factory line
- **Frontend:** Next.js (App Router) + React + Tailwind
- **Repo shape:** Single repo, two folders (`apps/api`, `apps/web`) + a tiny
  `packages/shared` for cross-boundary types and the `LLMClient` interface.
  No npm workspaces — relative imports or a tsconfig path alias.

**Why:** All boring, type-friendly, fast to set up, and each component has a
clean upgrade path (SQLite→Postgres via Drizzle; polling→SSE via Fastify;
OpenAI→Anthropic via the abstraction). Monorepo-without-workspaces avoids
tooling overhead the prototype doesn't need.

**Why Next.js for the frontend:** Even though the prototype only needs three
client-rendered screens, Next.js gives us file-system routing without adding
`react-router`, a built-in dev server, and a clean upgrade path if we later
want server components (e.g., server-rendered runs list with revalidation),
route handlers (replace polling with edge SSE), or deployment to Vercel. The
whole prototype runs as client components against the Fastify API — no Next
server data fetching is used in v1.

**Why the LLM abstraction:** OpenAI for now (user's key), but the shape of the
problem is provider-agnostic. The interface exposes only `complete()` and
`completeStructured<T>()` — both providers have first-class structured output;
prompt caching is left to providers (handled automatically as long as static
prefix comes first).

---

## 10. Agent creation: manual forms + Office-themed presets

Setup screen has free-form text fields for each agent's profile, plus a
"Load preset" dropdown with hand-authored Office characters (Michael Scott,
Jim Halpert, Dwight Schrute, etc.). Editing after loading is just normal form
editing.

**Why:** Pure-manual leaves the user staring at empty boxes on first run;
LLM-generated agents add a flow step before the *real* flow and remove the
authorship feel. Presets give zero-friction first-run, double as implicit
documentation of what good profiles look like, and lean into the obvious paper-
company touchstone for instant demo legibility.

**Forward path:** Add LLM-generated agents as an optional flow alongside
presets. Add user-authored saved profiles ("my custom Michael").

---

## 11. Run persistence: saved history; experiment-aware schema; sandbox by default

Every run is persisted with a full snapshot of its inputs in a `config_json`
blob (agent profiles, target, round count, model, temperature, prompt template
version, situation-tag seed, sim engine version). A nullable `experiment_id`
column groups replicates. Sandbox runs (the default in the prototype) have
`experiment_id = null`.

**Why:** A single LLM run is a *sample*, not a result — runs are experiments,
and experiments need replicates and clear conditions. The architectural
commitment we make now is: snapshot inputs immutably (so editing a preset
tomorrow doesn't contaminate today's data), capture every variance source on
the run row (so differences between runs can be attributed), and reserve the
schema slot for grouping (`experiment_id`) even though the UI doesn't expose it
yet. `config_json` stays loose during prototype — the discipline is "whenever
you add a new variance source, add it to the blob."

**Forward path:** Experiments view (`GROUP BY experiment_id`), aggregate stats
(mean ± stddev), comparison UI between experiments, "run N replicates" button.

---

## 12. Failure modes: persistent LLM failure → fail entire run

`LLMClient` retries transient errors (HTTP 429, 5xx, timeout, malformed JSON)
internally with exponential backoff (≤3 attempts). On final failure, it throws.
The runner catches the throw, marks the run `status = 'failed'` with
`error_message` and `failed_at_round`, and stops. No placeholder rounds, no
partial-data preservation.

**Why:** A run with a synthetic placeholder round is *worse* than no run for
experimental purposes — it pollutes data with a step that wasn't actually
generated by the LLM. Better to discard and re-run cleanly. User-driven
recovery (resume after failure) is the right long-term answer but uses the same
plumbing as pause/resume; both are deferred.

**Forward path:** Failed runs become resumable when pause/resume lands.

---

## Default assumed (not asked, worth flagging)

**Runner is in-process async.** The runner kicks off via fire-and-forget async
in the same Fastify Node process that received `POST /runs`. Single Node
process, single SQLite file, no queue, no workers. Correct for a single-user
local prototype; revisit when there are concurrent users or runs taking
minutes.
