# Architecture

Three diagrams. The first is the shape of the system, the second is what happens
during an encounter, and the third is the idea the whole thing rests on: clinical
logic is data, not code.

---

## 1. The system

```mermaid
graph TB
    subgraph client["Browser"]
        UI["React 19 · hand-written CSS<br/>queue · patient · encounter · flags · audit"]
        DICT["Dictation<br/>browser speech or AssemblyAI streaming"]
    end

    subgraph server["Node 24 · Express 5"]
        API["REST API<br/>session auth · rate limits · admin guards"]
        SSE["Server-sent events<br/>live agent activity"]
        ORCH["Orchestration<br/>submit · approve · population run"]
        AUTO["Automations<br/>4 scheduled flows, off by default"]

        subgraph agents["The four agents"]
            A1["1 · Intake and Context"]
            A2["2 · Record Structuring"]
            A3["3 · Clinical Intelligence"]
            A4["4 · Documentation and Compliance"]
        end

        RULES["Encoded rules engine<br/>thresholds bound to reference IDs"]
        PROV["Model provider layer<br/>Anthropic SDK · any OpenAI-compatible endpoint"]
        AUDIT["Audit trail<br/>hash-chained, tamper-evident"]
    end

    REF[["docs/clinical-reference.md<br/>parsed at boot · boot fails on drift"]]
    DB[("SQLite<br/>patients · encounters · observations<br/>flags · alerts · runs · audit")]
    MODEL{{"Configured provider<br/>Anthropic · Gemini · OpenAI · local"}}
    ASR{{"AssemblyAI<br/>streaming transcription"}}

    UI --> API
    DICT -. "audio never passes through this server" .-> ASR
    API --> ORCH
    ORCH --> A1 --> A2
    ORCH --> A3
    ORCH --> A4
    AUTO --> ORCH
    A1 & A2 & A3 & A4 --> PROV
    PROV --> MODEL
    A3 --> RULES
    RULES --> REF
    ORCH --> DB
    RULES --> DB
    API --> AUDIT --> DB
    ORCH --> SSE --> UI

    classDef gate fill:#fde68a,stroke:#b45309,color:#1f2937
    classDef source fill:#dbeafe,stroke:#1d4ed8,color:#1f2937
    class REF source
```

**Rules decide what is clinically significant; agents decide how to say it.** The
thresholds are encoded and testable. The model's job is judgement and language,
not arithmetic — which is why a wrong model answer degrades the wording rather
than the safety.

**No local engine stands behind the model.** If the provider is unreachable, out
of credit, or rejecting the key, the work stops and says so. Answering anyway
from encoded rules would put clinical text on screen attributed to an agent that
never ran, and a clinician has no way to audit reasoning that did not happen.

---

## 2. An encounter, end to end

The three amber gates are decisions that belong to the clinician. They are
enforced on the server, not just hidden in the interface.

```mermaid
sequenceDiagram
    autonumber
    actor C as Clinician
    participant UI as Browser
    participant S as Server
    participant A1 as Agent 1<br/>Intake
    participant A2 as Agent 2<br/>Structuring
    participant A3 as Agent 3<br/>Clinical
    participant A4 as Agent 4<br/>Documentation
    participant DB as Record

    C->>UI: dictates or types the note
    UI->>S: submit
    S->>DB: raw note saved first<br/>(survives any later failure)
    S->>A1: which prior encounters matter?
    A1-->>S: selection, with reasons
    S->>A2: structure into S/O/A/P
    A2-->>S: sections + anything ambiguous flagged
    S-->>UI: draft for review

    rect rgb(253, 230, 138)
        C->>UI: ① reviews, resolves flags, APPROVES
    end

    UI->>S: approve
    S->>DB: observations recorded<br/>(from the approved objective)
    par run together
        S->>A3: assess risk against the thresholds
        A3-->>S: flags, each citing its reference IDs
    and
        S->>A4: find documentation gaps
        A4-->>S: alerts, each with a resolution
    end
    S->>DB: queue re-ranked
    S-->>UI: back to the patient, results visible

    rect rgb(253, 230, 138)
        C->>UI: ② acts on a flag — or dismisses it with a reason
    end
    rect rgb(253, 230, 138)
        C->>UI: ③ resolves a gap: system acts · already done · not applicable
    end
```

Agents 3 and 4 genuinely run in parallel. Millisecond timestamps cannot prove
that, so each run records how many agents were already in flight when it began
(`concurrency_at_start`), and the run log shows it.

---

## 3. Clinical logic is data

Every threshold lives in a markdown file with the published guidance it came
from. The file is parsed at startup; each number in the code binds to an entry
ID; boot fails if the two ever disagree.

```mermaid
graph LR
    SRC["ACC/AHA · ADA · WHO · NHLBI<br/>published guidance"]
    --> MD[["docs/clinical-reference.md<br/>| BP-CRISIS | >180 or >120 mmHg |"]]
    MD -->|parsed at boot| TH["TH.bpCrisisSystolic<br/>value + referenceId"]
    TH --> RULES["rules engine"]
    RULES --> FLAG["Risk flag<br/>carries BP-CRISIS"]
    FLAG --> DOC["Clinician traces the flag<br/>back to the guideline"]
    MD -.->|"verifyReference() —<br/>boot fails on drift"| BOOT{{"server start"}}

    OVR["Clinic override<br/>reason + source required<br/>orderings refused"] --> TH
```

This is what makes "your own version" real rather than aspirational: a clinic in
another region forks the reference file — different guidelines, different disease
mix, same engine.

---

## Stack

TypeScript, Node 24, Express 5, SQLite (`better-sqlite3`), React 19, Vite,
Vitest. No ORM, no component library, no state manager — see
[`STACK.md`](STACK.md) for why each was chosen.

The scenario suite runs the agents against encoded stand-ins, so 146 clinical
tests need no API key, no network and no bill. That path is reachable only via
`MODEL_TEST_DOUBLE`, which `npm test` sets and the server refuses to start with
in production.
