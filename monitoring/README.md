# Generation monitoring

`dungeon-achievements-canary` is a separate Cloudflare Worker. It runs at minutes
7, 22, 37, and 52 each hour and POSTs a benign activity to the production `/generate`.
It checks three valid cards, the refusal/degradation flags, and the known canned error
titles. A failed probe gets one fresh retry.

The worker sends high-priority emails from `da-alerts@daneel.carlkibler.com` to
`carl@carlkibler.com`. Subjects explicitly say `ACTION REQUIRED` for primary-provider
failure or a full outage, and `RECOVERED` after recovery. It alerts on transitions and
escalations, then reminds every two hours while a failure persists. A failed email attempt
is retried on the next probe and makes the health endpoint unhealthy.

State lives in the monitor-only `HEALTH` KV namespace. This does not add storage to the app.
`GET https://dungeon-achievements-canary.carl-c0d.workers.dev/health` returns HTTP 503
if generation is degraded/down, email failed, no probe exists, or the last probe is over
40 minutes old. Healthy state returns HTTP 200. Responses are never HTTP-cached;
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
The CF token needs Workers Scripts Write and KV Storage Write for monitoring operations;
the same project token retains Pages deployment and AI test permissions.

Authenticated `POST /run` runs a real probe. Authenticated `POST /test-alert` takes
`{"kind":"down"}` or `{"kind":"recovered"}` and sends clearly labeled `[TEST]` emails
through the production mail path without altering the site's or monitor's state.
Use `Authorization: Bearer <ADMIN_TOKEN>`. Keep credentials out of shell command arguments
and logs; load them from the ignored files in a script or pass headers through stdin.

Delivery was verified on October 5, 2026: the mail service recorded both labeled test
emails as sent, with the recipient server acknowledging `250 Message received`.
That proves server delivery, not that the recipient read them or their inbox filter placement.
HetrixTools also reported the new monitor active and up.
