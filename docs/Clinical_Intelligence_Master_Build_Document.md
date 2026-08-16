# Caribbean Clinical Intelligence Platform
## Master Build Document

**For:** the build agent (Kimi K3, NoInfra OpenClaw workspace)
**Status:** complete and self-contained. Start at Section 13, Phase 0.
**Scope:** standalone product. No dependency on any existing EHR, codebase, or voice system.
**Primary device:** tablet. Must also work on phone and desktop.

---

# 1. Working agreement

- You choose the stack, libraries, storage, and hosting. Declare those choices in Phase 0 with one line of justification each, then do not change them mid-build without saying so.
- Build in the order in Section 13. Each phase has an acceptance gate. Do not start the next phase until the current one passes.
- Report at the end of each phase: which test scenarios pass, which fail, what you changed from this document and why.
- Where this document is silent, choose the simplest thing that works and note the choice. Where it is contradictory, stop and ask.
- Do not invent clinical thresholds, drug interactions, or diagnostic criteria on your own authority. Section 12 governs clinical logic.
- Do not change a test scenario to match the behaviour you built. If you believe a scenario is wrong, say so and ask.

---

# 2. The product in one page

A clinician logs in and sees a ranked list of which patients need attention today, each with a one-line clinical reason. They open a patient, type or paste their encounter note in plain language, and the system turns it into a structured record. Anything the system is unsure about is flagged rather than guessed. The clinician reviews, corrects, and approves. On save, the system re-assesses the whole patient population for clinical risk and scans the new record for documentation gaps, then updates the ranked list without anyone clicking refresh. The clinician resolves a gap in one tap, or dismisses a flag they disagree with.

Four agents do this work:

1. **Intake and Context** assembles the relevant history
2. **Record Structuring** turns narrative into a structured record
3. **Clinical Intelligence** assesses risk and ranks the population
4. **Documentation and Compliance** finds gaps and offers one-tap resolutions

The clinician approves or decides at three points. The agents do everything else.

**What wins here:** four distinct agents with genuinely distinct jobs, real handoffs visible on screen, autonomous triggering rather than one button per agent, human decision points that carry weight, and reasoning a person can read. Not "the model gives good answers." A thin wrapper over a large model fails the brief even if its outputs are excellent.

---

# 3. Decisions you make vs decisions you ask about

**You decide, no need to ask:**
- Language, framework, styling approach, state management
- Storage engine and schema implementation
- How agents are orchestrated and how parallelism is achieved
- Prompt structure and how model output is validated
- Auth implementation
- Hosting and deployment target

**Ask before proceeding:**
- Anything that changes the four-agent structure
- Anything that removes or bypasses a human decision point
- Any clinical rule not covered in Section 12
- Any change to the data model that removes a field another component relies on

---

# 4. Data model

Described in plain terms. Implement it however you like, but these entities and relationships must exist.

### Patient
- Identifier
- Name, age, sex
- Known conditions (list, each with a diagnosis date)
- Current medications (list)
- Allergies (list)
- Assigned clinician
- Current status: **critical, watch, stable, or managed**
- Current queue position

**On status:** managed means a risk was identified and a clinician acted on it, with the action pending or complete. Stable means no risk was identified at all. These are clinically different and must not be collapsed. A managed patient drops out of the urgent positions but stays visually distinct.

### Encounter
- Identifier
- Patient reference, clinician reference, date
- Raw note (the free text exactly as entered)
- Structured content: subjective, objective, assessment, plan
- Field confidence: per structured field, confident or flagged, and if flagged what is ambiguous
- Status: draft, awaiting approval, approved
- Approved by, approved at
- Version number, reference to the version it amends, amended by, amended at

A patient has many encounters. Encounter history is not optional. Agents 1 and 3 both need it.

### Observation
- Patient reference
- Type (blood pressure, HbA1c, weight, and so on)
- Value and unit
- Date recorded
- Whether it is overdue relative to the patient's conditions

### Risk flag
- Patient reference
- Flag type, urgency (critical, watch, stable)
- Reasoning (one sentence, plain clinical language, always populated)
- Recommended action
- Triggering encounter or observation
- Created at
- Status: active, resolved, or dismissed
- Dismissal reason and dismissed by, when applicable

### Documentation alert
- Patient reference, encounter reference
- Gap type: missing diagnosis, missing result, incomplete note, missing billing code
- Description
- Resolution action: what exactly one tap will do
- Status: open or resolved
- Resolved by, resolved at

### Order
- Patient reference, encounter reference
- Order type and what is being ordered
- Status: requested, completed
- Ordered by, ordered at
- Which documentation alert generated it

### Billing entry
- Patient reference, encounter reference
- Code, description
- Status: draft, recorded
- Which order or encounter it derives from

### Clinician
- Identifier, name, credentials
- Assigned patient population
- Login credentials

### Agent run log
- Which agent, which trigger, which patient
- Started at, completed at, duration
- Input summary, output summary
- Success or failure

The run log is not optional. It powers the on-screen agent activity display and it is the evidence that the agents are real and that two of them run in parallel.

---

# 5. Agent contracts

Each agent is a defined transformation with a defined input and output. Build them so each can be tested in isolation.

### Agent 1: Intake and Context

**Trigger:** clinician submits an encounter note.

**Input:** patient identifier, raw note text.

**Behaviour:** retrieve the patient record and all prior encounters. Decide which prior encounters and observations are relevant to this note. Summarise them into a context brief.

**Output:**
- The raw note, unchanged
- List of prior encounter identifiers selected as relevant
- One sentence explaining why they were selected
- Context brief: relevant conditions, medications, recent observations
- Count of items considered versus selected

**Rules:**
- Never modify the raw note
- Always populate the selection reasoning, even when it selects everything
- If the patient has no prior encounters, say so explicitly rather than returning empty
- Selecting everything every time means the relevance judgement is not real. A note about breathlessness should surface the cardiac and sickle cell history, not the whole chart.

### Agent 2: Record Structuring

**Trigger:** Agent 1 completes.

**Input:** raw note, context brief from Agent 1.

**Behaviour:** parse the narrative into subjective, objective, assessment, and plan. Extract observations (vitals, lab values) as structured data. Mark confidence per field.

**Output:**
- Four populated sections
- Extracted observations with values and units
- Per field: confident or flagged, and if flagged, what is ambiguous
- Encounter status set to awaiting approval

**Rules:**
- **Never guess.** If a value is ambiguous, contradictory, or missing a unit, flag the field. Flagging is correct behaviour, not failure.
- Never write to the saved record. Output is a draft pending human approval.
- If the note contains contradictory information, surface both readings in the flag rather than picking one.
- Informal or colloquial phrasing must still structure correctly. Clinical meaning is not lost to register.

### Agent 3: Clinical Intelligence

**Trigger:** an encounter reaches approved status, or a population run is invoked. Automatic in the first case, no user action.

**Input:** the encounter or population in scope, the full patient records, the clinician's whole population.

**Behaviour:** assess clinical risk. Re-rank the population. Produce flags with reasoning.

**Output:**
- Risk flags with urgency, one sentence of reasoning, and a recommended action
- Updated status per patient
- Re-ranked priority queue

**Rules:**
- Every flag carries reasoning in plain clinical language. A flag with no reasoning is a bug.
- Ranking considers severity, trend across encounters, and time since last contact. Not severity alone.
- Stable patients must be able to stay stable. **Over-flagging is a failure mode, not a safe default.**
- Reasoning must reference trends where they exist, not just the latest value.
- For comorbidities, connect the conditions rather than listing them separately.
- Outside the encoded logic, return a lower confidence flag stating the assessment is uncertain. Never invent a threshold.
- Repeated runs over unchanged data produce stable rankings. No random shuffling.
- Output is advisory. It never auto-orders, auto-prescribes, or diagnoses.
- A dismissed flag does not regenerate identically.

### Agent 4: Documentation and Compliance

**Trigger:** same trigger as Agent 3. Runs **in parallel**, not after.

**Input:** the encounter and patient record in scope.

**Behaviour:** scan for missing diagnoses relative to what the note describes, results referenced but not recorded, incomplete required fields, and missing billing codes.

**Output:**
- Documentation alerts with gap type, plain description, and a resolution action
- Each resolution action defines exactly what one tap will do

**Rules:**
- Must run independently of Agent 3. If Agent 3 fails, Agent 4 still returns.
- Resolution actions must be genuinely executable. No alert offers a fix that does nothing.
- Do not flag the same gap twice across encounters.
- Do not manufacture gaps on a well documented record.

### Cross-cutting

- Name each agent in the interface when it acts. A person should be able to point at the screen and say "that is the documentation agent."
- Agents 3 and 4 firing in parallel on one trigger must be visible in the layout, not merely implied.
- Every flag and alert carries plain language reasoning.
- Voice is out of scope. Agent 1 is input-agnostic by design, so a voice adapter can be added later without touching agents 2 through 4.

---

# 6. Orchestration and triggers

- **Encounter submit** runs Agent 1, then Agent 2, in sequence. Both complete before the clinician sees the review screen.
- **Encounter approval** fires Agents 3 and 4 **in parallel** on the same event.
- **Population run** invokes Agents 3 and 4 across the clinician's entire population, independent of any encounter. Runs on a schedule (nightly is the natural framing) and on demand from the interface. This is what populates the queue before any encounter exists, and it is the recovery path if the queue looks stale.
- The dashboard updates when agents complete, with no manual refresh. Use whatever push or polling approach you prefer.
- Every agent invocation writes to the run log.
- If one of Agents 3 or 4 fails, the other still delivers and the interface shows a failure state for the one that did not. Never fail the whole loop on one agent.
- **Target: encounter approval to updated dashboard in under 10 seconds.**

---

# 7. The complete workflow

Seven core steps plus the paths that surround them. All are build requirements.

| # | Event | What happens | Agent |
|---|---|---|---|
| 1 | Clinician logs in | Priority queue already populated and ranked, produced by the last population run. Each row shows status, one-line reasoning, days since last encounter. | Clinical Intelligence (prior run) |
| 2 | New encounter begins | Clinician opens an encounter for a patient. Free text area, not a form. | Intake and Context activates |
| 3 | Context assembly | Agent reports how many prior encounters it considered and how many it selected, with a reason. | Intake and Context running |
| 4 | Record structuring | Sections populate automatically. Ambiguous fields flagged amber for review, never guessed. | Record Structuring |
| 5 | Clinician approves | Reviews, corrects a field, approves. Record saves only on this action. | **Human decision point one** |
| 6 | Agents trigger | Dashboard refreshes with no user action. Patient animates to a new position with updated status. New flags appear with reasoning. | Clinical Intelligence and Documentation **in parallel** |
| 7 | Resolution | One tap on an alert: creates the order, creates the billing entry, closes the alert, re-assesses the patient, updates status to managed. All five outcomes visible. | **Human decision point two** |

**Additional paths, all required:**

- **Dismissal.** Every risk flag carries a dismiss action requiring one of three reasons: not clinically relevant, already addressed, or disagree with assessment. Dismissed flags are logged with reason, visible in the record, and do not regenerate identically. **This is human decision point three and it is the most meaningful one, because it is the only place a clinician can tell the system it is wrong.**
- **Amendment.** An approved encounter can be amended. Creates a new version, preserves the original, records who and when, re-triggers assessment.
- **Search and population list.** A clinician must be able to reach a patient who is not in the top five.
- **On-demand population run.** Exposed as a control in the interface.

---

# 8. Screens and states

Every screen needs its default, loading, empty, and error state. A screen without an empty state is unfinished.

### 8.1 Login
- Email, password, sign in
- Errors name what went wrong, never vague
- No marketing copy, no hero

### 8.2 Priority queue (landing)

The most important screen. Everything else supports it. Its single job: tell the clinician who to see first, and why.

**Contains:**
- Clinician name, date, count of patients needing attention
- Ranked rows: status marker, name, age, one line of clinical reasoning, days since last encounter, count of open alerts
- Top five prominent, remainder scrollable
- Last population run time, plus a control to run it again
- Agent activity strip
- Search, and a link to the full population list

**States:**
- Default: five or more ranked patients
- Loading: skeleton rows, agent strip showing the run in progress
- Empty, nothing flagged: states plainly that nothing needs attention and when it was last checked. This is a good outcome, not an error. No empty-box illustration.
- Empty, no run yet: offers the run control directly
- Error: says the assessment failed, offers retry, still shows the last known queue rather than a blank screen

### 8.3 Patient detail

**Contains:**
- Header: name, age, sex, status, conditions, medications, allergies
- Active risk flags with reasoning, recommended action, and dismiss control
- Open documentation alerts with one-tap resolution and a plain description of what the tap will do
- Orders and their status
- Encounter history, most recent first, expandable
- New encounter action

**States:**
- No active flags: states that no risks are flagged and when last assessed
- No encounter history: states this is a new patient
- Resolution in progress: only the affected alert shows progress, the rest stays usable

### 8.4 New encounter

**Contains:**
- Patient context header, so the clinician always knows who they are documenting
- One large free-text area, plain narrative, not a form
- Submit

**Processing state is a designed screen, not a spinner:**
- Agent 1 named, working, then reporting what it found and why
- Agent 2 named, working, then complete
- The context Agent 1 assembled stays visible when review appears

This is the moment the interface has to earn attention. Give the handoff real design attention rather than a progress bar.

### 8.5 Encounter review (decision point one)

**Contains:**
- Four structured sections, populated and fully editable
- Flagged fields visually distinct, each stating what specifically is ambiguous
- Extracted observations as values with units, editable
- Agent 1 context panel: which prior encounters were pulled and why
- The original raw note, viewable, never silently discarded
- Approve and save

**Rules:**
- Approve is the only path to saving. No autosave that bypasses it.
- Unresolved flagged fields may still be approved, but the interface states clearly they will be saved as flagged
- The control says what it does, and the confirmation uses the same word

### 8.6 Post-approval and resolution (decision points two and three)

Returns to the queue.

- Agent strip shows Clinical Intelligence and Documentation running **side by side, simultaneously**
- Results land. The patient's row **animates** to its new position rather than the list silently reordering
- New flags appear with a brief highlight, then settle
- Tapping an alert shows exactly what the resolution will do before it does it
- On confirm: order created, billing entry created, alert closed, patient re-assessed, status updated. Each outcome visible, not just a success toast
- Dismissing a flag asks for one of the three reasons, then removes the flag and records it
- Never block the whole screen during agent work
- If one agent fails and the other succeeds, show the result and a clear failure state for the other

### 8.7 Population list
- Full patient list, sortable by status, name, last seen
- Search by name
- Same status markers as the queue

### 8.8 Agent activity view

The strip expanded into a full view.
- Chronological runs: agent, patient, trigger, duration, outcome
- Filter by agent
- Failed runs shown with what failed

Build this as a real feature. A clinician auditing why a patient was flagged uses it.

---

# 9. Design direction

### The brief
A tool a nurse or physician opens at 7am in a clinic with variable lighting, on a tablet, while someone is waiting. Readable, unambiguous, fast to parse. Not a consumer dashboard and it should not look like one.

### Principles
- **Colour carries clinical meaning and nothing else.** No decorative colour anywhere. If red, amber, and green appear, they mean urgency. A brand accent on a button breaks glanceability instantly.
- **Neutral base, high contrast.** Cool near-white or light grey ground, near-black text. Avoid warm cream backgrounds with terracotta accents, which read as generic AI-generated design.
- **Reasoning is content, not metadata.** The one-line clinical reason is the most valuable text on the screen. Body size, not small grey caption text.
- **Density over whitespace.** Five patients visible without scrolling. This is a working tool.
- **Nothing decorative.** No gradients, no illustrations, no shadows for their own sake.

### The signature element
**The agent activity strip.** A persistent, quiet band showing agent work as it happens and recent completed runs, each named. Not a spinner, not debug output. It is the one place the interface allows itself motion, and it is the direct evidence that four coordinated agents exist. Spend the design effort here.

### Type
- Two faces: one for interface and data, one for clinical narrative
- The interface face needs unambiguous numerals, since it renders lab values and dosages. Tabular figures where values align in columns.
- Clear scale. Patient names and reasoning sit high in it. Timestamps sit low.
- Sentence case throughout, except status labels.

### Urgency system

| Status | Meaning | Non-colour indicator |
|---|---|---|
| Critical | Needs attention today | Solid marker, heaviest label weight |
| Watch | Deteriorating or overdue | Half marker |
| Stable | No risk identified | Outline marker |
| Managed | Risk acted on, pending or complete | Marker with check |

Test the palette on a projector and in bright daylight before locking it.

### Motion
Three places only. Everywhere else, none.
1. Agent work in progress, in the strip. Restrained and continuous.
2. **Queue re-ranking.** Rows move to new positions over roughly half a second so the change is witnessed. The single most important animation in the product.
3. New flag arrival: a brief highlight that settles.

Reduced-motion preference turns the re-rank into an instant reorder with the moved row highlighted.

### Copy rules
- Name things the way a clinician would: patient, encounter, note, flag, alert, order
- Controls say what they do. "Approve and save", not "Submit"
- A control's word survives the whole flow. Approve produces Approved.
- Errors state what happened and what to do. They do not apologise and are never vague.
- Empty states give direction
- **Never imply diagnosis.** The system flags, ranks, and surfaces. The clinician decides.
- Every flag's reasoning reads as a clinical sentence, not a template with slots filled in

### Quality floor
- Responsive: phone, tablet, desktop. Tablet first.
- Touch targets sized for a gloved finger on a tablet
- Visible keyboard focus on every interactive element
- Colour never the only carrier of meaning
- Text contrast tested for variable clinic lighting
- No layout shift when agent results arrive. Reserve the space.

---

# 10. Seed data

- 12 to 15 fictional patients assigned to one clinician
- **Each patient needs 2 to 5 prior encounters with realistic dates spread over 6 to 18 months.** Static profiles are not enough.
- Observations attached to encounters, some current, some overdue
- **All data fictional.** No real records, no de-identified real data, no real names. Hard constraint.
- Clinical patterns must be Caribbean-accurate even though the people are not

**Required coverage, one patient each at minimum:**

| Profile | Exercises |
|---|---|
| Diabetes with uncontrolled hypertension, HbA1c overdue | Comorbidity reasoning plus documentation gap. The main workflow patient. |
| Dengue with progression markers and recent exposure | Acute regional risk |
| Sickle cell with prior crisis | Chronic regional risk, trend reasoning |
| **Stable, fully documented chronic patient** | **That the system does not over-flag. The most commonly omitted patient and the most important one.** |
| Clinically complete, billing codes missing | Agent 4 firing independently of Agent 3 |
| Overdue follow-up, otherwise unremarkable | Ranking on time since contact |
| Long chart, 5 or more encounters | Agent 1 relevance selection |
| No prior encounters | Agent 1 empty-history handling |
| Worsening trend across encounters | Agent 3 trend reasoning |

**Required sample notes:**
- Clean and unambiguous
- Containing a value with a missing or ambiguous unit
- Containing contradictory information
- Informally or colloquially phrased

If the population cannot exercise a test scenario, the population is incomplete, not the scenario.

---

# 11. Credit and latency budget

- Instrument token spend from Phase 0 against the 5M credit pool. Report at each gate.
- Full-population assessment is the expensive call. Run it deliberately, not on every development save.
- **Cache agent outputs for the seeded population.** Only the new encounter requires a live model call. This cuts latency, cuts spend, and is the network-failure contingency in one move.
- Reserve at least 20 percent of the pool for the final phase.

---

# 12. Clinical logic bounds

- Risk logic covers the Caribbean disease patterns the seed data represents: diabetes and hypertension comorbidity, dengue, sickle cell, and chronic disease follow-up gaps.
- **Every clinical threshold used must come from published guidance and be recorded in a single clinical reference file with its source.** No magic numbers scattered through prompts or code.
- The reference file must be readable by a non-technical person. It is the artifact a clinician reviews.
- Outside the encoded logic, the correct output is a lower confidence flag stating the assessment is uncertain. Never an invented threshold.
- The system is advisory throughout. Interface copy must reflect that it surfaces and ranks for a clinician who decides.

---

# 13. Build order

### Phase 0: setup
- Declare stack choices, one line of justification each
- Repo, environment, model access confirmed, a test call succeeding
- Token spend instrumentation in place

**Gate:** a test model call returns and spend is logged.

### Phase 1: data layer and seed
- Implement every entity in Section 4
- Load the seed population from Section 10
- A way to inspect the data

**Gate:** all seed patients exist with encounter histories and observations, readable back correctly. Section 14.11 confirmed.

### Phase 2: Agent 3 alone
- Clinical Intelligence against one patient, then the full population
- Clinical reference file started

**Gate:** scenarios A3-1 through A3-7 pass. **A3-2 in particular.**

### Phase 3: Agent 4 alone
- Documentation agent against the same population
- Resolution actions defined and executable

**Gate:** scenarios A4-1 through A4-5 pass.

### Phase 4: Agents 1 and 2
- Intake and Context, then Record Structuring
- Tested with all four sample notes

**Gate:** scenarios A1-1 through A1-4 and A2-1 through A2-5 pass.

### Phase 5: orchestration
- Triggers wired per Section 6, including the population run
- Agents 3 and 4 in parallel on approval
- Run log populated
- Orders and billing entries created on resolution

**Gate:** OR, PR, OB scenarios pass, plus GP-1 through GP-6.

### Phase 6: interface
Build in this order:
1. Priority queue with real data, unstyled
2. Patient detail, unstyled
3. New encounter and review flow, unstyled
4. Full loop completable in a browser
5. Urgency system and type applied across all screens
6. Agent activity strip
7. Re-rank and arrival motion
8. Every empty, loading, and error state
9. Responsive pass, tablet first
10. Quality floor pass

**Do not style before step 4.** The loop working end to end is the gate.

**Gate:** UI, NV, ST, FD, AM scenarios pass, plus the full golden path.

### Phase 7: hardening
- Latency to the under-10-second target
- Failure handling per agent
- Caching for the seeded population
- Auth and per-clinician scoping

**Gate:** everything passes, including PF and PA. The loop runs clean three times consecutively.

---

# 14. Test scenarios

Run the relevant suite at each gate and report a pass table: scenario ID, pass or fail, and for failures what actually happened. A scenario fails if any part of its expected result is missing.

**[CRITICAL]** marks scenarios that fail silently. They look fine in a casual click-through and are wrong underneath. Verify these deliberately, every time.

## 14.1 Golden path

**Setup:** seeded population, one clinician, the comorbidity patient with an overdue HbA1c at watch status, last seen roughly six weeks ago. A prepared note mentioning a blood pressure reading, current medication, a dengue exposure, and one genuinely ambiguous detail.

| ID | Action | Expected |
|---|---|---|
| GP-1 | Sign in | Queue already populated and ranked. Target patient at a middle position, watch status, correct reasoning, correct days since last encounter. Last run time visible. |
| GP-2 | Open a new encounter | Correct patient in the context header. Free text area, not a form. |
| GP-3 | Enter the note and submit | Agent 1 named while working, then reports how many prior encounters considered and selected, with a reason. Agent 2 then named while working. |
| GP-4 | Wait for structuring | All four sections populated. The ambiguous detail flagged amber with a specific explanation. Observations extracted with units. Raw note still viewable. |
| GP-5 | Correct the field, approve | Record saves only on this action. Confirmation uses the same word as the control. |
| GP-6 | Observe without clicking | Both agents shown running side by side. Queue updates with no manual refresh. Patient animates to position 1, critical. Two flags with plain clinical reasoning. |
| GP-7 | Tap the missing-result alert | Interface states what will happen before confirming. On confirm: order created, billing entry created, alert closed, patient re-assessed, status becomes managed. All five visible. |
| GP-8 **[CRITICAL]** | Measure GP-5 to GP-6 | Under 10 seconds on the target device. |
| GP-9 | Whole run | Zero page reloads, zero manual refreshes, no developer console. |

## 14.2 Agent 1

| ID | Scenario | Expected |
|---|---|---|
| A1-1 | Patient with 5 or more prior encounters | Selects a subset, not all. States considered versus selected, with reason. |
| A1-2 **[CRITICAL]** | Note mentions a symptom tied to one condition in a long chart | Encounters relevant to that condition are among those selected. Always returning everything fails. |
| A1-3 | Patient with no prior encounters | States explicitly there is no prior history. No empty panel, no error. |
| A1-4 | Any note | The raw note passed downstream is identical to what was entered. |

## 14.3 Agent 2

| ID | Scenario | Expected |
|---|---|---|
| A2-1 | Clean note | All sections populated, nothing flagged, observations with correct units. |
| A2-2 **[CRITICAL]** | Value with missing or ambiguous unit | Field flagged, not guessed. Explanation names what is ambiguous. |
| A2-3 **[CRITICAL]** | Contradictory information | Both readings surfaced in the flag. No silent pick. |
| A2-4 | Any note | Nothing written to the saved record before approval. Verify at the data layer. |
| A2-5 | Informal phrasing | Still structures correctly. Clinical meaning preserved. |

## 14.4 Agent 3

| ID | Scenario | Expected |
|---|---|---|
| A3-1 | Full population assessed | Every patient has a status. Every flag has reasoning. No empty reasoning. |
| A3-2 **[CRITICAL]** | The stable, fully documented patient | Stays stable. No flags. If flagged, the system over-flags and the ranking is worthless. |
| A3-3 | Overdue follow-up only | Ranked up on time since contact. Reasoning names the overdue follow-up. |
| A3-4 | Worsening trend across encounters | Reasoning references the trend, not just the latest value. |
| A3-5 | Comorbidity patient | Reasoning connects the conditions rather than listing them. |
| A3-6 | Case outside encoded logic | Lower confidence flag stating uncertainty. No invented threshold. |
| A3-7 | Same population run twice, unchanged | Stable ranking. No random shuffling. |

## 14.5 Agent 4

| ID | Scenario | Expected |
|---|---|---|
| A4-1 | Clinically complete, billing codes missing | Alert raised for the billing gap alone. |
| A4-2 **[CRITICAL]** | Agent 3 disabled or failing | Agent 4 still returns alerts. Genuinely independent. |
| A4-3 | Fully documented patient | No alerts. Does not manufacture gaps. |
| A4-4 | Same gap across two consecutive encounters | Not duplicated into two identical alerts. |
| A4-5 | Every alert generated | Resolution action executable, description accurate. |

## 14.6 Orchestration

| ID | Scenario | Expected |
|---|---|---|
| OR-1 **[CRITICAL]** | Encounter approved | Agents 3 and 4 overlap in execution. **Verify in the run log, not by watching the screen.** Sequential execution fails. |
| OR-2 | Encounter approved | No user action needed to see results. |
| OR-3 | Agent 3 fails, Agent 4 succeeds | Agent 4 results display, clear failure state for Agent 3. Loop does not fail wholesale. |
| OR-4 | Agent 4 fails, Agent 3 succeeds | Mirror of OR-3. |
| OR-5 | Any agent run | Logged with agent, trigger, patient, duration, outcome. |
| OR-6 | Malformed model output | Handled gracefully. No crash, no blank screen, no raw error shown to the clinician. |
| OR-7 | Model call times out | Visible retry, then a clear failure if retry does not succeed. |

## 14.7 Population run

| ID | Scenario | Expected |
|---|---|---|
| PR-1 | Fresh system, no encounters, run assessment | Every patient assessed and ranked. Queue populated before any encounter exists. |
| PR-2 | Login after a completed run | Queue populated, last run time visible. |
| PR-3 | Trigger a run from the interface | Runs, updates the queue, logs the run. |
| PR-4 | Login with no run ever completed | Offers the run control directly, not a broken empty queue. |

## 14.8 Orders, billing, status, dismissal, amendment, navigation

| ID | Scenario | Expected |
|---|---|---|
| OB-1 **[CRITICAL]** | One-tap resolution | An order record exists afterwards. Verify at the data layer. |
| OB-2 **[CRITICAL]** | Same | A billing entry exists, linked to the order. |
| OB-3 | Same | Alert closed, does not reappear on next assessment. |
| OB-4 | Same | Patient re-assessed, status updated. |
| OB-5 | Patient detail after resolution | Order appears in the record with its status. |
| ST-1 | Flag acted on | Status is managed, not stable. Visually distinguishable. |
| ST-2 | Never flagged | Status is stable. |
| ST-3 | Managed patient in queue | Drops out of urgent positions, still identifiable as managed. |
| ST-4 | Managed patient whose order completes | Status resolves rather than remaining managed indefinitely. |
| FD-1 | Dismiss a flag | Prompted for one of three reasons. Cannot dismiss without one. |
| FD-2 **[CRITICAL]** | Re-run assessment after dismissal | The identical flag does not regenerate. Otherwise dismissal is cosmetic. |
| FD-3 | Patient detail after dismissal | Dismissal and reason visible in the record. |
| FD-4 | Clinical picture changes materially after dismissal | Behaves per the decision in Section 16. Consistent and documented either way. |
| AM-1 | Amend an approved encounter | New version created, original preserved and viewable. |
| AM-2 | Same | Who amended and when recorded. |
| AM-3 | Same | Assessment re-triggers for that patient. |
| NV-1 | Search for a patient outside the top five | Found and reachable. |
| NV-2 | Open the population list | All patients listed, sortable by status, name, last seen. |

## 14.9 Data integrity and clinical safety

| ID | Scenario | Expected |
|---|---|---|
| DI-1 **[CRITICAL]** | Attempt to reach a saved record without approving | Impossible. No path saves an encounter without the approval action. |
| DI-2 | Any approved encounter | Original raw note retained and viewable. |
| DI-3 | Any flag or alert | Traceable to the encounter or observation that triggered it. |
| DI-4 | Clinician A logged in | Sees only their own population. |
| DI-5 | All seed data | Entirely fictional. Verified by inspection, not assumption. |
| CS-1 **[CRITICAL]** | Read every threshold the system uses | Each appears in the clinical reference file with a source. None live only inside prompts or code. |
| CS-2 **[CRITICAL]** | Read all interface copy | Nothing implies diagnosis. |
| CS-3 | Any recommended action | Advisory in phrasing. Never auto-orders or auto-prescribes. |
| CS-4 | Review all flags across the population | The proportion flagged is plausible for a real caseload. |
| CS-5 | Read ten flag reasonings in sequence | Clinical sentences, not one template with values substituted. |

## 14.10 Interface, presentation, performance

| ID | Scenario | Expected |
|---|---|---|
| UI-1 | Queue while assessment runs | Skeleton rows, agent strip active. No layout shift when results land. |
| UI-2 | Queue with nothing flagged | States plainly nothing needs attention and when last checked. Reads as a good outcome. |
| UI-3 | Assessment fails | Says so, offers retry, still shows the last known queue. |
| UI-4 | Patient with no active flags | States no risks flagged and when last assessed. |
| UI-5 | Patient with no encounter history | States this is a new patient. |
| UI-6 | Resolution in progress | Only the affected alert shows progress. Rest of screen usable. |
| UI-7 | Every error message | Names what happened and what to do. Never vague. |
| PA-1 | View in greyscale | Every status distinguishable by marker and label. |
| PA-2 | Reduced motion enabled | Re-rank becomes an instant reorder with the row highlighted. |
| PA-3 | Tablet, both orientations | Full loop completable. Primary device. |
| PA-4 | Phone | Full loop completable. |
| PA-5 | Desktop and projector aspect | Readable, urgency palette holds under projection. |
| PA-6 | Keyboard only | Every interactive element reachable with visible focus. |
| PA-7 | Queue re-rank | The movement is witnessed. Silent reorder fails. |
| PF-1 **[CRITICAL]** | Approval to queue update | Under 10 seconds on the target device. |
| PF-2 | Full population assessment | Completes and reports duration. |
| PF-3 | Network drops mid-encounter | Cached path continues or a clear recoverable state appears. The entered note is not lost. |
| PF-4 | Loop run three times consecutively | All three clean, no degradation. |
| PF-5 | Token spend across a full loop | Measured and reported against the pool. |
| PF-6 | Second identical population run | Cached results used where appropriate. Spend does not scale linearly with repetition. |

## 14.11 Test data confirmation

Before Phase 2, confirm the seeded population can exercise every scenario above. The required profiles and sample notes are listed in Section 10. If a scenario cannot be exercised, the population is incomplete.

---

# 15. Constraints

Non-negotiable. These do not get traded away for scope or time.

- All patient data fictional. No exceptions, no de-identified real data.
- Three human decision points: approve before save, resolve an alert, dismiss a flag. None may be removed or bypassed.
- Agents named in the interface when they act.
- Agents 3 and 4 run in parallel, not sequentially.
- Every flag and alert carries plain language reasoning.
- Approval to updated dashboard in under 10 seconds.
- Nothing auto-orders, auto-prescribes, or presents itself as diagnostic.
- Every clinical threshold sourced and recorded in the reference file.
- No styling before the loop works end to end.
- Nothing new ships in the final phase that was not working in the phase before.
- Reserve at least 20 percent of the credit pool for the final phase.

---

# 16. Open questions

Answer these before Phase 1. They are cheap now and expensive later.

- Single clinician for the build, or multiple clinicians with separate populations? This changes the data model, the queue header, and the population list.
- Deployed to a public URL, or run locally?
- Existing product name, logo, or palette to work within, or is the visual identity yours to set?
- Should a dismissed flag be permanently suppressed for that patient, or resurface if the clinical picture changes materially? Governs FD-4.
- Is a clinician available to review the clinical reference file, and by when?

---

# 17. Summary of what "done" means

- Four agents, each independently testable, each with a distinct job
- Two of them running genuinely in parallel, provable in the run log
- Three human decision points that carry real weight
- Every flag and alert explaining itself in plain clinical language
- A queue that is populated before anyone does anything, and re-ranks visibly when something changes
- One tap that creates an order, creates a billing entry, closes an alert, and re-assesses a patient
- A clinician able to disagree, and that disagreement sticking
- Every threshold sourced and readable by a non-technical reviewer
- The full loop under 10 seconds, three times in a row, on a tablet
- Every test scenario in Section 14 passing, with the CRITICAL ones verified by hand
