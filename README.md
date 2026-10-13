# Gamma Wall

SPY dollar-gamma heatmap (strike × expiry) built from Public.com's live option chain.

- `index.html` is the page; it loads `data/SPY.csv` and re-checks every 5 minutes.
- `.github/workflows/refresh.yml` refreshes the data every 30 minutes on weekdays during market hours (GitHub may delay scheduled runs by a few minutes).
- Needs repository secrets `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID` (Settings → Secrets and variables → Actions).
- Turn on GitHub Pages (Settings → Pages → Deploy from branch → main, root) to get a public URL.
- Run it now: Actions → Refresh gamma wall → Run workflow (tick "force" outside market hours).
