# Gamma Wall

Dollar-gamma heatmap (strike × expiry) built from Public.com's live option chains.

- `index.html` is the page. Buttons switch between the tickers in `tickers.txt`, and the search box looks up any ticker (`#TSLA` in the URL works too). It re-checks for new data every 5 minutes.
- `tickers.txt` is the default list. Add a line to it (you can edit it on GitHub) and the workflow fetches that ticker right away, then every 30 minutes with the rest.
- A searched ticker that is not in the list falls back to CBOE's free 15-minute delayed feed if your browser can reach it; otherwise the page links you to `tickers.txt`.
- `.github/workflows/refresh.yml` refreshes every 30 minutes on weekdays during US market hours (GitHub can delay scheduled runs by a few minutes).
- Needs repository secrets `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID` (Settings → Secrets and variables → Actions).
- Run it by hand: Actions → Refresh gamma wall → Run workflow (tick "force" outside market hours).
