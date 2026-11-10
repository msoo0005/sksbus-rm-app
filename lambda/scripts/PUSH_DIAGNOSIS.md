# Push diagnosis — manual runbook

No AWS CLI required. Everything here is the AWS Console, your MySQL client, and
a browser. `diagnose_push.sh` automates the same checks if you ever install the
CLI; this is the click-through equivalent.

Work top to bottom and **stop as soon as a step gives you an answer** — step 2
alone resolves it most of the time.

---

## 1. The free test (30 seconds, do this first)

**Force-quit the app on the test device and reopen it.**

Registration runs when `dbUser` becomes non-null, which happens on every cold
start — so this re-runs it against the `/me/push-token` route that only started
existing when you ran `add_missing_apigw_routes.sh`. Every attempt before that
threw into an empty catch and was never retried for the life of the session.

Then go straight to step 2.

---

## 2. Is `PUSH_TOKEN` empty? (the highest-value check)

Run against RDS in your MySQL client:

```sql
SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS users, MAX(updated_at) AS last_seen
FROM PUSH_TOKEN;
```

| Result | Meaning | Next |
|---|---|---|
| `total = 0` | **No device has ever registered.** The push send exits before contacting Expo. This is the expected result and confirms the hypothesis. | Step 3 |
| `total > 0`, `last_seen` just now | Registration works. The failure is in delivery. | Step 4 |
| `total > 0` but `last_seen` is old | Stale tokens only — your test device isn't registered. | Step 3 |

If there are rows, also check none are junk that gets silently discarded at send time:

```sql
SELECT * FROM PUSH_TOKEN
WHERE expo_push_token NOT REGEXP '^Expo(nent)?PushToken\[.+\]$';
```

Any rows here were accepted with a `200` and then dropped without a log. The
updated Lambda rejects these at write time with a 400 instead.

---

## 3. If the table is empty — why is the device not registering?

The device never gets as far as calling the API. Three things to check:

**a. Does the Expo project have an APNs push key?**
Go to **expo.dev → your account → project `sksbus-rm-app` → Credentials → iOS**.
There must be a **Push Key** bound to `com.anonymous.sksbus-rm-app`.
Without it `getExpoPushTokenAsync` throws, and the old code swallowed that
silently. (The new code logs it as `token_fetch_failed`.)

**b. Is Enhanced Security on?**
**Project settings → Notifications.** If *Enhanced Security for Push
Notifications* is enabled, the server needs an access token — see step 5c.

**c. Did the device actually grant permission?**
On the device: **Settings → sksbus-rm-app → Notifications**. If it's off,
turn it on and foreground the app — the new build re-registers on foreground.

> After deploying the updated app build, the **notifications screen shows an
> admin-only line** reading e.g. `Push: blocked — permission_denied`. That
> replaces all of this guesswork for future devices.

---

## 4. If the table has rows — where does delivery stop?

### 4a. Lambda configuration

**Console → Lambda → your function → Configuration → General configuration**

- **Runtime** must be `Node.js 18.x` or newer. On Node 16 the global `fetch()`
  does not exist and every push throws `fetch is not defined`.
- **Timeout** — note it. The daily tyre digest does more work than one request;
  raise to 60s if it's under 30.

**Configuration → VPC**

- **No VPC** → egress is fine, skip 4b.
- **VPC listed** → do 4b. A VPC Lambda has no internet access without a NAT.

### 4b. Can the Lambda reach the internet?

For each subnet shown under VPC:

**Console → VPC → Subnets → select subnet → Route table tab**

Look for the `0.0.0.0/0` row:

| Target | Verdict |
|---|---|
| `nat-…` | Egress OK — not your problem |
| `igw-…` | **Broken.** A Lambda ENI has no public IP, so an internet gateway gives it no egress |
| No `0.0.0.0/0` row | **Broken.** No route out at all |

If broken, this is infrastructure, not code: add a NAT Gateway, or move the
push send out of the VPC. No code change can work around it.

> This is probably *not* your cause. The push `fetch` is awaited on the request
> path, so a blackholed connection would hang until the Lambda timed out and
> report-submit would visibly fail. You've said it doesn't.

### 4c. Bypass the Lambda entirely

Take a real token from step 2 and send to Expo directly from your Mac —
this cleanly separates *"token/credentials broken"* from *"Lambda can't reach
Expo"*:

```bash
curl -s -X POST https://exp.host/--/api/v2/push/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"ExponentPushToken[PASTE_HERE]","title":"probe","body":"probe","priority":"high"}'
```

| Response | Meaning |
|---|---|
| Banner arrives on the device | Token and Expo credentials are fine → the problem is in the Lambda (4a/4b) |
| `"status":"error"`, `"details":{"error":"DeviceNotRegistered"}` | That token is dead — the app was reinstalled or the token rotated |
| `"details":{"error":"InvalidCredentials"}` | **No APNs push key on the Expo project** — step 3a |
| HTTP 400/401 | Enhanced Security is on — step 5c |

---

## 5. Reading the logs (best done *after* deploying the updated Lambda)

**Console → CloudWatch → Logs → Logs Insights**, select
`/aws/lambda/<your-function>`, last 1 day.

### 5a. Before deploying the new Lambda

The old code logs almost nothing, so run this to check for the few strings it
*could* emit:

```
fields @timestamp, @message
| filter @message like /Failed to send push|Expo push send failed|Task timed out|fetch is not defined/
| sort @timestamp desc
| limit 50
```

**No results is the expected outcome** and is itself informative: it means the
send exited at the silent `if (!tokens.length) return;` — i.e. an empty
`PUSH_TOKEN`, consistent with step 2.

### 5b. After deploying the new Lambda

```
fields @timestamp, @message
| filter @message like /"tag":"PUSH"/
| sort @timestamp desc
| limit 200
```

Trigger a report submit, then read the trace. It runs
`notify.start → notify.recipients → notify.scope → push.lookup → … → push.summary`
and **cannot exit without either a summary or a logged error**.

| Last stage seen | Meaning |
|---|---|
| `push.skip` `reason=no_tokens` | `PUSH_TOKEN` empty → step 3 |
| `push.skip` `reason=no_valid_tokens` | Rows exist but all malformed → the regex query in step 2 |
| `notify.recipients` `reason=none` | Nobody holds those roles, **or** project scoping excluded everyone → step 6 |
| `push.response` with `errors[]` | Read each `detail`: `InvalidCredentials` → step 3a; `DeviceNotRegistered` → now auto-pruned |
| `push.summary` `ticketsOk > 0` | **Expo accepted it.** If no banner appears, the problem is on the device: notification permission, or Focus/Do Not Disturb |
| `push.chunk.fail` with `AbortError` | The 8s timeout fired — network or NAT (4b) |

### 5c. Setting `EXPO_ACCESS_TOKEN` (only if Enhanced Security is on)

Generate at **expo.dev → account settings → Access tokens**, then
**Console → Lambda → Configuration → Environment variables → Edit → Add**:
`EXPO_ACCESS_TOKEN` = the token.

> Adding via the console is safe. The CLI's
> `update-function-configuration --environment` **replaces the entire variable
> map** — using it carelessly wipes `DB_HOST`/`S3_BUCKET` and takes the API down.

The code sends the `Authorization` header only when this is set, and logs
`hasAuth` in `push.request` so you can confirm it took effect.

---

## 6. Before enabling project scoping

Notifications are now scoped to the recipient's projects, like every other
endpoint. This is the only change that can **reduce** who gets notified, so
check nobody falls off:

```sql
SELECT u.user_role, COUNT(*) AS users, SUM(up.user_id IS NULL) AS without_project
FROM `USER` u
LEFT JOIN (SELECT DISTINCT user_id FROM USER_PROJECT) up ON up.user_id = u.user_id
GROUP BY u.user_role;
```

Any non-zero `without_project` for `rm_manager` / `technician` / `fleet_manager`
means those people stop receiving notifications. Either backfill `USER_PROJECT`,
or set the Lambda env var `NOTIFY_PROJECT_SCOPE` = `0` to keep the old
fleet-wide behaviour. Admins are always fleet-wide regardless.

---

## 7. The scheduled tyre digest, without the CLI

`add_scheduled_trigger.sh` does this in one command, but the console works too:

1. **CloudWatch → Events → Rules → Create rule**
   - Name `sksbus-tyre-daily`
   - Rule type **Schedule**
   - Cron expression `0 1 * * ? *` — 01:00 UTC = **09:00 Malaysia**
2. **Target** → Lambda function → your function
3. **Additional settings → Configure target input → Constant (JSON text)**:
   ```json
   {"task": "tyre_daily"}
   ```
   This is what the handler keys on. Without it the invocation is rejected.
4. Create. AWS adds the invoke permission for you.

**Test before trusting the schedule** — Console → Lambda → **Test** tab, create
an event with that exact JSON body, and run it **twice**. The second run should
report `skipped > 0` and insert nothing, which proves the dedupe table works.

> This is **not** an API Gateway route. It's a different integration — the
> Lambda distinguishes them by the absence of `requestContext` plus the
> presence of `task`.
