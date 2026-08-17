# Changelog

Notable changes. Dates are the day the work landed on `main`.

## Unreleased

### Added
- **Any model provider.** Anthropic, Google Gemini, OpenAI, or any
  OpenAI-compatible endpoint — Groq, Together, OpenRouter, LiteLLM, local
  Ollama — chosen from presets in Settings. Gemini's free tier means a clinic
  with no budget can run the whole system.
- Free-text notes on flag dismissal, and an "another reason" option that
  requires one.
- **Agent automations.** Four toggleable flows that run without a human click:
  overnight population sweep, assess-on-arrival for new patients, weekly
  documentation scan, and a daily recheck of overdue patients. Off by default,
  admin-only, recorded against the system in the audit trail. None cross a
  clinician decision point, and one that would breach the budget reserve refuses
  to run.
- Staff accounts with roles, temporary passwords and deactivation, so every
  audit entry names an individual (HIPAA §164.312(a)(2)(i)).
- Automatic logoff after inactivity, configurable (§164.312(a)(2)(iii)).
- Tamper-evident audit trail: entries are hash-chained and a break is reported
  on screen (§164.312(c)(1)).
- Security headers, two-tier rate limiting, and an error handler that never
  returns a stack trace.
- Patient summaries as markdown or a FHIR R4 bundle, printable to PDF.
- AI usage transparency: which model, which endpoint, and how much of the output
  came from the model rather than cache or the local engine.
- Clinic branding — logo, two brand colours, primary doctor.
- Browser sign-up that starts in the demo population, with a one-way switch to
  real records that deletes the fictional patients.
- Clinical thresholds adjustable per clinic, each adjustment requiring a reason
  and a source.
- AssemblyAI streaming transcription as an alternative to browser speech.
- Docker image and compose file.

### Changed
- **`npm test` no longer needs an API key.** The suite runs on the deterministic
  engine in seconds; `npm run test:live` exercises the model.
- The access boundary is the installation rather than the clinician — staff at
  one clinic share a caseload. See `docs/DEVIATIONS.md` item 2.
- Model calls fall back to the local engine when the API is unreachable, out of
  credit or rejecting the key, instead of failing the request.

### Fixed
- Agent 2 could report a fabricated medication discrepancy by misusing the
  field-confidence channel. Constrained in the prompt and schema.
- A trained pronunciation whose heard text was numeric could rewrite a
  measurement in a note.
- Sign-out only cleared the browser's cookie; the token stayed valid. Tokens now
  carry a version that sign-out increments.
