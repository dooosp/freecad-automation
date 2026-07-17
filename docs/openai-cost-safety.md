# OpenAI API Cost Safety

This repository treats every OpenAI API request as billable. Normal development,
CI, demos, and tests must remain useful without sending any request to OpenAI.

## Four safety layers

1. **Billing remains opt-in.** Do not add a payment method or buy credits merely
   to run the repository tests. If prepaid billing is ever enabled, turn off
   Auto Recharge during setup. OpenAI documents that Auto Recharge is enabled by
   default in the prepaid setup flow.
2. **The client defaults to deny.** Supplying `OPENAI_API_KEY` alone does not
   authorize a request. The Responses client requires an in-process live-request
   authorization and consumes its one-request allowance before calling `fetch`.
3. **The key stays out of files.** On macOS, store the existing key in Keychain
   under account `Codex` and service `freecad-automation.openai-api`. The migration
   helper removes the plaintext `OPENAI_API_KEY` line only after Keychain accepts
   it and never prints the credential.
4. **Paid use is one explicit command.** The Keychain wrapper permits exactly one
   review or design request in one child process. It also disables repair retry.
   A second request is rejected before `fetch`.

Project monthly budgets are monitoring alerts, not hard spending caps: OpenAI
states that requests continue after the project budget is exceeded. Prepaid
cutoff can also be delayed after credits are exhausted. Therefore this repository
does not rely on either control as its zero-charge boundary; the reliable default
is to send no API request.

Official references:

- [OpenAI prepaid billing setup and Auto Recharge](https://help.openai.com/en/articles/8264644-manage-your-chatgpt-subscription)
- [OpenAI project budgets are soft thresholds](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)
- [OpenAI prepaid billing overview](https://help.openai.com/en/articles/8264778-what-is-prepaid-billing)

## Zero-cost testing

These commands use local fixtures and fake `fetch` implementations. They do not
need a credential and must not set any live-request flag:

```bash
env -u OPENAI_API_KEY \
  -u OPENAI_ALLOW_LIVE_REQUEST \
  -u OPENAI_LIVE_TESTS \
  -u OPENAI_LIVE_TEST_MODE \
  -u OPENAI_DEMO_REVIEW \
  node tests/openai-responses-client.test.js

env -u OPENAI_API_KEY \
  -u OPENAI_ALLOW_LIVE_REQUEST \
  -u OPENAI_LIVE_TESTS \
  -u OPENAI_LIVE_TEST_MODE \
  -u OPENAI_DEMO_REVIEW \
  npm test
```

The contract test proves all of the following without network access:

- the default-deny client calls `fetch` zero times;
- a fake authorized client calls its fake `fetch` once;
- the second request is rejected before `fetch`;
- missing one-request authorization is rejected before Keychain access;
- retries and automatic TOML repair remain disabled by default.

Never persist `OPENAI_ALLOW_LIVE_REQUEST`, `OPENAI_LIVE_TESTS`,
`OPENAI_LIVE_TEST_MODE`, or `OPENAI_DEMO_REVIEW` in a shell profile, env file, CI
secret, or workflow.

## Keychain setup

Migrate one existing `.env.local` entry on macOS:

```bash
npm run openai:keychain:migrate -- /absolute/path/to/.env.local
npm run openai:keychain:status
```

The status command reports only whether an item exists. It never prints the key.
Keep the source env file ignored and mode `0600` even after migration because it
may contain other local settings.

## Future one-request use

Do not run the following command during zero-cost verification. It is shown only
for a future occasion when the user has explicitly authorized one potentially
billable request:

```bash
npm run openai:run-once -- \
  --authorize-one-request \
  --design "mechanism description" \
  --json
```

For review mode, replace `--design "..."` with `--review /absolute/path/file.toml`.
The authorization applies to that process only, cannot be reused for a second
request, and does not permit an automatic repair call. Model authentication and
model availability should remain reported as unverified until such a paid request
is deliberately authorized and actually succeeds.

The optional runtime-suite integration additionally requires exactly one mode:
`OPENAI_LIVE_TEST_MODE=review` or `OPENAI_LIVE_TEST_MODE=design`. This prevents a
single test invocation from selecting both billable cases. Normal CI sets neither.
