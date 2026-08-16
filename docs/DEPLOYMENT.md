# Deployment

Running this somewhere real, for a single clinic. The target is a small VPS or
an on-premises machine in the practice — not a multi-tenant service, which this
build does not support.

Read [Before you use this on real patients](../README.md#before-you-use-this-on-real-patients)
first. This document covers how to run it, not whether you should.

---

## With Docker

```bash
git clone <your fork>
cd medvoice
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
SESSION_SECRET=<a long random string>
```

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
docker compose run --rm app npx tsx scripts/setup.ts   # your clinic, your sign-in
docker compose up -d
```

`setup` prints a generated password once. Write it down before you close the
terminal — it is stored only as a salted hash.

The database lives in the `clinic-data` volume, so it survives `docker compose
build` and image upgrades.

### Trying it first

To run the fictional demo population instead:

```bash
docker compose run --rm app npx tsx scripts/seed.ts
docker compose up -d
```

Every screen is labelled as demo data. Moving from demo to a real clinic means
wiping the volume — the two cannot share a database, by design.

---

## Without Docker

Node 24 or newer.

```bash
npm ci
npm run build          # builds the client into client/dist
npm run setup          # or npm run seed:demo
NODE_ENV=production npm start
```

The server serves the built client itself in production, so only one port is
exposed.

Run it under a supervisor that restarts on failure — systemd, or `pm2`. Sessions
are held in memory, so every restart signs everyone out; that is a known
limitation rather than a misconfiguration.

---

## HTTPS

**Do not expose this directly.** There is no TLS in the application and no rate
limiting on the sign-in endpoint. Put a reverse proxy in front of it.

Caddy is the shortest path — it obtains and renews certificates on its own:

```caddyfile
clinic.example.com {
    reverse_proxy localhost:5174
}
```

With nginx, terminate TLS and proxy to `localhost:5174`, forwarding
`X-Forwarded-Proto` so the session cookie is treated as secure.

---

## Backups

The entire record system is one SQLite file. That is a genuine operational
advantage — and it means losing that file loses everything.

SQLite runs in WAL mode here, so copying the file while the server is running
can produce an inconsistent snapshot. Use SQLite's own backup command, which is
safe against a live database:

```bash
docker compose exec app \
  npx tsx -e "import Database from 'better-sqlite3'; \
    await new Database(process.env.DB_PATH).backup('/app/data/backup-'+new Date().toISOString().slice(0,10)+'.db')"
```

Or, without Docker:

```bash
sqlite3 data/clinic.db ".backup 'backups/clinic-$(date +%F).db'"
```

Then copy the backup off the machine. A backup on the same disk is not a backup.

**Encrypt the disk.** The database is a plain file with no encryption at rest.
If it holds patient records, full-disk encryption is the minimum, and your
backup destination needs the same treatment.

**Test a restore.** Copy a backup to a scratch machine, point `DB_PATH` at it,
and sign in. A backup nobody has restored is a hypothesis.

---

## Configuration

Everything in `.env` is read once at boot. Anything that a clinic should be able
to change while running lives in **Settings** instead, stored in the database:

| In `.env` | In Settings |
|---|---|
| `API_PORT`, `DB_PATH` | Model provider and model |
| `SESSION_SECRET` | API keys (model and transcription) |
| `ANTHROPIC_API_KEY` (fallback) | Units, dictation keywords |
| | Clinical threshold adjustments |
| | Review interval |

A key entered in Settings overrides the environment variable. The Settings
screen says which one is in force.

---

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Schema changes are applied automatically at startup: the schema file is
idempotent, and added columns are applied by a migration step in
`server/src/db/index.ts` that is safe to re-run.

**Take a backup before upgrading anyway.** There is no downgrade path.

---

## Monitoring

`GET /api/health` needs no authentication and returns:

```json
{ "status": "ok", "reference": { "ok": true, "checked": 23 } }
```

It returns `503` if the clinical reference file fails verification — meaning the
thresholds in the code and the thresholds in `docs/clinical-reference.md` have
drifted apart. Treat that as a hard failure rather than a warning: the numbers
the system is flagging on can no longer be traced to their source.

Agent runs, model spend and every recorded change are visible in the interface
under **Agent activity** and **Audit trail**.

---

## What this build does not do

Worth knowing before you commit to it:

- **One clinician account.** No roles, no second user, no password reset flow.
- **No multi-tenancy.** One clinic per installation.
- **No encryption at rest** and no audit-log tamper protection beyond file
  permissions.
- **No rate limiting**, including on sign-in.
- **Sessions do not survive a restart.**

Each of these is a contribution waiting to happen; see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
