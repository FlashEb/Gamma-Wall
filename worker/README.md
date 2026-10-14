# Chain Worker

Lets the Gamma Wall page look up any ticker live from Public without putting your API key in the page.
`GET /chain?ticker=PLTR` returns the CSV the pages read (cached 2 minutes). `GET /bars?ticker=SPY&interval=1m|2m|5m|15m|30m|1h|1d` returns intraday candles from Yahoo for the Atlas chart (cached 20 seconds), and `GET /quote?ticker=SPY` returns Public's latest quote (cached 5 seconds).

To update an existing Worker after `worker.js` changes: open it in the dashboard → **Edit code**, replace everything with the new `worker.js`, **Deploy**. The secrets stay.

## Deploy (Cloudflare dashboard, free plan)

1. Sign in at dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**. Name it `gamma-wall`, then **Deploy**.
2. Click **Edit code**, replace everything with the contents of `worker.js`, then **Deploy**.
3. Go back to the Worker → **Settings** → **Variables and Secrets** → **Add**. Add two of type **Secret**:
   `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID`. Save.
4. Copy the Worker's URL (like `https://gamma-wall.<you>.workers.dev`) and set `WORKER_URL` to it near the bottom of `index.html`.

Only https://flasheb.github.io is allowed to call it from a browser (see `ALLOWED_ORIGINS`).
