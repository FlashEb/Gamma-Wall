# Chain Worker

Lets the Gamma Wall page look up any ticker live from Public without putting your API key in the page.
`GET /chain?ticker=PLTR` returns the same CSV the page already reads. Results are cached for 2 minutes.

## Deploy (Cloudflare dashboard, free plan)

1. Sign in at dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**. Name it `gamma-wall`, then **Deploy**.
2. Click **Edit code**, replace everything with the contents of `worker.js`, then **Deploy**.
3. Go back to the Worker → **Settings** → **Variables and Secrets** → **Add**. Add two of type **Secret**:
   `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID`. Save.
4. Copy the Worker's URL (like `https://gamma-wall.<you>.workers.dev`) and set `WORKER_URL` to it near the bottom of `index.html`.

Only https://flasheb.github.io is allowed to call it from a browser (see `ALLOWED_ORIGINS`).
