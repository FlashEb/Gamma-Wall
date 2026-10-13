#!/usr/bin/env python3
"""Pull an option chain from Public's API and write a CSV the Gamma Wall page loads.

Usage: python3 public_gex.py SPY [--max-exp 13] [--out DIR]

Needs env vars PUBLIC_API_SECRET and PUBLIC_ACCOUNT_ID, and network access to
api.public.com. Writes gex_<TICKER>_<YYYYMMDD-HHMM>.csv with header
symbol,strike,expiration,type,open_interest,iv,gamma,underlying_price
"""
import argparse, csv, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE = "https://api.public.com"
OSI = re.compile(r"^([A-Z.]+?)\s*(\d{6})([CP])(\d{8})")


def call(method, path, token=None, body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, vs in params.items() for v in vs)
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            detail = e.read().decode(errors="replace")[:300]
            sys.exit(f"Public API {method} {path} -> HTTP {e.code}: {detail}")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker", nargs="?", default="SPY")
    ap.add_argument("--max-exp", type=int, default=13)
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    tk = a.ticker.upper()

    secret, acct = os.environ.get("PUBLIC_API_SECRET"), os.environ.get("PUBLIC_ACCOUNT_ID")
    missing = [n for n, v in (("PUBLIC_API_SECRET", secret), ("PUBLIC_ACCOUNT_ID", acct)) if not v]
    if missing:
        sys.exit("Missing env vars: " + ", ".join(missing))

    token = call("POST", "/userapiauthservice/personal/access-tokens",
                 body={"validityInMinutes": 60, "secret": secret})["accessToken"]
    inst = {"symbol": tk, "type": "EQUITY"}
    md = f"/userapigateway/marketdata/{acct}"

    q = call("POST", f"{md}/quotes", token, {"instruments": [inst]}).get("quotes", [])
    spot = num(q[0].get("last")) if q else None
    if not spot and q:
        bid, ask = num(q[0].get("bid")), num(q[0].get("ask"))
        spot = (bid + ask) / 2 if bid and ask else None

    exps = sorted(call("POST", f"{md}/option-expirations", token, {"instrument": inst}).get("expirations", []))[: a.max_exp]
    if not exps:
        sys.exit(f"Public returned no option expirations for {tk}")

    contracts = {}  # osi -> row
    for exp in exps:
        ch = call("POST", f"{md}/option-chain", token, {"instrument": inst, "expirationDate": exp})
        for side in ("calls", "puts"):
            for o in ch.get(side, []):
                osi = (o.get("instrument") or {}).get("symbol", "")
                m = OSI.match(osi.replace("-OPTION", ""))
                oi = num(o.get("openInterest"))
                if not m or not oi:
                    continue
                d = m.group(2)
                contracts[osi] = {"symbol": tk, "strike": int(m.group(4)) / 1000,
                                  "expiration": f"20{d[:2]}-{d[2:4]}-{d[4:]}", "type": m.group(3),
                                  "open_interest": int(oi), "iv": "", "gamma": "",
                                  "underlying_price": spot or ""}
                gk = (o.get("optionDetails") or {}).get("greeks") or {}  # the chain already carries greeks
                gm, iv = num(gk.get("gamma")), num(gk.get("impliedVolatility"))
                if gm and gm > 0:
                    contracts[osi]["gamma"] = gm
                if iv and iv > 0:
                    contracts[osi]["iv"] = iv

    # backfill missing greeks in small batches; the endpoint takes repeated osiSymbols params
    # and rejects long URLs with HTTP 400
    syms = [k for k, r in contracts.items() if r["gamma"] == "" and r["iv"] == ""]
    got = len(contracts) - len(syms)
    for i in range(0, len(syms), 50):
        r = call("GET", f"/userapigateway/option-details/{acct}/greeks", token,
                 params={"osiSymbols": syms[i:i + 50]})
        for g in r.get("greeks", []):
            row = contracts.get(g.get("symbol"))
            gk = g.get("greeks") or {}
            if row is None:
                continue
            gm, iv = num(gk.get("gamma")), num(gk.get("impliedVolatility"))
            row["gamma"] = gm if gm and gm > 0 else ""
            row["iv"] = iv if iv and iv > 0 else ""
            got += 1

    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"gex_{tk}_{datetime.now(timezone.utc):%Y%m%d-%H%M}.csv")
    cols = ["symbol", "strike", "expiration", "type", "open_interest", "iv", "gamma", "underlying_price"]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(sorted(contracts.values(), key=lambda r: (r["expiration"], r["strike"], r["type"])))
    print(f"{path}\n{len(contracts)} contracts, {len(exps)} expirations ({exps[0]} to {exps[-1]}), "
          f"spot {spot}, greeks for {got}")


if __name__ == "__main__":
    main()
