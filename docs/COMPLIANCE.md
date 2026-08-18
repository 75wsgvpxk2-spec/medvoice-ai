# Compliance Statement

**MedVoice AI — Future Caribbean Buildathon submission**

**Data privacy.** Clinical data stays in a SQLite database on the operator's own
infrastructure. No telemetry, no analytics; the only third parties receiving
patient data are the model provider the clinic chooses and, if enabled, the
transcription provider. Both are named on screen while in use, because where
patient text travels is a fact a clinician should see rather than infer. Data minimisation is structural: agents receive only the
encounter and the prior context Agent 1 selected, never the whole record. API keys are write-only from
the interface. A local model endpoint keeps every word inside the building.

**Regulatory alignment.** This is **not a certified medical device**. It has no
regulatory approval and no clinical validation. Under the **EU AI Act**, a system
intended to inform clinical decisions falls in the high-risk category, requiring conformity
assessment, a quality management system and post-market monitoring, none of
which has been performed. For
**GDPR** and **CCPA/CPRA** the operating clinic is controller and this software
the processor. The architecture supports lawful operation — local storage,
role-based access, a complete audit trail, per-patient export in Markdown and
FHIR R4 — but two obligations are **not** met today: there is no per-patient
erasure endpoint, and no encryption at rest. Both are documented in
[`SECURITY.md`](../SECURITY.md), which maps HIPAA §164.312 line by line including
the four safeguards not implemented.

**Bias mitigation.** The most serious known bias is in speech recognition. Every
published medical-ASR accuracy figure is measured on US-accented English;
Caribbean English and Creole are out of distribution and vendor numbers do not
transfer. This is stated in the README as a condition of real use, not buried.
Clinically, bias is constrained by design: risk decisions come from encoded
thresholds traceable to published guidance (ACC/AHA, ADA, WHO, NHLBI), not model
judgement, so the system cannot silently learn a skewed decision boundary. The
model contributes language and prioritisation, never the threshold.

**Safety.** Three decisions cannot be automated — approving a note, acting on a
risk flag, resolving a documentation gap — enforced server-side. The platform
runs on live models only: if a provider fails, work stops and says why, rather
than answering from local rules and presenting it as agent output nobody could
audit. The server refuses to boot if the code and the clinical reference file
disagree. Ambiguity is flagged, never guessed — a value with no unit is not
recorded. Every AI output names the agent behind it; a usage panel shows
model, endpoint and spend. Automations are off by default, individually
toggleable — the kill switch — and refuse to run past a budget reserve.

**Risk management.** Limitations are published, not managed privately:
[`DEVIATIONS.md`](DEVIATIONS.md) records every departure from specification,
including unresolved questions. Agent output is not verified against the record
and may assert something untrue; treat it as a prompt to look, not a finding.
Before real patient use: a clinician must review the reference file, a BAA must
cover transcription, and speech recognition must be benchmarked on the clinic's
own speakers.
