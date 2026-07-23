# Webhooks & checkout redirect — the two critical paths

Per the Freemius FAQ, these are the two parts that, when broken, make the whole
integration fail. Most "user paid but has no access" reports trace back here.

## Symptom: checkout completes but the user never gets access

**Root causes (in order of likelihood):**

1. **The checkout redirect URL is not configured** in the Dashboard (Plans →
   Customization → checkout success redirect). Without it, the hosted checkout
   never sends the user back to `GET /api/checkout/redirect`, so the
   redirect-path sync never runs.
2. **The webhook URL is not configured** (Product → Webhooks → Listeners), so
   `license.created` never reaches `POST /api/webhooks/freemius`. The overlay
   callback (`POST /api/purchase`) covers the overlay path, but the webhook is
   the durable backstop and the only sync for changes made outside the app.
3. **The URL still points at `localhost` or an old domain** after deploying.
   Freemius can only reach a public URL. Set `PUBLIC_APP_URL` to the live domain
   and re-enter both URLs in the Dashboard.

**Fix:** verify all three. The full env + dashboard checklist lives in
`freemius-core` → `references/dashboard-and-secrets.md`. The redirect handler
and overlay callback share one sync function (`freemius-core` →
`references/purchase-processing.md`), so once the URL is correct, both paths
converge on the same `user_fs_entitlement` upsert.

## Symptom: webhook signature verification fails

**Root cause:** the raw request body was read/parsed before being handed to the
listener. Signature verification needs the **unmodified raw body**.

**Fix:** on Hono, pass `c.req.raw` straight to
`freemius.webhook.processFetch(listener, c.req.raw)` — do **not** call
`c.req.json()` / `c.req.text()` first. See `freemius-core` →
`references/webhooks.md` ("Raw body matters").

## Symptom: Freemius emails "webhook processing failed"

Freemius retries non-2xx responses and emails you on repeated failure. The email
contains the event and the error.

**Fix:** paste the email content to the agent. Common causes: an unguarded
`license` union (see `sdk-types-and-events.md`), a thrown error inside an event
handler (`processFetch` awaits handlers — keep them lean and let them succeed),
or a 500 from the DB. Log inside each handler (`console.log('[webhook]', …)`) so
the failing event is identifiable.

## Symptom: entitlement doesn't update after a cancel/renew, webhook looks dead — but handler, URL and signature all check out

You change the license/subscription in the Dashboard (e.g. admin cancel) and the
app does nothing: the cancelled user still has access, the `user_fs_entitlement`
row never flips. It looks exactly like a broken handler — but the handler, the
webhook URL, and signature verification are all correct.

**Root cause:** the lifecycle event fired **before the webhook URL was
active/propagated** in the Dashboard. The URL had just been set (or the event
fired around the same moment), so Freemius never delivered that event. Events
fired before the URL is configured are **not** retro-delivered — there is no
event to retry, so the app legitimately never hears about it. The symptom is
identical to a dead handler, but the cause is purely timing.

**How to tell it apart from a real handler bug:**

1. **Prove the endpoint is live.** Send an unsigned `POST` to
   `https://<domain>/api/webhooks/freemius` — a live, correctly wired handler
   returns Freemius's `Invalid signature` **401**. A 404/502/timeout means the
   route or deploy is the problem, not timing.
2. **Force a real delivery.** Use the Dashboard's **resend / retry** on the
   existing event (or re-trigger the lifecycle change) and watch the live logs
   for a processed line, e.g. `[webhook] license event 1989749 --> 200`. If a
   manual resend processes `200`, the handler was never broken — the original
   event simply was never delivered.

**Fix:** set the webhook URL **first**, then **wait for it to propagate** (allow
~5 min) before concluding anything. To test lifecycle handling, either (a)
trigger the change **after** the URL is confirmed live, or (b) use the
Dashboard's **resend / retry** on the existing event. Do not conclude "webhook
failure" until you have allowed propagation time and confirmed (via an
unsigned-POST `401` and a manual-resend `200`) that delivery actually reached
the live handler.

## Verifying end-to-end (gate-style)

1. Complete a checkout in **sandbox mode** (`FREEMIUS_SANDBOX=true`) using a
   test credit card — sandbox runs are free; no coupon is needed.
2. Confirm the redirect lands on `/checkout-result?success=true`.
3. Confirm a `user_fs_entitlement` row appears (redirect-path sync).
4. Change the license in the Dashboard (cancel) → confirm the row updates
   (webhook-path sync).
5. Delete the license → confirm the row is removed (`license.deleted`).
