# MedVoice AI — Project Overview

**Clinical decision support for small primary-care clinics, built for the
Caribbean and designed to be re-pointed at any guideline set.**

Repository: https://github.com/75wsgvpxk2-spec/medvoice-ai · Licence: Apache-2.0

---

## The problem

A primary-care doctor in a small Caribbean clinic carries a caseload, not a
queue. The chronic disease burden across the region is dominated by diabetes and
hypertension, layered on top of endemic dengue and, in Afro-Caribbean
populations, sickle cell disease. Clinicians are scarce and getting scarcer as
trained staff emigrate.

The working reality that follows is this: **the patient in front of you gets
attention, and the patient who did not come in gets none.** A diabetic whose
kidney function has been quietly declining for eighteen months, an overdue
HbA1c, a hypertensive who stopped collecting their prescription in March — none
of these announce themselves. They are visible only if somebody reads the whole
caseload, and nobody has time to read the whole caseload.

Electronic records make this worse rather than better. They are built to store a
visit, so they answer "what happened at this appointment" and stay silent on
"who in my population is deteriorating".

## The solution

Four named agents read the entire caseload rather than one visit at a time:

| Agent | Does |
|---|---|
| **1 · Intake and Context** | Selects which prior encounters matter for this note, and says why |
| **2 · Record Structuring** | Turns a dictated note into subjective / objective / assessment / plan, flagging anything ambiguous rather than guessing |
| **3 · Clinical Intelligence** | Assesses risk against published thresholds and ranks the queue |
| **4 · Documentation and Compliance** | Finds gaps — missing results, codes, diagnoses |

Encounters are voice-first: the clinician speaks, the note structures itself, and
the caseload re-ranks on approval.

**The design decision that matters: rules decide what is clinically significant;
agents decide how to say it.** Thresholds are encoded and testable. The model's
job is judgement and language, not arithmetic — so a wrong model answer degrades
the wording, not the safety.

Three decisions belong to the clinician and cannot be automated: approving a
note, acting on a flag, resolving a documentation gap. This is enforced on the
server, not merely hidden in the interface.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the diagrams.

## What makes it defensible

**Clinical logic is data, not code.** Every threshold lives in
[`clinical-reference.md`](clinical-reference.md) with the published guidance it
came from. The file is parsed at startup, each number in the code binds to an
entry ID, and the server refuses to boot if the two disagree. Every flag carries
the IDs it used, so a clinician can trace any flag back to the guideline behind
it.

That is what makes "your own version" real rather than aspirational. A clinic in
another region forks the reference file — different guidelines, different disease
mix, same engine. Guidelines change; software that makes changing them a code
review is software that will be running last decade's guidance.

**Provider independence.** Anthropic, Google Gemini, OpenAI, or anything speaking
the OpenAI chat-completions protocol, including a local endpoint that answers the
data-residency question outright. Chosen from a dropdown, not a fork.

## Business model

The code is Apache-2.0 and stays that way. Revenue comes from the things a clinic
cannot fork:

1. **Managed hosting**, per clinic, per month — backups, TLS, upgrades, uptime.
   The buyer is a practice with no IT staff, which is most of the target market.
2. **Localisation and clinical review.** Forking the reference file is free;
   having it reviewed against local practice by qualified clinicians, and kept
   current as guidance changes, is a service.
3. **Regional deployments.** Health authorities and ministries buying for a
   cluster of clinics, with aggregate population reporting they cannot get today.

Self-hosting is free forever and always will be. That is the distribution
strategy, not a loss.

## Go to market

**Phase 1 — one clinic, real clinicians.** Get the reference file reviewed by a
qualified clinician, run a supervised pilot alongside existing records, and
measure one thing: gaps surfaced that the clinic would otherwise have missed.

**Phase 2 — regional cluster.** Approach a health authority with pilot evidence
rather than a prototype. The audit trail and population reporting are what an
authority buys; the clinical intelligence is what the doctor keeps using.

**Phase 3 — fork and localise.** Open source is the growth channel. Other
regions adopt the engine and supply their own guidelines; the reference-file
review becomes the product.

## Honest status

Built during the 21-day sprint. Working end to end on fictional data: 146
behavioural tests, voice dictation verified on real hardware, four agents against
live models.

Not yet done, and stated plainly because it matters: **no clinical validation, no
regulatory approval, and no clinician has reviewed the reference file.** Every
threshold in the system was assembled by an engineer from published guidance.
Nothing here should inform a real clinical decision until that review happens.
[`DEVIATIONS.md`](DEVIATIONS.md) records every place the build departed from its
specification and why.
