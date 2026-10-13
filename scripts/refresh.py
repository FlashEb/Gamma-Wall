#!/usr/bin/env python3
"""Fetch the SPY chain from Public into data/SPY.csv + data/meta.json, during US market hours only."""
import glob, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

tk = os.environ.get("TICKER", "SPY")
now = datetime.now(ZoneInfo("America/New_York"))
if os.environ.get("FORCE") != "1" and (now.weekday() > 4 or not (9 * 60 + 25 <= now.hour * 60 + now.minute <= 16 * 60 + 15)):
    sys.exit(print(f"Outside market hours ({now:%a %H:%M} ET), skipping") or 0)
d = tempfile.mkdtemp()
subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "public_gex.py"), tk, "--out", d], check=True)
os.makedirs("data", exist_ok=True)
shutil.copy(sorted(glob.glob(os.path.join(d, f"gex_{tk}_*.csv")))[-1], f"data/{tk}.csv")
json.dump({"ticker": tk, "asof": datetime.now(timezone.utc).isoformat(timespec="seconds")}, open("data/meta.json", "w"))
