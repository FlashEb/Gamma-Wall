# Gamma Wall

Dollar-gamma heatmap (strike × expiry) built from Public.com's live option chains.

- `index.html` is the page. Every ticker, whether shown on load, clicked or searched, loads live from Public through the Cloudflare Worker in `worker/`, and the one on screen re-loads every 2 minutes. Buttons come from `tickers.txt`; the search box takes any ticker (`#TSLA` in the URL works too).
- `tickers.txt` is the button list. The workflow also saves a copy of each every 30 minutes, which the page falls back to if the Worker is unreachable.
- If neither the Worker nor a saved copy has a ticker, the page tries CBOE's free 15-minute delayed feed.
- `.github/workflows/refresh.yml` refreshes every 30 minutes on weekdays during US market hours (GitHub can delay scheduled runs by a few minutes).
- Needs repository secrets `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID` (Settings → Secrets and variables → Actions).
- Run it by hand: Actions → Refresh gamma wall → Run workflow (tick "force" outside market hours).
