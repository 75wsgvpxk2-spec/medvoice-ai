# Stack declaration — Phase 0

Per Section 1 of the build document: these choices are declared once and do not change
mid-build without an explicit note.

## Answers to Section 16 (open questions)

| Question | Answer | Source |
|---|---|---|
| Single clinician or multiple? | **Single clinician.** One `Clinician` row, one population. | User decision |
| Public URL or local? | **Local, deploy-ready.** Runs on localhost; deployment is a config change, not a rewrite. | User decision |
| Existing name/logo/palette? | **Visual identity is ours to set**, per Section 9's direction. | Assumed — no brand supplied |
| Dismissed flag: suppressed or resurfacing? | **Resurfaces on material change.** Suppressed while the clinical picture is unchanged; regenerates only when underlying data moves materially. Governs FD-4. | User decision |
| Clinician available to review the reference file? | **None assumed available.** `docs/clinical-reference.md` is written to be reviewable by a non-technical clinician, with every threshold sourced, and is the artifact handed over for review whenever one is available. | Assumed — no reviewer named |

### Consequence of the single-clinician answer, recorded honestly

Test **DI-4** ("Clinician A logged in sees only their own population") cannot pass as
written, because there is no Clinician B to be excluded from. The scoping *code path*
exists and is exercised — every population query filters by the session's clinician id —
but with one clinician in the database the test cannot demonstrate isolation.
DI-4 is reported as **NOT VERIFIABLE (single-clinician build)** rather than as a pass.
Per Section 1, the scenario has not been altered to match what was built.

## Stack choices, one line of justification each

| Choice | Selection | Why |
|---|---|---|
| Language | **TypeScript**, ESM throughout | One type vocabulary shared by server, client, and agent contracts, so a data-model change breaks the build instead of failing at runtime in a clinic. |
| Server runtime | **Node 24** via `tsx` | Already present, and `tsx` runs TypeScript directly so there is no build step between editing an agent and testing it. |
| HTTP server | **Express 5** | The simplest thing that works for a JSON API plus SSE plus static files, with no framework conventions to fight. |
| Storage | **SQLite** via `better-sqlite3` | A real relational store with foreign keys for the eight entities in Section 4, in a single file that can be inspected with any SQLite tool — which is itself the Phase 1 "way to inspect the data" requirement. |
| Query style | Hand-written SQL in a thin repository layer | The data model is fixed and small; an ORM would add indirection over eight tables without removing any real work. |
| Live updates | **Server-Sent Events** | The dashboard requirement is strictly server-to-client push on agent completion; SSE gives that with native browser reconnection and none of the WebSocket handshake surface. |
| Client | **React 19 + Vite** | Fast iteration, and the queue is a list whose identity-stable rows need to animate between positions — a keyed reconciler is exactly the right tool. |
| Client data | **TanStack Query** | Section 8 demands a designed loading, empty, and error state on every screen; those are first-class states here rather than hand-rolled booleans per screen. |
| Styling | **Hand-written CSS with custom properties** | Colour must carry clinical meaning and nothing else (Section 9); a token layer makes the urgency palette a single auditable file, where a utility framework would scatter it across markup. |
| Animation | **FLIP via the Web Animations API**, hand-rolled | Only three animations exist in the whole product; a motion library would be a large dependency for them, and `prefers-reduced-motion` handling has to be explicit anyway (PA-2). |
| Model provider | **Anthropic API** (`@anthropic-ai/sdk`) behind a provider interface | The agents are the product; the interface keeps prompt logic independent of vendor and makes the deterministic engine below a drop-in substitute. |
| Auth | **Signed session cookie** using `node:crypto` HMAC + scrypt password hashing | Real enough for per-clinician scoping without adding a session store dependency for a single-clinician local application. |
| Tests | **Vitest** | Runs the Section 14 scenarios as automated tests against TypeScript directly, sharing the Vite config the client already needs. |

## Model access

No API key is present in this environment, and the Claude Code CLI is not installed as a
binary, so the application cannot borrow this session's authentication.

The model layer therefore has two providers behind one interface:

- **`anthropic`** — live Claude calls. Active when `ANTHROPIC_API_KEY` is set in `.env`.
- **`deterministic`** — a local engine that produces schema-valid agent output with no
  network call. Active when no key is present.

This is not a stub to be replaced later. Section 11 requires cached agent output for the
seeded population as both a latency measure and the network-failure contingency (PF-3),
and Section 14 requires roughly a hundred scenarios to run repeatably without spend.
The deterministic engine is that mechanism. Live model calls are used for new encounter
text, which is the only genuinely unseen input in the system.

**To enable live calls:** put a key in `.env` as `ANTHROPIC_API_KEY=...` and restart.
Do not paste the key into a chat message.

## Token spend instrumentation

Every model call, from Phase 0 onward, records: agent, model, input tokens, output
tokens, cached tokens, computed cost, and duration. Written to the `model_call` table and
summarised by `npm run spend`. Reported at each phase gate per Section 11.
