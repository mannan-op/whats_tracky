# whats-tracky

A personal budget bot for WhatsApp. You set how much money you have, text each expense in plain language, and ask what is left. It keeps the totals, splits spending by category, and when you reserve cash for a date it tells you a safe daily limit until then.

The brain is one function, `handleMessage(userId, text) -> reply`. Three thin adapters sit on top of it:

- a local CLI, so you can try it with no WhatsApp account
- a Twilio WhatsApp sandbox webhook
- a Meta WhatsApp Cloud API webhook

It keeps a separate ledger for each phone number in a SQLite file, or in Turso when `TURSO_DATABASE_URL` is set. Categories, balances, and daily limits are deterministic. If `OPENAI_API_KEY` is set, messages the parser does not understand can be interpreted by a model, and `advice` can be rewritten in a warmer tone. With no key, every command still works.

## Sample conversation

This is a real CLI session (`TZ=Asia/Karachi`, `CURRENCY=PKR`). The shell clock was still Sunday 27 Sep 2026 in UTC; Karachi was already Monday 28 Sep, so "Friday" landed on Fri 2 Oct, four days out.

```
Budget bot · PKR · Asia/Karachi
Type a message. Ctrl-D exits.

you> funds 50000
Funds set to *PKR 50,000*.
That is your balance now.

you> 500 food lunch
Logged *PKR 500* · Food
lunch

Left: *PKR 49,500*

you> spent 1200 on petrol
Logged *PKR 1,200* · Transport
petrol

Left: *PKR 48,300*

you> groceries 3400
Logged *PKR 3,400* · Groceries
groceries

Left: *PKR 44,900*

you> -250 tea
Logged *PKR 250* · Food
tea

Left: *PKR 44,650*

you> balance
Balance: *PKR 44,650*
Today spent: *PKR 5,350*

you> save 5000 for Friday
Set aside *PKR 5,000* for Fri 2 Oct.

Balance: *PKR 44,650*
Reserved: *PKR 5,000*
Available to spend: *PKR 39,650*
Safe daily limit: *PKR 9,912* · 4 days to Fri 2 Oct
*PKR 4,562* of that is left today (*PKR 5,350* already spent).

you> save 3000 for 2026-10-15 wedding
Set aside *PKR 3,000* for Thu 15 Oct.

Balance: *PKR 44,650*
Reserved: *PKR 8,000*
Available to spend: *PKR 36,650*
Safe daily limit: *PKR 2,450* · 17 days to Thu 15 Oct
Heads up: today is *PKR 5,350*, over the safe daily limit of *PKR 2,450*.

you> goals
*Goals*

1. Friday — *PKR 5,000* — Fri 2 Oct (4 days)
2. wedding — *PKR 3,000* — Thu 15 Oct (17 days)

Reserved *PKR 8,000* · available *PKR 36,650*
Safe daily limit: *PKR 2,450* · 17 days to Thu 15 Oct

you> balance
Balance: *PKR 44,650*
Reserved: *PKR 8,000*
Available to spend: *PKR 36,650*
Safe daily limit: *PKR 2,450* · 17 days to Thu 15 Oct
Today spent: *PKR 5,350*
Heads up: today is *PKR 5,350*, over the safe daily limit of *PKR 2,450*.

you> advice
*Advice*

Balance *PKR 44,650* · available *PKR 36,650*.
7-day burn is *PKR 764* a day. At that pace, available money lasts about *47* days.
Biggest this month: *Groceries* — *PKR 3,400* (64% of spending).
Groceries is a large share. Check whether that was planned.
Today *PKR 5,350* is over the safe daily limit of *PKR 2,450* until Thu 15 Oct.
Friday is reserved for Fri 2 Oct (4 days).
wedding is reserved for Thu 15 Oct (17 days).

you> 6000 clothes
Logged *PKR 6,000* · Shopping
clothes

Left: *PKR 38,650*
Available: *PKR 30,650* (reserved *PKR 8,000*)
Safe daily limit: *PKR 2,097* · 17 days to Thu 15 Oct
Heads up: today is *PKR 11,350*, over the safe daily limit of *PKR 2,097*.

you> undo
Undid Shopping *PKR 6,000* (clothes).
Balance: *PKR 44,650*.

you> history
*Recent*

1. Food · PKR 250 · tea · 28 Sept, 04:18
2. Groceries · PKR 3,400 · groceries · 28 Sept, 04:18
3. Transport · PKR 1,200 · petrol · 28 Sept, 04:18
4. Food · PKR 500 · lunch · 28 Sept, 04:18
5. Set funds · PKR 50,000 · 28 Sept, 04:18

you> delete goal 2
Removed goal 2 (wedding, *PKR 3,000*).

you> reset
This deletes your funds, expenses, and goals.
Reply *YES* to confirm.

you> no
Reset cancelled. Your budget is unchanged.
```

## What you can say

| You send | What happens |
| --- | --- |
| `funds 50000`, `set funds 50000`, `my funds are 50000` | Balance becomes that amount. Older expenses stay in reports and stop affecting the balance. |
| `add funds 10000` | Adds cash on top of the current balance. |
| `500 food lunch`, `spent 1200 on petrol`, `groceries 3400`, `-250 tea` | Logs an expense. A keyword map picks food, transport, groceries, bills, shopping, entertainment, health, or other. |
| `balance`, `left`, `how much left` | Balance, reserved total, available cash, and today's spend. |
| `report`, `where did I spend`, `summary week`, `summary month` | Totals by category, share of the period, and the largest items. |
| `save 5000 for Friday`, `save 3000 for 15 Oct wedding`, `save 3000 for 2026-10-15 wedding` | Reserves that amount. Reply includes available cash, days until the date, and a daily spending cap. |
| `goals` | Lists reserves. |
| `delete goal 2` | Removes goal number 2 from that list. |
| `undo` | Reverses the last funds change, expense, new goal, or goal deletion. |
| `history` | Last 10 funds changes and expenses. |
| `advice` or `tips` | Burn rate, runway, biggest category, and goal warnings. |
| `help` | Short command list. |
| `reset` then `YES` | Deletes that user's ledger. Any other reply cancels it. |

Amounts accept commas and a `k` suffix (`50,000`, `50k`). Dates accept weekdays, `today`, `tomorrow`, `15 Oct`, `15/10/2026` (day/month/year), and `YYYY-MM-DD`.

`funds 50000` means "this is what I have now". It replaces the balance.

A savings goal is set aside until its date. Available cash is the balance minus every reserve. The safe daily limit is one number, from `planGoals`, and goal replies, expense warnings, balance, and advice all print that number.

For each goal, hold back every reserve due on that date or later (you may use an earlier reserve only after its date). Divide what is left by the days until the goal and round down to a whole rupee. The safe daily limit is the smallest of those caps. Spending that much every day never spends a reserve early. Money already spent today is checked against that same cap. If today is still under it, the reply also says how much of the cap is left today. PKR amounts are whole rupees.

In the sample, after `save 5000 for Friday` the spendable money is 44,650 − 5,000 = 39,650 over 4 days. 39,650 / 4 rounds down to 9,912, and 9,912 × 4 = 39,648, which leaves the 5,000 reserve. Today already used 5,350 of the cap, so 4,562 is left today.

After the wedding goal, Friday's own cap is 36,650 / 4, which rounds down to 9,162. The wedding cap is (44,650 − 3,000) / 17 = 2,450, because the Friday money can be spent after Fri 2 Oct. The safe daily limit is the smaller one, 2,450. 2,450 × 17 = 41,650, the balance minus the 3,000 that must still be there on 15 Oct. Today's 5,350 is over 2,450, so the goal reply, `goals`, `balance`, and `advice` all say 2,450.

`6000 clothes` lowers the balance to 38,650. The same function then returns (38,650 − 3,000) / 17 rounded down to 2,097, and the warning uses 2,097.

Advice is always computed from those figures: 7-day burn, how long available cash lasts at that pace, the biggest category this month, and whether each goal is covered. An OpenAI key only rewrites that text, and the rewrite is kept only when every number is still there.

## Local CLI

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm test
npm run cli
```

`npm run cli` opens a prompt. Piped input works too:

```bash
echo 'funds 50000' | npm run cli
```

The default database is `./data/budget.db`. `CLI_USER` in `.env` is the identity for that terminal (default `me`). Nothing else is required: no Twilio account, no Meta app, no API key.

## Twilio WhatsApp sandbox

This is the fastest way to use a real WhatsApp chat. The sandbox is free; your phone has to join it, and replies go back as TwiML, so the app does not need your Account SID.

1. Create a Twilio account and open **Messaging → Try it out → Send a WhatsApp message**.
2. Note the sandbox number (usually `+1 415 523 8886`) and the join phrase (`join <two-words>`).
3. From the phone you want to track, send that join phrase to the sandbox number on WhatsApp.
4. On your machine:

   ```bash
   npm install
   cp .env.example .env
   ```

   Put your Auth Token in `TWILIO_AUTH_TOKEN`. Leave `PUBLIC_URL` blank until the tunnel exists.
5. Start the bot:

   ```bash
   npm run dev
   ```

   It listens on `0.0.0.0:3000` (or whatever `PORT` is).
6. Expose that port with a public HTTPS URL. With [ngrok](https://ngrok.com/):

   ```bash
   ngrok http 3000
   ```

   Copy the `https://….ngrok-free.app` origin, with no path and no trailing slash, into `PUBLIC_URL`, and restart `npm run dev`.
7. In the Twilio sandbox settings, set **When a message comes in** to `POST https://YOUR-ORIGIN/webhooks/twilio` and save.
8. Send `funds 50000` to the sandbox number from the phone that joined.

`TWILIO_AUTH_TOKEN` turns on `X-Twilio-Signature` checks. The signed URL is `PUBLIC_URL` plus the path, so those two have to match the address Twilio calls. Without the token, the webhook still answers, which is fine for a local experiment and too open for a public URL.

`TWILIO_WHATSAPP_FROM` is only a reminder of the sandbox sender. Replies do not use the Twilio REST API.

## Meta WhatsApp Cloud API

1. In [Meta for Developers](https://developers.facebook.com/), create an app and add the WhatsApp product.
2. On the API setup screen, copy the temporary access token, the phone number ID, and the test business number. Add your own mobile number as a recipient and confirm the code Meta sends.
3. Choose a long random string and put it in `META_VERIFY_TOKEN`. Put the token and phone number ID in `META_ACCESS_TOKEN` and `META_PHONE_NUMBER_ID`. Put the app secret in `META_APP_SECRET` (App settings → Basic). That secret turns on `X-Hub-Signature-256` checks.
4. Run `npm run dev` and expose port 3000 the same way as for Twilio. Set `PUBLIC_URL` to that origin.
5. In the WhatsApp configuration, set the callback URL to `https://YOUR-ORIGIN/webhooks/meta` and the verify token to the same string as `META_VERIFY_TOKEN`. Subscribe to the **messages** field.
6. Send a text to the test business number. The bot replies through `POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages`. Override the version with `META_GRAPH_VERSION` if Meta has moved on.

A temporary token expires in about a day. For a bot you leave running, create a system user token in Business Manager. Outside the 24-hour customer-care window, WhatsApp only accepts pre-approved template messages; this bot sends free-form replies, so it answers inside that window after the user texts first.

## Deploy free: Render + Turso + Twilio sandbox

Render's free web service has an ephemeral disk and sleeps after about 15 minutes with no traffic. A SQLite file on that disk disappears on sleep or restart, so production data lives in a free [Turso](https://turso.tech) database (hosted libSQL). When `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set, the server uses Turso. When they are unset, the CLI and tests keep using the SQLite file at `DATABASE_PATH`. The budget engine talks to one storage interface either way. Both backends create the schema on startup.

Twilio stops waiting after about 15 seconds. The Render start command is `npm start`, which runs the compiled `node dist/server.js`. The build compiles TypeScript once (`tsc`), so a cold start is a Node boot plus a short schema check.

`GET /health` returns `{"ok":true}`.

### Keep it awake

A free monitor can hit the health check every 10 minutes so the service is less likely to be asleep when a WhatsApp message arrives. [cron-job.org](https://cron-job.org) and [UptimeRobot](https://uptimerobot.com) both have free plans. Point the job at:

```text
GET https://<render-app>.onrender.com/health
```

every 10 minutes.

Render's free plan includes a monthly pool of free instance hours (750 hours at the time of writing; confirm the current number on [Render's free plan](https://render.com/docs/free)). A process that never sleeps can spend that pool and then stop until the next month. The pinger keeps replies fast during the hours you care about. If the hours run out, the service stops until the allowance resets.

### 1. Create the Turso database

Dashboard:

1. Sign in at [https://turso.tech](https://turso.tech) and open the Turso dashboard.
2. Create a database, for example `whats-tracky`, in a region near you.
3. Copy the database URL. It looks like `libsql://whats-tracky-<org>.turso.io`. That value is `TURSO_DATABASE_URL`.
4. Create a read-write auth token and copy it. That value is `TURSO_AUTH_TOKEN`.

CLI alternative, after `turso auth login`:

```bash
turso db create whats-tracky
turso db show whats-tracky --url
turso db tokens create whats-tracky
```

The `--url` output is `TURSO_DATABASE_URL`. The token command prints `TURSO_AUTH_TOKEN`.

### 2. Create the Render web service

`render.yaml` is a Blueprint for a **free** Node web service. It has no disk. The build command is `npm ci --include=dev && npm run build`. The start command is `npm start`. The health check path is `/health`.

1. Push this repo to GitHub.
2. In the [Render dashboard](https://dashboard.render.com), choose **New → Blueprint** and connect the GitHub repo. Pick the branch that contains `render.yaml` (this branch until it is merged, then `main`).
3. Render asks for every secret marked `sync: false`. Fill in the Turso URL and token, `TWILIO_AUTH_TOKEN`, and `PUBLIC_URL` once you know the hostname. `OPENAI_API_KEY` is optional. `CURRENCY` and `TZ` are already `PKR` and `Asia/Karachi`.
4. Or create a **Web Service** by hand: runtime **Node**, plan **Free**, build command `npm ci --include=dev && npm run build`, start command `npm start`, health check path `/health`, and the same environment variables. No Dockerfile is required.
5. After the first deploy, open `https://<render-app>.onrender.com/health` and confirm `{"ok":true}`.
6. Set `PUBLIC_URL` to `https://<render-app>.onrender.com` with no trailing slash. Twilio signature checks rebuild the webhook URL from this origin. Redeploy if you set it after the first boot.

### 3. Point the Twilio sandbox at Render

1. In the Twilio console, open **Messaging → Try it out → Send a WhatsApp message** (the sandbox).
2. Under **Sandbox settings**, set **When a message comes in** to:

```text
https://<render-app>.onrender.com/webhooks/twilio
```

Method: **HTTP POST**. Save.

3. From your phone, send the sandbox join message (`join <two-words>`) to the sandbox number.
4. Send `funds 50000`, then `500 lunch`, then `balance`.

### Environment variables for this deploy

| Variable | Required | Value |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `libsql://...turso.io` from the dashboard or `turso db show --url` |
| `TURSO_AUTH_TOKEN` | yes | read-write token from the dashboard or `turso db tokens create` |
| `TWILIO_AUTH_TOKEN` | yes | Twilio account auth token (enables signature checks) |
| `PUBLIC_URL` | yes | `https://<render-app>.onrender.com` |
| `OPENAI_API_KEY` | no | only if you want the model fallback |
| `CURRENCY` | set by Blueprint | `PKR` |
| `TZ` | set by Blueprint | `Asia/Karachi` |

Render injects `PORT`. Leave `DATABASE_PATH` unset on this deploy; the Turso variables select the database.

Webhook URL format:

```text
https://<render-app>.onrender.com/webhooks/twilio
```

POST. Replace `<render-app>` with the hostname Render assigns.

## Deploy

The same Node server can run in Docker, on Railway, or on Fly with a mounted disk and `DATABASE_PATH`, as long as the Turso variables are left unset. Those hosts keep the SQLite file on the volume.

Health check: `GET /health` returns `{"ok":true}`.

### Docker

```bash
docker build -t whats-tracky .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/budget.db \
  -e CURRENCY=PKR \
  -e TZ=Asia/Karachi \
  -e PUBLIC_URL=https://YOUR-ORIGIN \
  -e TWILIO_AUTH_TOKEN=your-token \
  -v whats-tracky-data:/data \
  whats-tracky
```

The image is `node:22`, builds TypeScript, and starts `node dist/server.js`. The process binds `0.0.0.0:$PORT`.

### Railway

1. New project → Deploy from GitHub.
2. Add a volume, mount it at `/data`.
3. Set `DATABASE_PATH=/data/budget.db`, `CURRENCY`, `TZ`, `PUBLIC_URL`, and the Twilio or Meta secrets.
4. Generate a public domain and use that origin as `PUBLIC_URL` and as the webhook base.

### Fly.io

`fly.toml` expects an app named `whats-tracky`, region `sin`, and a volume named `budget_data` mounted at `/data`. Rename the app if that name is taken.

```bash
fly launch --no-deploy
fly volumes create budget_data --size 1 --region sin
fly secrets set \
  PUBLIC_URL=https://YOUR-APP.fly.dev \
  TWILIO_AUTH_TOKEN=your-token \
  CURRENCY=PKR \
  TZ=Asia/Karachi
fly deploy
```

Machines may stop when idle (`auto_stop_machines`). The volume keeps the database.

## Environment

Every variable the process reads is listed in `.env.example`.

| Variable | Role |
| --- | --- |
| `PORT` | HTTP port. Default `3000`. Render injects this. |
| `TURSO_DATABASE_URL` | libSQL URL. When set, the server uses Turso (or a local `file:` URL) instead of `DATABASE_PATH`. |
| `TURSO_AUTH_TOKEN` | Turso auth token. Required for a hosted database. Unused for a local `file:` URL. |
| `DATABASE_PATH` | SQLite file used when `TURSO_DATABASE_URL` is unset. Default `./data/budget.db`. |
| `CURRENCY` | Prefix on amounts. Default `PKR`. |
| `TZ` | IANA timezone for "today" and weekdays. Default `Asia/Karachi`. A bad name falls back to UTC. |
| `PUBLIC_URL` | Public origin with no trailing slash. Used to verify Twilio signatures. |
| `TWILIO_AUTH_TOKEN` | Enables Twilio signature checks. |
| `TWILIO_WHATSAPP_FROM` | Sandbox sender, for your own notes. |
| `META_VERIFY_TOKEN` | String you invent; Meta sends it on the webhook verify GET. |
| `META_ACCESS_TOKEN` | Token used to send replies. |
| `META_PHONE_NUMBER_ID` | WhatsApp phone number ID. |
| `META_APP_SECRET` | Enables Meta signature checks. |
| `META_GRAPH_VERSION` | Default `v25.0`. |
| `OPENAI_API_KEY` | Optional. |
| `OPENAI_MODEL` | Default `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | Default `https://api.openai.com/v1`. |
| `CLI_USER` | Identity for `npm run cli`. Default `me`. |

## Tests

```bash
npm test
npm run typecheck
```

`npm test` covers the parser (funds, expenses, categories, reports, savings dates), the balance and report math, goal daily limits, undo, reset confirmation, the storage interface on local SQLite and on libSQL via a `file:` URL, and the Twilio and Meta HTTP adapters.

## Layout

- `src/handleMessage.ts` — `handleMessage(userId, text)`
- `src/parser.ts` — deterministic commands
- `src/engine.ts` — ledger writes and reply text
- `src/calc.ts` — balance, category report, daily limit
- `src/advice.ts` — rule-based advice
- `src/llm.ts` — optional OpenAI fallback
- `src/db.ts` — storage: local SQLite, or Turso when `TURSO_DATABASE_URL` is set
- `src/cli.ts` — terminal
- `src/server.ts` — HTTP
- `src/adapters/twilio.ts`, `src/adapters/meta.ts` — webhooks
- `src/categories.ts` — keyword map, if you want to add words

Keywords live in one list. `petrol`, `uber`, and `fuel` map to transport. `gas bill` maps to bills; `gas` alone maps to transport.
