# Generation monitoring

`dungeon-achievements-canary` is a separate Cloudflare Worker scheduled hourly
(`0 * * * *`). It GETs production `/health`, which validates the **deployed**
OpenRouter key with `GET https://openrouter.ai/api/v1/key`. It checks authentication,
expiry, and any exhausted per-key spending limit. No achievements, triage calls,
Workers AI, or model inference are invoked, so checks consume no model tokens.
Account-wide credit balance is not checked (that endpoint requires a management key).
This checks site/backend reachability and credentials, not end-to-end generation or
model-provider availability. Real user generation continues unchanged.

The external watchdog refreshes healthy metadata checks hourly, providing a fallback
if Cron stops. Unhealthy state or failed email delivery is rechecked every five minutes
so recovery is detected promptly, still without model tokens. It retries failed
checks once. Independent locations may overlap briefly during KV propagation.

The worker sends high-priority emails from `da-alerts@daneel.carlkibler.com` to
`carl@carlkibler.com`. Subjects explicitly say `ACTION REQUIRED` for primary-provider
failure or a full outage, and `RECOVERED` after recovery. It alerts on transitions and
escalations, then reminds every two hours while a failure persists. A failed email attempt
is retried on the next probe and makes the health endpoint unhealthy.

State lives in the monitor-only `HEALTH` KV namespace. This does not add storage to the app.
`GET https://dungeon-achievements-canary.carl-c0d.workers.dev/health` returns HTTP 503
if site/key health is degraded/down, email failed, no probe exists, or the last probe is over
three hours old. Healthy state returns HTTP 200. Responses are never HTTP-cached;
KV propagation can delay a change reaching another location briefly.

HetrixTools monitor `f1c208396724f61a90f9d3663416c73f` checks that endpoint every
minute from New York, Amsterdam, and Mumbai. Two failed tries at two locations trigger
email to the existing Carl contact list; it repeats three times at 30-minute intervals.
This detects a stopped canary or Cloudflare outage independently of the worker's own email.
GitHub and the laptop are not involved in checks or notification delivery.

## Deploy and operate

From the repository root, use the project Cloudflare token in ignored `.dev.vars`:

```sh
set -a; . ./.dev.vars; set +a
npx wrangler deploy --config monitoring/wrangler.toml
```

The worker secrets are `ALERT_EMAIL_USER`, `ALERT_EMAIL_PASSWORD` (a dedicated
Forward Email alias password, not an account-wide API token), and `ADMIN_TOKEN`.
Local copies live as `DA_ALERT_EMAIL_USER`, `DA_ALERT_EMAIL_PASSWORD`, and
`DA_MONITOR_ADMIN_TOKEN` in ignored `.env`. Preserve existing secrets when rotating one.
The dedicated Forward Email alias must have IMAP storage enabled (`has_imap: true`).
Its sending API shares the IMAP authentication validator; disabling storage can reject
the first API send and trigger an IMAP-not-enabled warning, even without an IMAP client.
Keep its forwarding recipient set to Carl.
The CF token needs Workers Scripts Write and KV Storage Write for monitoring operations;
the same project token retains Pages deployment and AI test permissions.

Authenticated `POST /run` runs a real probe. Authenticated `POST /test-alert` takes
`{"kind":"down"}` or `{"kind":"recovered"}` and sends clearly labeled `[TEST]` emails
through the production mail path without altering the site's or monitor's state.
Use `Authorization: Bearer <ADMIN_TOKEN>`. Keep credentials out of shell command arguments
and logs; load them from the ignored files in a script or pass headers through stdin.

Delivery was verified on October 5, 2026: the mail service recorded both labeled test
emails as sent, with the recipient server acknowledging `250 Message received`.
The outage and recovery test messages were also found in Carl's synced INBOX.
After enabling the dedicated alias's IMAP setting, a further sending-path test succeeded.
HetrixTools stale-state drills produced DOWN and UP messages in Carl's `Notification`
folder, while direct DA test messages arrived in INBOX. The watchdog is active and
was restored to healthy after each drill. No Cron dispatch was observed after initial
registration on October 5. The watchdog-driven Worker trigger supplements Cron.
After deploying that trigger, with no manual probe calls, the health record advanced
at 22:17:19 UTC and reported successful primary-provider generation. Native Cron
dispatch remains unconfirmed; automatic checks now also have a verified external trigger.

October 6, 2026: replaced paid generation probes with hourly credential-only checks.

Requests from the monitor carry `X-DA-Request-Source: healthcheck`. Production
`/health` echoes the source without writing generation analytics. `/generate`
records source in Analytics Engine `blob8`: unmarked traffic is `user`, the monitor
marker is `healthcheck`, and `X-DA-Request-Source: manual` labels manual probes.
These are operational labels, not identities or authenticated attribution.
Historical events have no source label and remain unclassified; no input-length
heuristic is used to relabel them. `scripts/analytics-report.js` defaults to explicitly
labeled user traffic; `--all-sources` includes manual, healthcheck, and legacy rows.
