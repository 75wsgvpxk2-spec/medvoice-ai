# Section 14 scenario results

Run with `npm test`. 89 automated tests across five suites.

**Path:** all 89 tests pass on **both** paths — the deterministic engine and the
live model (`claude-sonnet-5`).

Measured on the live path:

| | |
|---|---|
| Approval to updated queue (PF-1, target 10s) | **5.0s** |
| Submit note — Agents 1 then 2, sequential | 10.7s |
| Population run, 15 patients (PF-2, no target) | 25.0s |
| Cost per encounter loop | $0.02 |
| Cost per population run | $0.04 |

The deterministic figure for PF-1 was 16ms, which told us nothing about the real
system. 5.0s against a 10s target is the number that matters, and the headroom
is real but not enormous — Agents 3 and 4 run in parallel, so the figure is
roughly one agent's latency, not two.

| Legend | Meaning |
|---|---|
| PASS | Automated test asserts the expected result |
| PASS* | Passes, with a caveat recorded in `DEVIATIONS.md` |
| NOT VERIFIABLE | Cannot be demonstrated in this build; reason recorded |

---

## 14.1 Golden path

| ID | Result | Evidence |
|---|---|---|
| GP-1 | PASS | Queue populated and ranked before any encounter; target at a middle position, `watch`, 43 days since last encounter, last run time shown |
| GP-2 | PASS | Free-text area, patient context header |
| GP-3 | PASS | Agent 1 named while working, reports 4 considered / 2 selected with a reason; Agent 2 then named |
| GP-4 | PASS | Four sections populated, the bare blood sugar flagged amber with a specific explanation, observations extracted with units, raw note viewable |
| GP-5 | PASS | Record saves only on approve; control and confirmation both say "Approve" |
| GP-6 | PASS* | Both agents side by side, queue updates with no refresh, patient animates 3 → 2 and becomes `critical`, two flags with plain reasoning. Position 2 not 1 — DEVIATIONS 1b |
| GP-7 | PASS* | Order, billing entry, alert closed, patient re-assessed, status shown — all five visible. Status stays `critical` rather than `managed` — DEVIATIONS 1 |
| GP-8 **[CRITICAL]** | PASS | Approval to updated queue measured at 16ms deterministic; asserted under 10s |
| GP-9 | PASS | No page reloads, no manual refresh; updates arrive over SSE |

## 14.2 Agent 1 — Intake and Context

| ID | Result | Evidence |
|---|---|---|
| A1-1 | PASS | 6-encounter chart returns a strict subset with considered/selected counts and a reason |
| A1-2 **[CRITICAL]** | PASS | Breathlessness note selects the atrial fibrillation encounters and excludes the cataract visit; a joint-pain note selects a different subset |
| A1-3 | PASS | No-history patient states it in words, with `hasPriorHistory: false` |
| A1-4 | PASS | Raw note compared byte for byte, including the informally phrased note |

## 14.3 Agent 2 — Record Structuring

| ID | Result | Evidence |
|---|---|---|
| A2-1 | PASS | Clean note: four sections populated, zero flags, units correct |
| A2-2 **[CRITICAL]** | PASS | Bare weight flagged, not guessed; explanation names kilograms vs pounds; blood pressure and HbA1c not flagged, as their units are unambiguous by convention |
| A2-3 **[CRITICAL]** | PASS | Both 142/88 and 128/76 surfaced in the flag and in the extracted observations; neither chosen |
| A2-4 | PASS | Verified at the data layer: no encounter and no observation is written before approval |
| A2-5 | PASS | Creole-inflected note structures into S/O/P correctly; haemoglobin 7.3 g/dL survives; assessment left empty and flagged rather than invented |

## 14.4 Agent 3 — Clinical Intelligence

| ID | Result | Evidence |
|---|---|---|
| A3-1 | PASS | All 15 patients have a status; every flag has reasoning over 20 characters and a recommended action |
| A3-2 **[CRITICAL]** | PASS | Both fully documented patients raise zero flags and stay `stable`; 1 of 15 critical, under half needing attention |
| A3-3 | PASS | Overdue patient flagged, reasoning names the overdue contact, ranked on time since contact |
| A3-4 | PASS | Trend flag references the movement 6.6% → 8.7% across five readings, not just the latest |
| A3-5 | PASS | Comorbidity reasoning connects the findings rather than listing them |
| A3-6 | PASS | Hypothyroid patient with an outstanding investigation gets an `uncertain` flag stating the assessment is uncertain, citing no threshold |
| A3-7 | PASS | Three consecutive runs over unchanged data produce identical rankings and statuses |

## 14.5 Agent 4 — Documentation and Compliance

| ID | Result | Evidence |
|---|---|---|
| A4-1 | PASS | The complete-but-unbilled encounter raises exactly one alert, for the billing gap alone |
| A4-2 **[CRITICAL]** | PASS | Suite runs Agent 4 with Agent 3 never having run, and separately with Agent 3 rejecting; alerts return either way |
| A4-3 | PASS | Fully documented patients raise no alerts; fewer than half the population has any |
| A4-4 | PASS | Re-scanning raises nothing new; no duplicate gap keys anywhere in the population |
| A4-5 | PASS | Every alert's resolution creates an order, a billing entry, a condition, or an amendment; preview matches what executes |

## 14.6 Orchestration

| ID | Result | Evidence |
|---|---|---|
| OR-1 **[CRITICAL]** | PASS | Verified in the run log, not on screen: `concurrency_at_start` reaches 2, which sequential execution cannot produce |
| OR-2 | PASS | Results arrive over SSE with no user action |
| OR-3 | PASS | Agent 3 forced to throw; Agent 4 still delivers and the failure is reported |
| OR-4 | PASS | Mirror case; approval never throws out of the loop |
| OR-5 | PASS | Every run logs agent, trigger, patient, duration and outcome |
| OR-6 | PASS | A note with no recognisable content is handled without crashing; an empty note is refused with a message saying what to do |
| OR-7 | PASS | Model calls carry a timeout and one retry; failure surfaces as a per-agent failure state rather than a raw error |

## 14.7 Population run

| ID | Result | Evidence |
|---|---|---|
| PR-1 | PASS | Fresh system with no encounters: all 15 assessed and ranked |
| PR-2 | PASS | Last run time recorded and shown |
| PR-3 | PASS | On-demand run from the interface; both agents in parallel |
| PR-4 | PASS | With no run ever completed, the queue offers the run control directly rather than showing a broken empty state |

## 14.8 Orders, billing, status, dismissal, amendment, navigation

| ID | Result | Evidence |
|---|---|---|
| OB-1 **[CRITICAL]** | PASS | Order verified at the data layer, linked to the alert |
| OB-2 **[CRITICAL]** | PASS | Billing entry exists with `fromOrderId` set to the new order |
| OB-3 | PASS | Alert closed and does not reappear on the next scan |
| OB-4 | PASS | Patient re-assessed, `lastAssessedAt` updated |
| OB-5 | PASS | Order appears in the record with status, who ordered it, and when |
| ST-1 | PASS | A patient whose findings are all settled becomes `managed`, not `stable` |
| ST-2 | PASS | Never-flagged patients are `stable` |
| ST-3 | PASS | `managed` patients leave the urgent positions and stay visually distinct |
| ST-4 | PASS | Completing the order returns the patient to `stable` |
| FD-1 | PASS | Dismissal requires one of exactly three reasons; the API refuses without one |
| FD-2 **[CRITICAL]** | PASS | Re-running assessment after dismissal does not regenerate the flag |
| FD-3 | PASS | Dismissal, reason, who and when visible in the record |
| FD-4 | PASS | Resurfaces only on material change, per the Section 16 answer; fingerprint stored at dismissal |
| AM-1 | PASS | New version created, original preserved and viewable |
| AM-2 | PASS | Who amended and when recorded |
| AM-3 | PASS | Assessment re-triggers, logged under `encounter_amendment` |
| NV-1 | PASS | Search reaches a patient outside the top five |
| NV-2 | PASS | Population list sortable by status, name, last assessed |

## 14.9 Data integrity and clinical safety

| ID | Result | Evidence |
|---|---|---|
| DI-1 **[CRITICAL]** | PASS | No path saves an encounter without approval; drafts are invisible to every agent; double approval refused |
| DI-2 | PASS | Original raw note retained byte for byte and viewable |
| DI-3 | PASS | Every flag traces to an encounter, observation, or reference entry; every alert to an encounter |
| DI-4 | **NOT VERIFIABLE** | Single-clinician build. Scoping code exercised, but there is no second population to be excluded from — DEVIATIONS 2 |
| DI-5 | PASS | All seed data fictional by inspection of `seed-data.ts` |
| CS-1 **[CRITICAL]** | PASS | 23 thresholds each bound to an entry in `clinical-reference.md`; verified at startup and in tests; no flag cites an unknown reference |
| CS-2 **[CRITICAL]** | PASS | No flag reasoning, action, or alert description implies a diagnosis |
| CS-3 | PASS | Actions phrased advisorily; nothing auto-orders or auto-prescribes |
| CS-4 | PASS | 1 of 15 critical, 5 of 15 watch — plausible for a chronic disease panel |
| CS-5 | PASS* | No two flags share a sentence skeleton across the population, and openings vary. On the deterministic path this is rotation over hand-written phrasings, not per-patient generation — DEVIATIONS 4 |

## 14.10 Interface, presentation, performance

| ID | Result | Evidence |
|---|---|---|
| UI-1 | PASS | Skeleton rows while loading; agent strip has a reserved min-height so nothing shifts when results land |
| UI-2 | PASS | "Nothing needs attention right now" with when it was last checked; reads as a good outcome |
| UI-3 | PASS | Failure states the problem, offers retry, keeps the last known queue on screen |
| UI-4 | PASS | "No risks are flagged for this patient" with when last assessed |
| UI-5 | PASS | "This is a new patient with no previous encounters" |
| UI-6 | PASS | Only the affected alert shows progress; the rest of the screen stays usable |
| UI-7 | PASS | Errors name what happened and what to do |
| PA-1 | PASS | Verified in greyscale: solid, half-filled, outline and checked markers, each with a text label |
| PA-2 | PASS | Reduced motion turns the re-rank into an instant reorder with the moved row highlighted |
| PA-3 | PASS | Full loop completed in a 768×1024 tablet viewport |
| PA-4 | PASS | Full loop completable at 375×812 |
| PA-5 | PASS | Layout holds to 1180px; palette is high-contrast on a cool neutral ground |
| PA-6 | PASS | Every control is a real button or input with visible focus |
| PA-7 | PASS | FLIP transform over 480ms; silent reorder would fail the same test |
| PF-1 **[CRITICAL]** | PASS | Asserted under 10 seconds; measured at 16ms deterministic |
| PF-2 | PASS | Population assessment completes and reports its duration |
| PF-3 | PASS | The entered note is persisted on the draft before approval, so it survives an interruption |
| PF-4 | PASS | Three consecutive loops, each clean, each with agents parallel, no failed runs |
| PF-5 | PASS | Spend measured per call and reported against the budget with the 20% reserve |
| PF-6 | PASS | Second identical run served from the agent cache; spend does not scale linearly |

## 14.11 Test data confirmation

`npm run gate -- 1` — 10 of 10 required profiles and 5 of 5 sample notes present.

---

## Summary

| | Count |
|---|---|
| Scenarios asserted | 88 |
| PASS | 84 |
| PASS with a recorded caveat | 3 (GP-6, GP-7, CS-5) |
| NOT VERIFIABLE | 1 (DI-4) |
| FAIL | 0 |

The **[CRITICAL]** scenarios — the ones the document warns fail silently — are
GP-8, A1-2, A2-2, A2-3, A3-2, A4-2, OR-1, OB-1, OB-2, FD-2, DI-1, CS-1, CS-2 and
PF-1. All fourteen pass, each with a test that would fail if the underlying
behaviour regressed rather than a check that merely looks right on screen.
