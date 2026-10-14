# Gamma Wall

Dollar-gamma heatmap (strike × expiry) built from Public.com's live option chains.

- `index.html` is the page. Every ticker, whether shown on load, clicked or searched, loads live from Public through the Cloudflare Worker in `worker/`, and the one on screen re-loads every 2 minutes. Tabs switch between GEX, VEX (vanna), DEX (delta) and Charm, All expirations or 0DTE, and the value or its change since the open; chips show the call wall, put wall, zero gamma and the King (the biggest single cell, outlined in gold). Buttons come from `tickers.txt`; the search box takes any ticker (`#TSLA` in the URL works too).
- `atlas.html` is the Gamma Atlas chart: candles from 1m to 1D with zoom, pinch, price-axis stretch and a full-screen expand with each strike's GEX, VEX or GEX+VEX drawn across it as rows of orbs (bigger and brighter = stronger, gold positive, violet negative), the strongest strike marked as the King Node, and a flow panel built from 2-minute chain snapshots. Candles come from Yahoo through the Worker's `/bars`; if that fails, the page builds candles from live Public quotes.
- `data/open/<TK>.csv` is the first snapshot after 9:30 ET each day, the baseline for “Δ since open”. For tickers without one, the page uses the first chain the browser saw that day.
- `tickers.txt` is the button list. The workflow also saves a copy of each every 30 minutes, which the page falls back to if the Worker is unreachable.
- If neither the Worker nor a saved copy has a ticker, the page tries CBOE's free 15-minute delayed feed.
- `.github/workflows/refresh.yml` refreshes every 30 minutes on weekdays during US market hours (GitHub can delay scheduled runs by a few minutes).
- Needs repository secrets `PUBLIC_API_SECRET` and `PUBLIC_ACCOUNT_ID` (Settings → Secrets and variables → Actions).
- Run it by hand: Actions → Refresh gamma wall → Run workflow (tick "force" outside market hours).
