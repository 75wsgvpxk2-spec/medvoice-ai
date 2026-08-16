# MedVoice AI — Clinical Intelligence Platform

Open-source clinical decision support for small primary-care clinics. Four named
agents read the whole caseload, not one visit at a time: they assemble context,
structure a dictated note, assess risk, and check documentation — and every
result says which agent produced it and why.

Built for Caribbean primary care, designed to be re-pointed at any guideline set.

> **Not a medical device.** This software is not certified or approved by any
> regulator, has undergone no clinical validation, and ships with no business
> associate agreement. It supports clinical decisions; it does not make them.
> Nothing is ordered, prescribed or diagnosed without a clinician's approval.
> See [Before you use this on real patients](#before-you-use-this-on-real-patients).

---

## The idea worth stealing: clinical logic is data, not code

Most clinical tools bury their thresholds in source. Here, every threshold lives
in [`docs/clinical-reference.md`](docs/clinical-reference.md) with the published
guidance it came from:

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `BP-CRISIS` | Hypertensive crisis | >180 or >120 mmHg | Needs same-day attention |
| `HBA1C-TARGET` | Glycaemic goal | 7.0% | Above this is not at goal |

That file is **parsed at startup**. Each number in the code binds to an entry ID,
and `verifyReference()` fails the boot if the two ever drift apart. Every risk
flag the system raises carries the IDs it used, so a clinician can trace any
flag back to the guideline behind it.

This is what makes "your own version" real rather than aspirational:

- **A clinic in another region** forks the reference file. Different guidelines,
  different disease mix, same engine.
- **A clinic with individualised targets** adjusts thresholds in Settings. Each
  adjustment requires a reason and a source, shows the published value beside
  the clinic's, and is recorded in the audit trail. Adjustments that would
  invert a clinical ordering — a stage 2 cut-off above the crisis threshold —
  are refused outright.

Guidelines change. Software that makes changing them a code review is software
that will be running last decade's guidance.

---

## Getting your own instance

### Running the demo

Fifteen fictional patients, chosen to exercise the hard cases: dengue with
progression markers, sickle cell with a rising crisis pattern, diabetes with
declining kidney function, and several patients the system must **not** flag.

```bash
npm install
cp .env.example .env
npm run seed:demo
npm run dev
```

Sign in with the credentials in `.env`. Every screen is labelled as demo data.

### Setting up a real clinic

```bash
npm install
cp .env.example .env
npm run setup
npm run dev
```

`npm run setup` asks for your clinic name and creates one sign-in with a
generated password, shown once. **No patients are created.**

The two paths are mutually exclusive, deliberately. A clinic that tried the demo
and then started entering real patients would have fictional and real records
sitting in one database looking identical — so loading the demo population into
a clinic database is refused, and setting up a clinic on top of demo data is
refused. Moving from one to the other means `npm run db:reset` first.

### With Docker

```bash
cp .env.example .env
docker compose up
```

The database is a volume, so it survives rebuilds. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for HTTPS, backups and upgrades.

---

## How it works

Four agents, named in the interface wherever their output appears:

| Agent | Does | Runs |
|---|---|---|
| **1. Intake and Context** | Selects which prior encounters matter for this note, and says why | On submit |
| **2. Record Structuring** | Turns free text into subjective / objective / assessment / plan, flagging anything ambiguous rather than guessing | On submit, after Agent 1 |
| **3. Clinical Intelligence** | Assesses risk against the reference thresholds and ranks the queue | On approval, in parallel with 4 |
| **4. Documentation and Compliance** | Finds gaps — missing results, codes, diagnoses | On approval, in parallel with 3 |

Three decision points belong to the clinician and cannot be automated: approving
a structured note, acting on a risk flag, and resolving a documentation alert.

**Rules decide what is clinically significant; agents decide how to say it.**
The thresholds are encoded and testable. The model's job is judgement and
language, not arithmetic — which is why a wrong model answer degrades the
wording rather than the safety.

**No key, no problem.** Without an API key the whole system runs on a
deterministic local engine that exercises every path. It is also the fallback if
the model is unreachable.

### Stack

TypeScript, Node 24, Express 5, SQLite (`better-sqlite3`), React 19, Vite,
Vitest. Hand-written CSS. No ORM, no component library, no state manager — see
[`docs/STACK.md`](docs/STACK.md) for why each was chosen.

---

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | First-run setup for a clinic — empty database, your own sign-in |
| `npm run seed:demo` | Loads the 15-patient fictional population |
| `npm run dev` | Server and client together; sign in at http://localhost:5173 |
| `npm start` | Production server |
| `npm test` | The full scenario suite — 103 tests |
| `npm run inspect` | Population overview |
| `npm run inspect -- beaupierre` | One patient in full — history, flags, alerts, monitoring |
| `npm run spend` | Token spend against the budget |
| `npm run db:reset` | Delete the database. Stop `npm run dev` first |

---

## Testing

The suite is behavioural, not unit-level: roughly 100 scenarios drawn from the
build specification, run against the live model. Fourteen are marked
**[CRITICAL]** — the ones that fail silently if they fail at all, like an
ambiguous unit being guessed instead of flagged.

```bash
npm test
```

Two results worth knowing about, both recorded in
[`docs/DEVIATIONS.md`](docs/DEVIATIONS.md):

- A test caught the model **fabricating a medication discrepancy** on a clean
  note — naming a drug that appeared nowhere in its input. Fixed by constraining
  the channel it misused, not by changing the test.
- Parallel execution of Agents 3 and 4 is proven by recording how many runs were
  in flight when each began, because millisecond timestamps cannot show it.

---

## Before you use this on real patients

Read this section. It is short because the list is short, not because the items
are small.

1. **This is not a certified medical device.** No regulator has reviewed it. No
   clinical validation study has been run. Whether you may use it in your
   jurisdiction is a question for your own regulator and indemnity insurer.
2. **Transcription sends audio off your machine.** Browser speech recognition
   ships audio to the browser vendor with no agreement covering it. AssemblyAI
   is supported as an alternative, but selecting it in a dropdown is not a
   contract — get a BAA and retention terms in writing.
3. **Benchmark speech recognition on your own clinicians.** Every published
   medical-ASR accuracy figure is measured on US-accented speech. Caribbean
   English and Creole are out of distribution; those numbers do not transfer.
4. **Have a clinician review the reference file.** The thresholds are drawn from
   ACC/AHA, ADA, WHO and NHLBI guidance, but the selection was made by an
   engineer. Someone qualified should check it against local practice before it
   informs a decision.
5. **Agent output is not verified against the record.** The model can assert
   something about a patient's history that is not in it. Treat any agent
   statement as a prompt to look, not as a finding.
6. **Sessions are held in memory** and there is one clinician account. Both are
   fine for a single-clinician pilot and inadequate for a practice.

---

## Documentation

| | |
|---|---|
| [`docs/clinical-reference.md`](docs/clinical-reference.md) | Every threshold with its published source — the file to fork |
| [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) | Where this build departs from its specification, and why |
| [`docs/SCENARIOS.md`](docs/SCENARIOS.md) | Every test scenario with its result |
| [`docs/STACK.md`](docs/STACK.md) | Stack choices and their justifications |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Running it somewhere real |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, and the bar for clinical changes |
| [`SECURITY.md`](SECURITY.md) | Reporting a vulnerability |

`docs/DEVIATIONS.md` is worth reading even if you never run the code. It records
every place the implementation disagreed with its specification and what was
decided — including one case where the specification was followed to the letter
would have dropped a patient in hypertensive crisis out of the urgent queue.

---

## Licence

[Apache-2.0](LICENSE). Patent grant included; no warranty of any kind, which
for clinical software is a statement worth reading rather than skipping.
