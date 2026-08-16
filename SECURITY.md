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
  to a long random value in any deployment: if it is unset the server generates
  one per boot, which signs everyone out on restart.
- **Tokens carry an issue time and a version.** They expire after a configurable
  lifetime, and signing out increments the clinician's token version, which
  invalidates every token already issued — including any captured from a shared
  machine. Changing `SESSION_SECRET` invalidates all of them at once.

## HIPAA technical safeguards

**This software is not "HIPAA compliant", and neither is any other software.**
Compliance is organisational: a risk analysis, workforce training, policies, and
a signed business associate agreement with every vendor that touches PHI —
including whoever transcribes your audio and whoever serves your model. What
software can do is implement the technical safeguards of the Security Rule and
stay out of the way of the rest.

Here is exactly where this build stands against 45 CFR §164.312.

| Safeguard | | Status |
|---|---|---|
| §164.312(a)(2)(i) Unique user identification | required | **Implemented.** Every person signs in as themselves; accounts are deactivated rather than deleted so history keeps resolving to a name. |
| §164.312(a)(2)(ii) Emergency access | required | **Not implemented.** There is no break-glass path. An administrator can reset a password. |
| §164.312(a)(2)(iii) Automatic logoff | addressable | **Implemented.** Idle timeout, default 15 minutes, configurable. |
| §164.312(a)(2)(iv) Encryption at rest | addressable | **Not implemented.** The database is a plain SQLite file. Use full-disk encryption. |
| §164.312(b) Audit controls | required | **Implemented.** Every change, plus failed sign-ins and record exports. |
| §164.312(c)(1) Integrity | required | **Partial.** Entries are hash-chained, so alteration is detectable. It is not prevented — anyone with the database file can rewrite the chain. |
| §164.312(d) Person or entity authentication | required | **Partial.** Password with lockout by rate limit. No MFA. |
| §164.312(e)(1) Transmission security | required | **Deployment's responsibility.** No TLS in the application; terminate it in a reverse proxy. See `docs/DEPLOYMENT.md`. |

And the one that is not in §164.312 but decides everything else: **§164.308(b)
business associate contracts.** If you send audio to a transcription vendor or
text to a model provider, you need a BAA with them. Selecting them in a dropdown
is not a contract.

## Known limitations

These are design limits of the current build, not vulnerabilities. They are
listed here so nobody has to discover them the hard way.

- **One session lifetime for everyone**, set in Settings and defaulting to 12
  hours. There is no idle timeout — a session lasts its full length whether or
  not it is used.
- **No MFA.** A password is the only factor.
- **No emergency access procedure.** There is no break-glass route into a
  record if the administrator is unavailable.
- **Roles are coarse.** Administrator or clinician; there is no per-record or
  per-function permission model.
- **No encryption at rest.** The SQLite database is a plain file. If it holds
  patient data, the disk it sits on needs encrypting and backing up
  accordingly.
- **Rate limiting is per IP.** On a clinic LAN behind one router, the whole
  practice shares a budget.
- **No HTTPS in the default configuration.** Terminate TLS in front of it; see
  `docs/DEPLOYMENT.md`.
- **Audit integrity is detective, not preventive.** The hash chain reveals
  tampering; it cannot stop somebody with file access from rewriting every hash.
  Preventing that needs an append-only store outside this system.

If you are deploying this where real patient data will be entered, treat the
list above as a work plan rather than a disclaimer.

## Supported versions

This is a young project without a release history. Fixes land on the default
branch. There is no long-term support commitment.
