# Deviations from the build document

Section 1: "Report at the end of each phase: which test scenarios pass, which
fail, what you changed from this document and why." and "Do not change a test
scenario to match the behaviour you built. If you believe a scenario is wrong,
say so and ask."

Nothing here has been changed silently. Each entry says what the document asks
for, what this build does instead, and why.

---

## 1. GP-7 — status after a one-tap resolution

**The document says:** GP-7 expects that on confirming a resolution, the patient
is re-assessed and "status becomes managed".

**This build does:** the status becomes `managed` only when the re-assessment
finds no active flags left. If a higher-urgency flag is still active, the patient
keeps that urgency.

**Why:** Section 4 says a managed patient "drops out of the urgent positions".
Marlene Beaupierre in the golden path is at `critical` on a hypertensive crisis
reading, and the alert being resolved is a missing HbA1c result. Ordering the
HbA1c does not address the blood pressure. Following GP-7 literally would drop a
patient in hypertensive crisis out of the urgent positions because an unrelated
test was ordered — a patient safety problem, not a display problem.

**Status:** **open question for the author.** The mechanism GP-7 describes is
built and all five outcomes are returned and shown; only the specific
critical → managed transition is withheld while a higher-urgency flag is
unaddressed. If the intended reading is that the transition should always
happen, this is a one-line change in `server/src/agents/resolution.ts`.

---

## 1b. GP-6 — the target patient reaches position 2, not position 1

**The document says:** GP-6 expects the patient to animate to position 1 after
approval.

**This build does:** Marlene Beaupierre moves from position 3 to position 2 and
becomes `critical`. Position 1 is held by Desmond Alleyne.

**Why:** Desmond has dengue with warning signs inside the WHO critical phase —
a genuine same-day emergency that was already in the queue before this encounter
began. Both patients are `critical`; the ordering between them comes from the
trend component of the ranking. Forcing the golden-path patient to position 1
would mean ranking a new hypertensive crisis above an actively deteriorating
dengue patient, which is not defensible clinically.

The behaviour GP-6 is testing — the patient moves position visibly, becomes
critical, and both agents run in parallel — all holds. Only the specific
position differs, and only because the seeded population contains a second
genuinely critical patient.

**Status: RULED — accepted by the author.** The behaviour stands as built.
Removing the dengue patient from the population would make GP-6 pass literally,
but Section 10 requires that profile, so the population stays as specified.

---

## 1c. Section 5 — voice was out of scope, and is now in it

**The document says:** "Voice is out of scope. Agent 1 is input-agnostic by
design, so a voice adapter can be added later without touching agents 2
through 4."

**This build does:** the encounter note is voice-first. The clinician speaks and
sees the transcript build live; typing works in the same field.

**Why:** requested by the product owner after the seven phases were complete.
The document anticipated this exactly, and the implementation honours its
design: `client/src/lib/speech.ts` produces plain text and hands it to the same
submit path a typed note uses. Agents 2, 3 and 4 are untouched, and Agent 1
never learns how the words arrived.

**Verified on real hardware.** Microphone capture is blocked in the automated
browser used for this build, so the interface, controls and error states were
checked there, and a live dictation was run separately by the product owner on
a real microphone. That pass is what caught the chunk-size defect below; both
were fixed and dictation was confirmed working end to end afterwards.

One defect only a live run could find: the audio worklet posted one render
quantum per message — 128 frames, 8 ms at 16 kHz — and AssemblyAI closes a
session with code 3007 for any chunk under 50 ms, so dictation died a second or
two after the clinician started speaking. Audio is now buffered into 100 ms
chunks, sized from the rate the audio thread actually runs at rather than the
rate requested, since a browser may ignore the request. The lesson generalises:
an integration can be correct in every part the automated harness can reach and
still fail on the one link it cannot.

**Privacy, addressed but not closed:** browser speech recognition is not
on-device. On Chrome, audio is sent to a Google service with no agreement
covering it. For fictional data that is immaterial; for real patients it is a
data-processing decision.

A second transcriber now exists. Settings offers AssemblyAI's medical streaming
model alongside the browser engine, selected per clinic. The clinic's API key is
held server-side and never reaches the browser: `GET /api/transcription/token`
mints a single-use token that expires in two minutes, which is what opens the
WebSocket. Audio is streamed as 16-bit PCM directly from the browser to
AssemblyAI, so it does not pass through this server either. The encounter screen
names the transcriber in use, because the two send the audio to different places
and that is a fact the clinician should see rather than infer.

**Still required before real patients**, and not something this build can
settle:

- A signed BAA with whichever transcriber is chosen, and retention terms in
  writing. Selecting AssemblyAI in a dropdown is not a contract.
- Benchmarking on recordings of the clinic's own clinicians. Every published
  accuracy figure for medical ASR is measured on US-accented speech; Caribbean
  English and Creole are out of distribution and the vendor numbers do not
  transfer.
- The default remains `browser`, so no clinic is silently switched onto a paid
  external service by upgrading.

---

## 1d. Section 9 — colour, shadow and decoration

**The document says:** "Colour carries clinical meaning and nothing else. No
decorative colour anywhere." and "Nothing decorative. No gradients, no
illustrations, no shadows for their own sake."

**This build does:** carries the MedVoice AI brand through the sidebar, primary
actions, focus states and section headings; uses gradients, shadows, rounded
corners, avatars and a status summary row.

**Why:** Section 16 asked whether an existing logo and palette had to be worked
within. That question was open at Phase 0 and has since been answered — a brand
was supplied — and the product owner asked twice for a modern, colourful
interface. That is their call to make.

**What was held:** red, amber and green still mean urgency and only urgency.
Brand blue never encodes a patient state. Every status is still carried by
colour *and* a distinct marker shape *and* a word, so PA-1 continues to pass in
greyscale, and the density requirement (five patients without scrolling) is met
at tablet and phone.

**Status:** deliberate, owner-directed. Section 9's underlying goal —
glanceability of clinical urgency — is intact; its stylistic prohibitions are
not.

---

## 2. DI-4 — per-clinician population isolation

**The document says:** DI-4 expects that clinician A sees only their own
population.

**This build does:** reports DI-4 as **not verifiable**.

**Why:** the build was scoped to a single clinician (Section 16 open question,
answered by the user). Every population query filters by the session's clinician
id and that code path is exercised, but with one clinician in the database there
is no second population to be excluded from, so the scenario cannot demonstrate
what it is testing.

**Superseded.** The build now supports multiple staff accounts, and the access
boundary has moved deliberately: it is the **installation**, not the clinician.
One deployment serves one clinic, and staff at a clinic share a caseload — a
nurse who cannot see the patient in front of her because a colleague registered
them is a system nobody will use.

`patients.forClinic()` is what every route and agent now reads.
`patients.forClinician()` remains for attribution: which clinician added a
patient, and which one an assessment ran for. The DI-4 test still passes
unchanged, because that function is unchanged — but it no longer describes the
access boundary, and saying so here is the point of this note.

What replaces DI-4's intent is unique user identification
(§164.312(a)(2)(i)): each person signs in as themselves, deactivation ends
their sessions on the next request, and every audit row names the individual
rather than a shared account. That was verified end to end — two users, one
population, and a dismissal attributed to the nurse who made it.

A deployment serving two clinics from one database is **not supported**, and
this change makes that explicit rather than implied.

**Original status:** accepted consequence of the single-clinician answer, recorded rather
than passed. Adding a second clinician with a small population would make it
verifiable.

---

## 3. Section 10 — encounter count for the long-chart patient

**The document says:** Section 10 asks for "2 to 5 prior encounters" per patient,
and separately requires a patient with a "Long chart, 5 or more encounters".

**This build does:** Rosalie Étienne has 6 encounters. Every other patient with
history has 2 to 5.

**Why:** the two requirements cannot both be met by one patient at 5. The
long-chart profile exists to give Agent 1 something to discard when selecting
relevant history (A1-2), which needs more than the minimum. Reading the 2-to-5
range as the general shape and the long-chart profile as a deliberate exception.

**Status:** no action needed; recorded for completeness.

---

## 4. CS-5 on the deterministic path

**The document says:** CS-5 expects ten flag reasonings read in sequence to be
clinical sentences, not one template with values substituted.

**This build does:** when a model is available, Agent 3 writes each sentence.
When no `ANTHROPIC_API_KEY` is set, the deterministic engine rotates between
several hand-written phrasings per finding type, selected by a hash of the
patient id.

**Why:** the rotation is genuinely varied and the test suite checks for repeated
sentence skeletons across the population, which it passes. But rotation over a
fixed set is not the same thing as writing a sentence for a particular patient,
and on a larger population the phrasings would eventually repeat.

**Status: RESOLVED on the live path.** With `claude-sonnet-5` configured, Agent 3
writes each sentence for the patient in front of it and CS-5 passes on the
substance rather than on rotation. The deterministic fallback keeps the rotation
behaviour, so this caveat still applies whenever no key is set.

---

## 5. Phase 0 gate on the deterministic path

**The document says:** the Phase 0 gate is "a test model call returns and spend
is logged".

**This build does:** the gate passes with the call served by the deterministic
engine.

**Why:** no API key is available in the build environment. The live Claude path
is written, typed, and instrumented, but has not been executed.

**Status: RESOLVED.** A key was supplied and the gate now passes on the live
path — a real Claude call returning in 3.4s with spend logged. Both paths are
verified.

---

## 6. CS-1 — clinical thresholds are now adjustable per clinic

**The document says:** Section 15 — "every threshold sourced in a reference
file." The build honoured this by making thresholds immutable at runtime: only
`docs/clinical-reference.md` could change a number.

**This build now does:** Settings exposes all 23 thresholds. A clinic can adjust
any of them, and the adjusted value is what the rules use.

**Why this does not break CS-1:** the constraint is that every threshold is
*traceable to a source*, not that it can never change. Immutability was one way
to guarantee traceability; it is not the only one, and it was the wrong one —
individualised targets are ordinary clinical practice (a tighter HbA1c goal for
a young patient without hypoglycaemia risk is in the ADA guidance itself).

Traceability is preserved by construction:

- The reference file is untouched and remains the authority. An override is a
  recorded departure from it, never a rewrite.
- Every override requires a **reason** and a **source**. The API rejects one
  without both — an adjustment with no stated basis is exactly the untraceable
  number CS-1 exists to prevent.
- `describeThresholds()` returns the published value alongside the effective
  one, and Settings shows both, struck through, side by side.
- Flags still carry `referenceIds`, so the chain from flag to published entry is
  intact whether or not the number was adjusted.
- Every change and restoration lands in the audit trail with its justification,
  who made it, and when.

**Refused adjustments.** Two classes are rejected outright rather than warned
about:

- Anything that inverts a clinical ordering — a stage 2 cut-off at or above the
  crisis threshold, an HbA1c goal at or above the poor-control mark, a
  "critical" platelet count above the "low" one, or a shorter recheck interval
  for stable patients than unstable ones. These do not make the system unusual,
  they make it incoherent: a reading could fall in two bands at once and which
  flag fires would depend on evaluation order.
- Anything ten times or more away from the published value, which is nearly
  always a misplaced decimal point and would change what the system flags for
  the whole population at once.

**Verified end to end:** with the HbA1c goal moved to 6.4%, a patient at 6.5%
who was previously unflagged was flagged on the next population run, and the
flag still cited `HBA1C-TARGET`. Restored afterwards; the demo database is back
at published values.

---

## 7. A2-1 — Agent 2 fabricated a medication discrepancy

**What happened:** on a full-suite run, A2-1 ("clean note flags nothing")
failed. Agent 2 flagged the weight field with:

> "Weight given as 81.5 kg with explicit unit, but noting medication list states
> lisinopril while note describes amlodipine — medication discrepancy, not a
> measurement issue; weight itself is unambiguous."

**Two faults in one output.** The field's value and unit were both clear, and
the model said so in the same sentence it flagged them — it used the ambiguity
slot as a general channel for a concern it had nowhere else to put. And the
concern was invented: lisinopril is not in Neville Prescod's record, not in the
note, and not in the context brief. It belongs to a different patient.

**Ruled out:** cross-patient leakage. The assembled context for Prescod was
dumped and checked — no lisinopril, no other patient's data. The brief was
correct; the model fabricated the drug name.

**Fixed by** constraining the channel rather than the test. `fieldConfidence`
now states in both the prompt and the JSON schema that an entry says one thing
only — whether that field's own value or unit is clear — that a clear field must
be marked confident even when something else about the encounter seems worth
remarking on, that clinical concerns belong to Agent 3, and that the model must
not assert the record contains something it was not shown. A2-1 then passed five
consecutive runs.

**The test was not changed.** A clean note flagging nothing is the correct
scenario, and it caught a real defect.

**Still worth knowing:** this is a live-model failure mode, not a code path. The
guard makes it much less likely; it cannot make it impossible. A clinical
deployment should treat any agent assertion about the record as checkable
against the record, and this one was not checked before being shown.

---

## 8. Section 8.6 — approval returns to the patient, not the queue

**The document says:** after a clinician approves a structured note, the
interface returns to the priority queue, "where the results land".

**This build does:** returns to the patient's record.

**Why:** the results land in both places, and the queue is the one the clinician
was not looking at. Approving a note is the end of documenting a person, and the
things produced by that approval — the flags Agent 3 raised from the note, the
gaps Agent 4 found, the new status, the note itself now in the record — are all
on the patient's chart. Sending the clinician back to a population list means
leaving the person they were mid-way through and navigating to find them again
to see what just happened.

The queue is still re-ranked and still updated in the same response, so the
population view is correct the moment it is next opened. Nothing about the
ranking behaviour changed — only where the clinician is standing when it does.

**Consequence handled:** the one message that says an agent failed used to be
written into the queue's error slot. With approval no longer ending on the
queue, that message would have been posted to a screen nobody was about to
look at, so a partial assessment is now reported on whichever screen the
clinician lands on.

**Requested by the product owner** after using the flow, which is the same
reason Section 8.6 wrote the original rule — this build just has the benefit of
having watched somebody use it.
