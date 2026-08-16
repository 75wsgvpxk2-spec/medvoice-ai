## What this changes

<!-- One or two sentences. What is different after this lands? -->

## Why

<!-- The problem, not the solution. If it fixes an issue, link it. -->

## Checks

- [ ] `npm test` passes (no API key needed)
- [ ] `npx tsc --noEmit` is clean
- [ ] If this touches a prompt, schema or agent: `npm run test:live` passes too

## If this touches clinical logic

- [ ] Any new threshold is in `docs/clinical-reference.md` with a published source
- [ ] Flags using it carry the reference ID
- [ ] No test was relaxed to make new behaviour pass — if a scenario looks wrong,
      say so here and argue it

## If this changes patient data handling

- [ ] No real patient data added anywhere, including tests and fixtures
- [ ] No patient identifiers written to logs
