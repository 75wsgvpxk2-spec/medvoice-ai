# Changelog

Notable changes. Dates are the day the work landed on `main`.

## Unreleased

### Added
- **Documentation gaps can be closed by hand.** A gap can be true and still not
  be the system's to action — the test was done at another clinic, the order
  went in on paper, the patient declined it. Alongside the automatic resolution
  there are now two manual routes: *I have done this* and *Not applicable*, the
  second requiring a stated reason. Neither creates an order or a billing entry,
  because the automatic route's guarantee is that the record reflects real
  clinical action. How each gap was closed, and the clinician's own words, stay
  on the record and in the audit trail.
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
- Approving a note returns to the patient's record rather than the priority
  queue. The results land on both, and the record is the one the clinician was
  already looking at. See `docs/DEVIATIONS.md` item 8.
- Settings no longer asks when to use the model. The chosen provider is used
  whenever it can be and the local engine catches whatever falls through, so the
  screen reports which engine resulted instead of asking a clinic to configure
  it. An installation that had pinned the old local-only mode is read as
  automatic rather than left with no control to change it.
- Searching the run log and the audit trail matches every column those screens
  display, so text a clinician can read on screen is text they can search for.

### Fixed
- **A dictated encounter recorded no measurements at all.** Observations were
  extracted by regex from the raw note, and the patterns match digits — but
  speech produces words. In a voice-first product that meant no reading from a
  dictated note ever reached the record, so the rules engine had nothing to
  evaluate, raised no flags, and a patient nobody had a single measurement for
  was indistinguishable from a patient who is well. Spoken numbers are now
  normalised before extraction, including the shorthand clinicians actually use
  ("one sixty four over ninety eight" → 164/98), and observations are read from
  the approved objective section rather than the raw note — which also means a
  correction made on the review screen now reaches the record, where before the
  uncorrected value did.
- **A patient with no measurements could be marked `managed`.** Section 4 says
  managed means a risk was identified and a clinician acted on it. "No active
  flags" was treated as enough, but that has two causes: the assessment looked
  and found nothing, or it had nothing to look at. Only the first earns the
  status now.
- **Agents finished too fast to see.** A population assessment served from the
  cache completes in about fifty milliseconds, so the started and finished
  events landed in the same frame: the activity strip showed idle, then idle
  again, and work that had been done was indistinguishable from work that had
  not. A lane now stays visibly working for a moment before settling. Failures
  are never held back.
- The two agent cards on the encounter screen rendered as tall empty boxes.
  They reused the activity strip's `.lane`, whose `flex: 1 1 220px` sizes a
  *width* in the strip's horizontal row but a *height* inside the encounter
  screen's vertical stack — 220px each, with one line of text at the top.
- Resolving a documentation gap could do nothing at all. The button's click
  handler was an async arrow with nothing catching it, so any failed request —
  an expired session most often — left it looking untouched: no dialog, no
  error, no clue whether it had worked.
- Agent 2 could report a fabricated medication discrepancy by misusing the
  field-confidence channel. Constrained in the prompt and schema.
- A trained pronunciation whose heard text was numeric could rewrite a
  measurement in a note.
- Sign-out only cleared the browser's cookie; the token stayed valid. Tokens now
  carry a version that sign-out increments.
- **AssemblyAI dictation died seconds after it started**, with "Transcription
  disconnected (3007)". The audio worklet sent one render quantum per message —
  128 frames, 8 ms at 16 kHz — and the API rejects any chunk under 50 ms. Audio
  is now buffered to 100 ms chunks, computed from the rate the audio thread is
  really running at rather than the one requested. Close codes are also reported
  in plain language instead of as a bare number.
- **An expired session left the application unusable.** The shell decided once,
  at load, whether anybody was signed in, so a session that ended later — expiry,
  idle timeout, sign-out in another tab, a changed signing key — left every
  screen showing "Your session has ended" beside a Try again button that could
  only produce the same 401. A 401 on any working call now returns the clinician
  to the sign-in screen with the reason shown. The sign-in calls are exempt, so a
  first visit is not told a session it never had has ended.
- Searching the flag board and the run log only looked at the rows already
  fetched, so a search from page one could not find anything on page three. All
  four paged screens — patients, flags, the run log and the audit trail — now
  filter and sort the whole set on the server before taking a page from it.
- Asking for a page past the end of the run log or the audit trail reported the
  last page while the query looked beyond it, so the pager read "page 4 of 4"
  above an empty list. The page is now clamped against the count before it
  reaches the query.
