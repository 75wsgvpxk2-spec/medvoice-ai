# Demo script — the encounter system

A seven-minute run through the thing MedVoice is actually for: a doctor talks,
and a structured, checked, clinician-approved note comes out the other end.

Everything below is written against the seeded demo population, so the values
are the ones that will genuinely appear on screen. Nothing here needs an API
key — with no provider configured the deterministic engine answers, which is
enough for every beat except the two marked **needs a live model**.

---

## Before you start

```bash
npm run seed        # 15 fictional patients, ~47 encounters
npm run dev
```

Sign in as `a.thomas@clinic.example`. Then:

1. **Run the assessment once** from the priority queue and let it finish. The
   demo is much stronger when the queue already has a shape.
2. Open **Settings** and confirm the provider. If you are demoing on the
   deterministic engine, say so once, early — it is a better look than being
   asked about it at the end.
3. Have this file open on a second screen. The dictation text is the part you
   cannot improvise.

**Reset between runs:** `npm run db:reset && npm run seed`. Approving an
encounter is permanent, and the second run of a demo is always the one people
watch closely.

---

## The patient

**Delores Quashie, 63.** Type 2 diabetes for about nine years, chronic kidney
disease for fourteen months. Metformin 500 mg twice daily, ramipril 5 mg daily.
No allergies.

Her four previous encounters are the whole reason to demo her:

| Days ago | eGFR | HbA1c | Urine ACR | BP |
| --- | --- | --- | --- | --- |
| 420 | 58 | 7.6% | 42 | — |
| 296 | 57 | 7.4% | 38 | — |
| 175 | 55 | 7.5% | 40 | 136/84 |
| 71 | 53 | 7.7% | 44 | 138/86 |

Nothing in any single visit is alarming. The *slope* is the finding, and no
single visit contains it. That is the sentence the demo exists to prove.

---

## Beat 1 — Open her record (45 seconds)

**Do:** Priority queue → **Delores Quashie**. Scroll the encounter history.

**Say:**

> Four visits over about fourteen months. Every one of them was a reasonable
> consultation. Her kidney function has gone 58, 57, 55, 53 — and the doctor
> who sees her today is looking at a chart, not a trend line.

Do not linger. This beat exists so the next one lands.

---

## Beat 2 — Dictate the encounter (90 seconds)

**Do:** **New encounter** → **Start dictation** → read the script below at
normal consulting pace. If the room is loud, type it instead; the note is the
same either way, and the screen says so.

> **Dictation — read aloud:**
>
> Delores attends for her three month diabetes and kidney review. She feels
> well. No swelling, no change in urine output, no shortness of breath. She is
> taking the metformin and the ramipril every day without side effects.
>
> Blood pressure today is 142 over 88. Bloods from Tuesday show eGFR 49, down
> from 53 three months ago. Urine ACR 52. HbA1c 8.1 percent.
>
> Kidney function is continuing to decline and her diabetes is above goal. I
> have discussed a renal referral with her today and she agrees. Continue
> metformin and ramipril at current doses. Repeat bloods in three months.

**Why these numbers.** Every one crosses a line the clinic has actually
configured, so the flags that follow are real rather than staged:

- **eGFR 49** — under the reduced-eGFR threshold of 60 (`EGFR-REDUCED`), and a
  four-point fall on an already declining slope.
- **HbA1c 8.1%** — above the 7.0% goal (`HBA1C-TARGET`), and her highest yet.
- **Urine ACR 52** — above the raised-ACR threshold of 30 (`ACR-ABNORMAL`).
- **142/88** — crosses into stage 2 systolic (`BP-STAGE2`, 140).

**Say while it transcribes:**

> This is the whole input. No form, no dropdowns, no coding. What the doctor
> would have said anyway.

Then press **Submit note**.

---

## Beat 3 — The agents work, and say what they did (45 seconds)

Two named agents run in front of the audience. Do not talk over this screen —
let them read it.

**Intake and Context** reads the record and decides which previous encounters
matter. **Record Structuring** turns the note into subjective, objective,
assessment and plan.

**Say, once the context line appears:**

> That first line is the part I would ask you to notice. It is not "loading" —
> it is the agent telling you which of her previous visits it chose to read,
> and why. If it picked wrong, you can see that it picked wrong.

---

## Beat 4 — The review screen (2 minutes) — **the centre of the demo**

You are now on the screen the whole product is built around. Work through it in
this order:

**a. The context it assembled.** Top card. Read the selection reasoning aloud.
It names how many of her previous encounters it selected out of how many it
considered.

**b. The four sections.** Subjective, objective, assessment, plan — each
editable. Change one word in the assessment while you talk, to show they are
live text fields and not a rendered report.

**c. Observations extracted.** The table underneath. eGFR, HbA1c, ACR and blood
pressure, pulled out as structured values with units.

**Say:**

> These are now data, not prose. That is what makes the next visit's trend
> possible.

**d. The original note.** Open **Original note as entered**.

**Say:**

> The raw note is kept, byte for byte, forever. Whatever the agents produced,
> what the doctor actually said is still on the record.

**e. Approve and save.**

**Say, with your hand on the button and not before:**

> Nothing has been saved yet. No flag has been raised, no order placed, nothing
> billed. The agents produced a proposal, and a human being is about to decide.
> That is the boundary, and it is not configurable.

Click **Approve and save**.

---

## Beat 5 — What approval set off (60 seconds)

You land back on her record. Two more agents have run against the approved
encounter:

- **Clinical Intelligence** assesses risk and raises flags — each with its
  reasoning, its recommended action, and the reference id of the threshold it
  measured against.
- **Documentation and Compliance** checks the record for gaps, independently of
  Agent 3 and in parallel with it.

**Do:** Open a flag and read its reasoning and reference id aloud.

**Say:**

> Every flag names the guideline it came from. Not "the AI thinks" — this
> threshold, this published value, her value, and the identifier you can look
> up. And her status on the queue has changed, so the ranking the whole clinic
> works from has moved because of this consultation.

**Do:** Go back to the priority queue and show her new position.

---

## Beat 6 — The refusal (60 seconds) — **the beat that wins the room**

Start a second encounter on any patient and dictate this instead:

> **Dictation — read aloud:**
>
> Routine review, she feels well. Weight 78 today. Blood pressure 128 over 76.

Submit it, and go to the review screen.

**What happens:** the weight field comes back **flagged**, not guessed. The
system says the note gives 78 with no unit, that weight is written in both
kilograms and pounds, and that it has not been assumed. 78 kg and 78 lb are
different patients.

**Say:**

> This is the demo I would ask you to remember. It could have picked kilograms —
> it is a clinic in the Caribbean, it would have been right nearly every time.
> It refused. An AI that is confidently wrong once a month in a medical record
> is worse than one that admits what it does not know.

Note the blood pressure was **not** flagged: 128/76 is unambiguous, and
flagging a value whose unit is never in doubt would be its own kind of failure.

Then click **I have resolved this**, and point out that the clinician resolving
an ambiguity is itself a recorded decision.

**Variant, if you have time:** dictate two different readings of the same
measure — "blood pressure 128 over 76 ... on repeat 138 over 84" — and the
system surfaces **both**, choosing neither.

---

## Beat 7 — Close (30 seconds)

**Say:**

> Four agents, each named on screen, each one showing its reasoning and what it
> measured against. The doctor talked for ninety seconds. What came out was a
> structured note, four extracted values, a risk flag traced to a guideline, a
> documentation check, and an audit entry — and a human approved every word of
> it before any of that existed.

Open the **Audit trail** for one last line:

> Every one of those steps is here, with who did it and when.

---

## If something goes wrong

| What you see | What to say | What to do |
| --- | --- | --- |
| An agent reports a failure | "That is the system reporting a failure rather than hiding one — the other agent's results are still on the record." | Carry on. This is a feature; the failure is visible by design. |
| Dictation does not start | "Browser speech recognition, which needs a permission." | Type the note. The screen already says both go to the same place. |
| Review screen is slow | Nothing — pause. | The agents have a ten second budget; let it land. |
| Nothing is flagged in Beat 6 | — | You said "78 kilos". Say the bare number. |

**Needs a live model:** the quality of the SOAP prose in Beat 4 and the wording
of the ambiguity note in Beat 6. The thresholds, the flags, the extraction and
the refusal-to-guess are all deterministic and demo identically without a key.

---

## Timing

| Beat | Minutes |
| --- | --- |
| 1. Her record | 0:45 |
| 2. Dictation | 1:30 |
| 3. Agents working | 0:45 |
| 4. Review | 2:00 |
| 5. After approval | 1:00 |
| 6. The refusal | 1:00 |
| 7. Close | 0:30 |
| **Total** | **7:30** |

Cut beat 1 and beat 5 first if you are given five minutes. Never cut beat 6.
