"""
macro_pulse_pipeline.py
========================
Daily data pipeline for Macro Pulse.
Pulls from FRED API and Yahoo Finance, writes data.json for the frontend.

SETUP
-----
1. Get a free FRED API key at: https://fredaccount.stlouisfed.org/login/secure/
2. pip install requests yfinance pandas python-dotenv
3. Add FRED_API_KEY=your_key to a .env file (never commit this)
4. Run manually or schedule with GitHub Actions (see workflow at bottom)

OUTPUT
------
Writes /public/data.json — the single source of truth for the frontend.
The React app reads this file on load instead of using hardcoded values.
"""

import json
import os
import requests
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
FRED_KEY = os.getenv("FRED_API_KEY")
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
TODAY = datetime.today().strftime("%Y-%m-%d")
TWO_YEARS_AGO = (datetime.today() - timedelta(days=730)).strftime("%Y-%m-%d")
TEN_YEARS_AGO = (datetime.today() - timedelta(days=3650)).strftime("%Y-%m-%d")


# ── FRED HELPERS ──────────────────────────────────────────────────────────────

def fred(series_id, start=TWO_YEARS_AGO, end=TODAY, frequency=None):
    """Fetch a FRED series. Returns list of {date, value} dicts, or [] on error."""
    params = {
        "series_id": series_id,
        "api_key": FRED_KEY,
        "file_type": "json",
        "observation_start": start,
        "observation_end": end,
        "sort_order": "asc",
    }
    if frequency:
        params["frequency"] = frequency
        params["aggregation_method"] = "avg"

    try:
        r = requests.get(FRED_URL, params=params)
        r.raise_for_status()
        obs = r.json().get("observations", [])
        return [
            {"date": o["date"], "value": float(o["value"])}
            for o in obs if o["value"] != "."
        ]
    except Exception as e:
        print(f"⚠️  FRED series {series_id} failed: {e}")
        return []


def fred_latest(series_id):
    """Return the single most recent value for a series."""
    data = fred(series_id)
    return data[-1] if data else None


def fred_prev(series_id):
    """Return the second-to-last value (for 'prev' comparisons)."""
    data = fred(series_id)
    return data[-2] if len(data) >= 2 else None


# ── YAHOO FINANCE HELPERS ──────────────────────────────────────────────────────

def yf_latest(ticker, field="Close"):
    """Return the latest closing price for a ticker."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="5d")
        if hist.empty:
            return None
        return round(hist[field].iloc[-1], 4)
    except Exception as e:
        print(f"  ⚠ Yahoo Finance error for {ticker}: {e}")
        return None


def yf_change_pct(ticker, period="1d"):
    """Return % change over the given period."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="5d")
        if len(hist) < 2:
            return None
        close = hist["Close"]
        return round((close.iloc[-1] / close.iloc[-2] - 1) * 100, 2)
    except Exception as e:
        print(f"  ⚠ yf_change_pct error for {ticker}: {e}")
        return None


def yf_series(ticker, start=TWO_YEARS_AGO, field="Close"):
    """Return a time series as list of {date, value} dicts."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(start=start, end=TODAY)
        if hist.empty:
            return []
        return [
            {"date": str(d.date()), "value": round(v, 4)}
            for d, v in hist[field].items()
        ]
    except Exception as e:
        print(f"  ⚠ yf_series error for {ticker}: {e}")
        return []


# ── SCORING ENGINE ────────────────────────────────────────────────────────────

def compute_cycle(metrics):
    """
    Compute growth/inflation scores and quadrant from live metrics.
    Each signal contributes a weighted growth score and inflation score.
    Returns: { growth, inflation, quadrant, confidence }
    """
    signals = []

    # --- Growth signals ---
    # Yield curve (2s10s): negative = growth headwind
    if metrics.get("yield_curve_spread") is not None:
        spread = metrics["yield_curve_spread"]
        g = max(-1, min(1, spread / 2))  # normalise: -2% maps to -1, +2% maps to +1
        signals.append({"growth": g, "inflation": 0.0, "weight": 1.5})

    # ISM Manufacturing: <50 = contraction
    if metrics.get("ism_manufacturing") is not None:
        ism = metrics["ism_manufacturing"]
        g = max(-1, min(1, (ism - 50) / 10))
        signals.append({"growth": g, "inflation": 0.2, "weight": 1.2})

    # Initial claims: higher = worse growth
    if metrics.get("initial_claims_latest") is not None:
        claims = metrics["initial_claims_latest"]
        g = max(-1, min(1, -(claims - 220) / 80))  # 220k neutral
        signals.append({"growth": g, "inflation": 0.0, "weight": 1.0})

    # Unemployment trend
    if metrics.get("unemployment_latest") is not None:
        ue = metrics["unemployment_latest"]
        g = max(-1, min(1, -(ue - 4.0) / 1.5))  # 4% neutral
        signals.append({"growth": g, "inflation": 0.0, "weight": 0.8})

    # Copper/Gold ratio: falling = growth concern
    if metrics.get("copper_gold_ratio") is not None:
        cg = metrics["copper_gold_ratio"]
        # Historically ~0.45 is neutral; below = growth concern
        g = max(-1, min(1, (cg - 0.45) / 0.2))
        signals.append({"growth": g, "inflation": 0.0, "weight": 0.9})

    # HY spread: wider = growth concern
    if metrics.get("hy_spread_latest") is not None:
        hy = metrics["hy_spread_latest"]
        g = max(-1, min(1, -(hy - 3.5) / 2.0))  # 3.5% neutral
        signals.append({"growth": g, "inflation": 0.1, "weight": 1.0})

    # --- Inflation signals ---
    # Core PCE: above 2% = inflationary
    if metrics.get("core_pce_latest") is not None:
        pce = metrics["core_pce_latest"]
        infl = max(-1, min(1, (pce - 2.0) / 1.5))
        signals.append({"growth": 0.0, "inflation": infl, "weight": 1.5})

    # 10Y Breakeven: above 2% = inflationary expectations
    if metrics.get("breakeven_10y_latest") is not None:
        be = metrics["breakeven_10y_latest"]
        infl = max(-1, min(1, (be - 2.0) / 1.0))
        signals.append({"growth": 0.0, "inflation": infl, "weight": 1.0})

    # Real yield: high real yield = tightening (mixed signal)
    if metrics.get("real_yield_10y_latest") is not None:
        ry = metrics["real_yield_10y_latest"]
        infl = max(-1, min(1, -(ry - 1.5) / 1.0))  # high real yield = lower inflation expectations
        signals.append({"growth": -0.2, "inflation": infl, "weight": 1.0})

    if not signals:
        return {"growth": 0, "inflation": 0, "quadrant": "goldilocks", "confidence": 0}

    total_w = sum(s["weight"] for s in signals)
    avg_growth = sum(s["growth"] * s["weight"] for s in signals) / total_w
    avg_inflation = sum(s["inflation"] * s["weight"] for s in signals) / total_w

    # Determine quadrant
    if avg_growth < 0 and avg_inflation > 0:
        quadrant = "stagflation"
    elif avg_growth > 0 and avg_inflation > 0:
        quadrant = "boom"
    elif avg_growth > 0 and avg_inflation < 0:
        quadrant = "goldilocks"
    else:
        quadrant = "bust"

    # Confidence: fraction of signals agreeing with quadrant
    def signal_quadrant(s):
        if s["growth"] < 0 and s["inflation"] > 0: return "stagflation"
        if s["growth"] > 0 and s["inflation"] > 0: return "boom"
        if s["growth"] > 0 and s["inflation"] < 0: return "goldilocks"
        return "bust"

    agreeing = sum(1 for s in signals if signal_quadrant(s) == quadrant)
    confidence = round(agreeing / len(signals) * 100)

    return {
        "growth": round(avg_growth, 3),
        "inflation": round(avg_inflation, 3),
        "quadrant": quadrant,
        "confidence": confidence,
    }


# ── MAIN PIPELINE ─────────────────────────────────────────────────────────────

def build_data():
    print(f"\n🔄 Macro Pulse pipeline — {TODAY}\n")
    data = {}

    # ── SENTIMENT ────────────────────────────────────────────────────────────
    print("📊 Fetching sentiment metrics...")

    # VIX (Yahoo Finance: ^VIX)
    data["vix_latest"] = yf_latest("^VIX")
    data["vix_prev"]   = None  # will calculate below from series

    # Equity flows proxy: SPY net flows (simplified via price action + volume)
    # In production: use ICI weekly flow data (scraped from ici.org)
    # For now, we leave a placeholder
    data["equity_flows_4w"] = None  # TODO: scrape ICI

    # AAII Bull-Bear spread: from AAII website (scraped weekly)
    # https://www.aaii.com/sentimentsurvey/sent_results
    # TODO: implement scraper — leave placeholder
    data["aaii_bull_bear"] = None

    # Put/Call ratio: CBOE daily data
    # https://www.cboe.com/us/options/market_statistics/daily/
    # TODO: implement scraper — leave placeholder
    data["put_call_ratio"] = None

    # NAAIM: scraped from naaim.org weekly
    # TODO: implement scraper — leave placeholder
    data["naaim_exposure"] = None

    # Money market fund assets: FRED WRMFNS (WRMFSL was discontinued 2021)
    mmf = fred_latest("WRMFNS")
    data["money_market_aum_latest"] = round(mmf["value"] / 1000, 2) if mmf else None  # convert to trillions
    mmf_prev = fred_prev("WRMFNS")
    data["money_market_aum_prev"]   = round(mmf_prev["value"] / 1000, 2) if mmf_prev else None

    # Margin debt: FINRA — scraped from finra.org/investors/margin-statistics
    # TODO: implement scraper — leave placeholder
    data["margin_debt"] = None

    # ── VALUATIONS ───────────────────────────────────────────────────────────
    print("📊 Fetching valuation metrics...")

    # Treasury yields: FRED
    y2  = fred_latest("DGS2");   data["yield_2y_latest"]  = y2["value"]  if y2  else None
    y10 = fred_latest("DGS10");  data["yield_10y_latest"] = y10["value"] if y10 else None
    y30 = fred_latest("DGS30");  data["yield_30y_latest"] = y30["value"] if y30 else None

    y2p  = fred_prev("DGS2");  data["yield_2y_prev"]  = y2p["value"]  if y2p  else None
    y10p = fred_prev("DGS10"); data["yield_10y_prev"] = y10p["value"] if y10p else None

    # Yield curve spread (2s10s)
    if data["yield_2y_latest"] and data["yield_10y_latest"]:
        data["yield_curve_spread"] = round(data["yield_10y_latest"] - data["yield_2y_latest"], 3)
    else:
        data["yield_curve_spread"] = None

    # 10Y Real yield (TIPS): FRED DFII10
    ry = fred_latest("DFII10"); data["real_yield_10y_latest"] = ry["value"] if ry else None
    ryp = fred_prev("DFII10");  data["real_yield_10y_prev"]   = ryp["value"] if ryp else None

    # 10Y Breakeven inflation: FRED T10YIE
    be = fred_latest("T10YIE"); data["breakeven_10y_latest"] = be["value"] if be else None
    bep = fred_prev("T10YIE");  data["breakeven_10y_prev"]   = bep["value"] if bep else None

    # IG & HY credit spreads: FRED
    ig = fred_latest("BAMLC0A0CM");  data["ig_spread_latest"] = ig["value"]  if ig  else None
    hy = fred_latest("BAMLH0A0HYM2");data["hy_spread_latest"] = hy["value"]  if hy  else None
    igp = fred_prev("BAMLC0A0CM");   data["ig_spread_prev"]   = igp["value"] if igp else None
    hyp = fred_prev("BAMLH0A0HYM2"); data["hy_spread_prev"]   = hyp["value"] if hyp else None

    # S&P 500 and DXY from Yahoo Finance
    data["sp500_latest"]    = yf_latest("^GSPC")
    data["sp500_chg_pct"]   = yf_change_pct("^GSPC")
    data["dxy_latest"]      = yf_latest("DX-Y.NYB")
    data["dxy_chg_pct"]     = yf_change_pct("DX-Y.NYB")
    data["gold_latest"]     = yf_latest("GC=F")
    data["wti_latest"]      = yf_latest("CL=F")
    data["wti_chg_pct"]     = yf_change_pct("CL=F")
    data["btc_latest"]      = yf_latest("BTC-USD")
    data["btc_chg_pct"]     = yf_change_pct("BTC-USD")

    # Copper/Gold ratio
    copper = yf_latest("HG=F")
    gold   = yf_latest("GC=F")
    if copper and gold:
        data["copper_gold_ratio"] = round(copper / gold, 4)
    else:
        data["copper_gold_ratio"] = None

    # S&P 500 forward P/E: not freely available via API
    # Best free source: scrape from multpl.com or use Quandl/Nasdaq Data Link
    # TODO: implement scraper — leave placeholder
    data["sp500_fwd_pe"] = None

    # Equity Risk Premium: calculated from fwd P/E and real yield
    if data["sp500_fwd_pe"] and data["real_yield_10y_latest"]:
        earnings_yield = 1 / data["sp500_fwd_pe"] * 100
        data["equity_risk_premium"] = round(earnings_yield - data["real_yield_10y_latest"], 2)
    else:
        data["equity_risk_premium"] = None

    # ── FUNDAMENTALS ─────────────────────────────────────────────────────────
    print("📊 Fetching fundamental metrics...")

    # Real GDP growth (quarterly, annualised): FRED A191RL1Q225SBEA
    gdp = fred_latest("A191RL1Q225SBEA")
    data["gdp_qoq_latest"] = gdp["value"] if gdp else None
    gdp_p = fred_prev("A191RL1Q225SBEA")
    data["gdp_qoq_prev"]   = gdp_p["value"] if gdp_p else None

    # Core PCE: FRED PCEPILFE (YoY)
    pce = fred_latest("PCEPILFE")
    # Calculate YoY
    pce_series = fred("PCEPILFE", start=TEN_YEARS_AGO)
    if len(pce_series) >= 12:
        latest_pce = pce_series[-1]["value"]
        year_ago_pce = pce_series[-13]["value"]
        data["core_pce_latest"] = round((latest_pce / year_ago_pce - 1) * 100, 2)
        prev_pce = pce_series[-2]["value"]
        year_ago_prev = pce_series[-14]["value"]
        data["core_pce_prev"]   = round((prev_pce / year_ago_prev - 1) * 100, 2)
    else:
        data["core_pce_latest"] = None
        data["core_pce_prev"]   = None

    # Headline CPI: FRED CPIAUCSL (YoY)
    cpi_series = fred("CPIAUCSL", start=TEN_YEARS_AGO)
    if len(cpi_series) >= 13:
        data["cpi_latest"] = round((cpi_series[-1]["value"] / cpi_series[-13]["value"] - 1) * 100, 2)
        data["cpi_prev"]   = round((cpi_series[-2]["value"] / cpi_series[-14]["value"] - 1) * 100, 2)
    else:
        data["cpi_latest"] = None
        data["cpi_prev"]   = None

    # Unemployment rate: FRED UNRATE
    ue = fred_latest("UNRATE"); data["unemployment_latest"] = ue["value"] if ue else None
    uep = fred_prev("UNRATE");  data["unemployment_prev"]   = uep["value"] if uep else None

    # Initial jobless claims (weekly): FRED ICSA
    claims = fred_latest("ICSA"); data["initial_claims_latest"] = int(claims["value"]) if claims else None
    claimsp = fred_prev("ICSA");  data["initial_claims_prev"]   = int(claimsp["value"]) if claimsp else None

    # Fed Funds effective rate: FRED DFF
    ff = fred_latest("DFF"); data["fed_funds_latest"] = ff["value"] if ff else None

    # M2 money supply: FRED M2SL
    m2_series = fred("M2SL", start=TEN_YEARS_AGO)
    if len(m2_series) >= 13:
        data["m2_yoy"] = round((m2_series[-1]["value"] / m2_series[-13]["value"] - 1) * 100, 2)
    else:
        data["m2_yoy"] = None

    # Conference Board LEI: FRED USALOLITONOSTSAM
    lei = fred_latest("USALOLITONOSTSAM")
    data["lei_latest"] = lei["value"] if lei else None

    # ISM Manufacturing: not on FRED — TODO scrape from ismworld.org
    data["ism_manufacturing"] = None
    data["ism_services"]      = None

    # ── TIME SERIES FOR CHARTS ────────────────────────────────────────────────
    print("📈 Fetching chart series...")

    # GDP components: FRED quarterly series
    data["gdp_chart"] = {
        "consumption":  fred("PCEC96",   start=TEN_YEARS_AGO, frequency="q"),
        "investment":   fred("GPDIC1",   start=TEN_YEARS_AGO, frequency="q"),
        "govt":         fred("GCE",      start=TEN_YEARS_AGO, frequency="q"),
        "net_exports":  fred("NETEXC",   start=TEN_YEARS_AGO, frequency="q"),
    }

    # CPI components: FRED monthly (index levels — frontend calculates YoY)
    data["cpi_chart"] = {
        "shelter":    fred("CUSR0000SAH1",  start=TWO_YEARS_AGO),
        "supercore":  fred("CUSR0000SASLE", start=TWO_YEARS_AGO),  # services less shelter
        "energy":     fred("CPIENGSL",       start=TWO_YEARS_AGO),
        "food":       fred("CUSR0000SAF",   start=TWO_YEARS_AGO),
        "goods":      fred("CUSR0000SACL1E",start=TWO_YEARS_AGO),  # commodities less food and energy
    }

    # Yield time series
    data["yield_chart"] = {
        "y2":    fred("DGS2",    start=TWO_YEARS_AGO),
        "y10":   fred("DGS10",   start=TWO_YEARS_AGO),
        "real10":fred("DFII10",  start=TWO_YEARS_AGO),
        "hy":    fred("BAMLH0A0HYM2", start=TWO_YEARS_AGO),
        "be10":  fred("T10YIE",  start=TWO_YEARS_AGO),
    }

    # ── GLOBAL SNAPSHOT ───────────────────────────────────────────────────────
    print("🌍 Fetching global data...")
    # US: already have from above
    # ECB/BOE/BOJ rates: FRED
    data["global"] = {
        "ecb_rate": fred_latest("ECBDFR"),    # ECB deposit facility rate
        "boe_rate": fred_latest("BOERUKM"),    # Bank of England base rate
        "boj_rate": None,                      # TODO: scrape BOJ
        "eu_cpi":   None,                      # TODO: Eurostat
        "uk_cpi":   None,                      # TODO: ONS
    }

    # ── CYCLE SCORING ─────────────────────────────────────────────────────────
    print("🔄 Computing cycle position...")
    data["cycle"] = compute_cycle(data)

    # ── METADATA ──────────────────────────────────────────────────────────────
    data["last_updated"] = datetime.utcnow().isoformat() + "Z"
    data["data_note"] = "Live data from FRED API and Yahoo Finance. Some metrics (ISM, AAII, Put/Call, NAAIM, margin debt) are pending scraper implementation and fall back to hardcoded demo values."

    return data


def main():
    data = build_data()

    # Write to public/data.json (served as static file by Vercel/Netlify)
    os.makedirs("public", exist_ok=True)
    output_path = "public/data.json"
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"\n✅ Written to {output_path}")
    print(f"   Cycle: {data['cycle']['quadrant']} ({data['cycle']['confidence']}% confidence)")
    print(f"   10Y yield: {data.get('yield_10y_latest')}%")
    print(f"   Core PCE: {data.get('core_pce_latest')}%")
    print(f"   Unemployment: {data.get('unemployment_latest')}%")
    print(f"   Last updated: {data['last_updated']}\n")


if __name__ == "__main__":
    main()


# ── GITHUB ACTIONS WORKFLOW ───────────────────────────────────────────────────
# Save as .github/workflows/data-pipeline.yml in your repo:
#
# name: Daily Data Refresh
# on:
#   schedule:
#     - cron: '0 7 * * 1-5'   # 7am UTC weekdays (after US market open data updates)
#   workflow_dispatch:          # allow manual trigger
#
# jobs:
#   refresh:
#     runs-on: ubuntu-latest
#     steps:
#       - uses: actions/checkout@v4
#       - uses: actions/setup-python@v5
#         with:
#           python-version: '3.11'
#       - run: pip install requests yfinance pandas python-dotenv
#       - run: python macro_pulse_pipeline.py
#         env:
#           FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
#       - name: Commit and push data.json
#         run: |
#           git config user.name "macro-pulse-bot"
#           git config user.email "bot@macropulse.io"
#           git add public/data.json
#           git diff --cached --quiet || git commit -m "chore: daily data refresh $(date -u +%Y-%m-%d)"
#           git push
