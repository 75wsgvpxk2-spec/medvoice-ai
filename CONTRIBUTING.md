# Contributing

Thanks for looking. This is clinical software, so a few of the rules below are
stricter than you may be used to. They exist because the failure mode here is
not a broken build — it is a clinician trusting something wrong.

## Getting set up

```bash
npm install
cp .env.example .env
npm run seed:demo
npm test
```

**`npm test` needs no API key.** It runs the whole suite against the
deterministic engine in a few seconds. You can clone this repository, run the
tests, and change things without an Anthropic account.

```bash
npm test        # deterministic — no key, no cost, runs in CI
npm run test:live   # the same suite against the real model
```

Both must pass before a release, and the distinction matters. The clinical
assertions — thresholds, rules, ranking — are identical either way, so the
deterministic run tells you whether the logic is right. What it cannot tell you
is whether the *model* still behaves: a live run once caught the model inventing
a medication discrepancy that did not exist, and no amount of deterministic
testing would have found that.

So: run `npm test` while you work, and `npm run test:live` before you open a
pull request that touches a prompt, a schema, or an agent.

## The bar for clinical changes

**Every threshold must be in `docs/clinical-reference.md` with a published
source.** Not "a number that seems right", not "what another system uses" — a
citable guideline. The reference file is parsed at startup and the boot fails if
code and file disagree, so this is enforced rather than requested.

If you add a threshold:

1. Add the entry to `docs/clinical-reference.md` with its source.
2. Bind the constant in `server/src/clinical/reference.ts` to that entry ID.
3. Make sure any flag using it carries the ID in `referenceIds`.

**Do not change a test to match behaviour you built.** The test scenarios encode
what the system is supposed to do. If you believe a scenario is wrong, say so in
the pull request and argue it — several have been argued and changed. Silently
relaxing an assertion is the one contribution that will be rejected without
discussion.

There is precedent for this being the right call: a test caught the model
inventing a medication discrepancy that did not exist. Loosening the assertion
would have hidden a real defect.

**Agents describe; rules decide.** If you find yourself asking a model to
compute whether a value crosses a threshold, that logic belongs in
`server/src/clinical/rules.ts` instead. The model's job is judgement and
language.

## Patient data

**All patient data in this repository is fictional and must stay that way.** No
real records, no de-identified real data, no real names — de-identification is
not sufficient. The seed population is invented; the clinical patterns are
realistic.

If you contribute test data, invent it. Telephone numbers use the 555 exchange,
e-mail uses `example.com` (reserved by RFC 2606), and addresses use invented
streets.

## Code style

Match the surrounding code. A few conventions that are deliberate:

- **Comments explain why, not what.** A comment restating the code is noise; a
  comment explaining why a guard exists is the reason the guard survives the
  next refactor.
- **Errors name what went wrong and what to do about it.** "That does not look
  like a complete API key" beats "Invalid input".
- **No decorative colour in the clinical area.** Colour carries urgency and
  nothing else where patient data is shown. The chrome is branded; the data is
  not.
- Plain CSS with custom properties. No utility framework.

## Pull requests

- One concern per pull request.
- Say what you changed and why. If it touches clinical logic, say which
  guideline you are following.
- Run `npm test` and `npx tsc --noEmit` before opening.
- If your change is a departure from the build specification, add a note to
  `docs/DEVIATIONS.md` rather than leaving it undocumented.

## Reporting something you cannot fix

If you find a case where the system says something clinically wrong, open an
issue with the input that produced it. That is a valuable contribution on its
own — a reproducible example of bad output is worth more than a speculative
fix.

For security issues, see [SECURITY.md](SECURITY.md) instead of opening an issue.
