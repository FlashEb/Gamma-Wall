#!/usr/bin/env python3
"""Fetch every ticker in tickers.txt from Public into data/<TK>.csv and data/meta.json, during US market hours only."""
import csv, glob, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

now = datetime.now(ZoneInfo("America/New_York"))
if os.environ.get("FORCE") != "1" and (now.weekday() > 4 or not (9 * 60 + 25 <= now.hour * 60 + now.minute <= 16 * 60 + 15)):
    sys.exit(print(f"Outside market hours ({now:%a %H:%M} ET), skipping") or 0)

tickers = [t.strip().upper() for t in open("tickers.txt") if t.strip() and not t.startswith("#")]
os.makedirs("data", exist_ok=True)
try:
    meta = json.load(open("data/meta.json"))
except (OSError, ValueError):
    meta = {}
meta.setdefault("tickers", {})
meta.pop("asof", None); meta.pop("ticker", None)  # old single-ticker format

failed = []
for tk in tickers:
    d = tempfile.mkdtemp()
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "public_gex.py"), tk, "--out", d])
    files = sorted(glob.glob(os.path.join(d, f"gex_{tk}_*.csv")))
    if r.returncode or not files:
        failed.append(tk)
        continue
    shutil.copy(files[-1], f"data/{tk}.csv")
    rows = list(csv.DictReader(open(files[-1])))
    meta["tickers"][tk] = {"asof": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                           "spot": float(rows[0]["underlying_price"]) if rows and rows[0]["underlying_price"] else None,
                           "contracts": len(rows)}

meta["order"] = tickers
meta["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
json.dump(meta, open("data/meta.json", "w"), indent=1)
if failed:
    print("Failed:", ", ".join(failed))
if len(failed) == len(tickers):
    sys.exit(1)
