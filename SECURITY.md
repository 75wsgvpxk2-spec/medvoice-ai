# Security

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use
GitHub's **Report a vulnerability** button on the Security tab, or email the
maintainer listed in `package.json`.

Include what you found, how to reproduce it, and what an attacker could reach.
You will get an acknowledgement within a few days.

Because this software can hold patient data, please treat anything that exposes
records, bypasses the clinician scoping, or leaks a stored API key as a
vulnerability rather than a bug — even if it looks minor.

## What this project does with secrets

- **API keys are never sent to the browser.** Model and transcription keys are
  stored server-side. The Settings screen shows only the last four characters,
  and a stored key cannot be read back through any endpoint.
- **Speech transcription uses a single-use token** that expires in two minutes,
  so the AssemblyAI key never reaches the client.
- **`.env` and `data/*.db` are gitignored.** Check before you commit anyway.
- **Session cookies are `httpOnly`** and signed with `SESSION_SECRET`. Set that
  to a long random value in any deployment — the default is a per-boot random
  string, which signs everyone out on restart.

## Known limitations

These are design limits of the current build, not vulnerabilities. They are
listed here so nobody has to discover them the hard way.

- **Sessions are held in memory.** A restart signs everyone out. There is no
  session revocation beyond restarting the process.
- **One clinician account per installation.** There is no role model, no
  per-user permissions, and no account lockout after failed sign-ins.
- **No encryption at rest.** The SQLite database is a plain file. If it holds
  patient data, the disk it sits on needs encrypting and backing up
  accordingly.
- **No rate limiting** on the API, including the sign-in endpoint.
- **No HTTPS in the default configuration.** Terminate TLS in front of it; see
  `docs/DEPLOYMENT.md`.
- **Audit events are append-only in application code**, not enforced by the
  database. Anyone with file access to the SQLite database can alter history.

If you are deploying this where real patient data will be entered, treat the
list above as a work plan rather than a disclaimer.

## Supported versions

This is a young project without a release history. Fixes land on the default
branch. There is no long-term support commitment.
