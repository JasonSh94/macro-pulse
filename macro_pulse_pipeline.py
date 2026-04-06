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
from bs4 import BeautifulSoup

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


# ── WEB SCRAPERS ──────────────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def scrape_aaii_sentiment():
    """
    Scrape AAII weekly sentiment survey.
    Returns {bull, neutral, bear, spread} or None on failure.
    """
    try:
        r = requests.get(
            "https://www.aaii.com/sentimentsurvey/sent_results",
            headers=_HEADERS, timeout=20
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            for row in rows[1:]:
                cells = [c.get_text(strip=True).replace("%", "") for c in row.find_all("td")]
                if len(cells) >= 4:
                    try:
                        bull    = round(float(cells[1]), 1)
                        neutral = round(float(cells[2]), 1)
                        bear    = round(float(cells[3]), 1)
                        spread  = round(bull - bear, 1)
                        print(f"  AAII: Bull {bull}%  Bear {bear}%  Spread {spread:+.1f}pts")
                        return {"bull": bull, "neutral": neutral, "bear": bear, "spread": spread}
                    except (ValueError, IndexError):
                        continue
        print("⚠️  AAII: could not parse table")
        return None
    except Exception as e:
        print(f"⚠️  AAII scrape failed: {e}")
        return None


def scrape_put_call_ratio():
    """
    Fetch equity put/call ratio.
    Primary: yfinance SPY options (sum across 3 nearest expirations).
    Fallback: CBOE CDN CSV (often stale/blocked but kept as secondary attempt).
    Returns ratio (float) or None.
    """
    # Primary: SPY options via yfinance
    try:
        import yfinance as yf
        spy = yf.Ticker("SPY")
        exps = spy.options
        if exps:
            total_puts, total_calls = 0, 0
            for exp in exps[:3]:  # nearest 3 expirations for representative volume
                try:
                    chain = spy.option_chain(exp)
                    total_puts  += chain.puts['volume'].fillna(0).sum()
                    total_calls += chain.calls['volume'].fillna(0).sum()
                except Exception:
                    continue
            if total_calls > 0 and total_puts > 0:
                ratio = round(total_puts / total_calls, 2)
                print(f"  Put/Call ratio (SPY options): {ratio}")
                return ratio
    except Exception as e:
        print(f"⚠️  Put/call (yfinance): {e}")

    # Fallback: CBOE CDN CSV
    urls = [
        "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv",
        "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv",
    ]
    cutoff = datetime.today() - timedelta(days=60)
    for url in urls:
        try:
            r = requests.get(url, headers=_HEADERS, timeout=15)
            if r.status_code != 200:
                continue
            lines = [l.strip() for l in r.text.strip().splitlines() if l.strip()]
            for line in reversed(lines):
                parts = [p.strip() for p in line.split(",")]
                try:
                    date_str = parts[0]
                    row_date = datetime.strptime(date_str, "%m/%d/%Y")
                    if row_date < cutoff:
                        break
                    if len(parts) >= 5:
                        val = float(parts[4])
                    elif len(parts) >= 3:
                        calls, puts = float(parts[1]), float(parts[2])
                        val = round(puts / calls, 2) if calls > 0 else None
                    else:
                        continue
                    if val and 0.1 < val < 5.0:
                        print(f"  Put/Call ratio (CBOE CSV): {val}  ({date_str})")
                        return round(val, 2)
                except (ValueError, IndexError):
                    continue
        except Exception as e:
            print(f"⚠️  Put/call CBOE ({url}): {e}")
    print("⚠️  Put/call ratio: all sources failed — returning None")
    return None


def scrape_margin_debt():
    """
    Fetch latest NYSE margin debt from FINRA monthly statistics page.
    Returns debit balance in billions USD (float) or None.
    FINRA reports values in millions of dollars.
    """
    try:
        from bs4 import BeautifulSoup
        r = requests.get(
            "https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics",
            headers=_HEADERS, timeout=15
        )
        if r.status_code != 200:
            print(f"⚠️  Margin debt: FINRA returned {r.status_code}")
            return None
        soup = BeautifulSoup(r.text, "html.parser")
        table = soup.find("table")
        if not table:
            print("⚠️  Margin debt: no table found on FINRA page")
            return None
        # First data row = most recent month; col 1 = debit balance (millions $)
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) >= 2:
                try:
                    val_millions = float(cells[1].replace(",", ""))
                    val_billions = round(val_millions / 1000, 1)
                    print(f"  Margin debt ({cells[0]}): ${val_billions}B")
                    return val_billions
                except ValueError:
                    continue
        print("⚠️  Margin debt: could not parse FINRA table")
        return None
    except Exception as e:
        print(f"⚠️  Margin debt scrape failed: {e}")
        return None


def fetch_sp500_pe():
    """
    Fetch S&P 500 trailing 12-month P/E ratio via yfinance (SPY ETF).
    Returns P/E as float or None.
    """
    try:
        import yfinance as yf
        spy = yf.Ticker("SPY")
        pe = spy.info.get("trailingPE")
        if pe and 5 < pe < 100:
            print(f"  S&P 500 trailing P/E: {pe:.1f}")
            return round(float(pe), 1)
        return None
    except Exception as e:
        print(f"⚠️  S&P P/E fetch failed: {e}")
        return None


def fetch_fear_greed():
    """
    Fetch CNN Fear & Greed index score (0–100).
    Returns float or None.
    """
    try:
        r = requests.get(
            "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
            headers={**_HEADERS, "Referer": "https://www.cnn.com/", "Origin": "https://www.cnn.com"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        score = data.get("fear_and_greed", {}).get("score")
        if score is not None:
            print(f"  Fear & Greed: {score}")
            return round(float(score), 1)
        return None
    except Exception as e:
        print(f"⚠️  Fear & Greed fetch failed: {e}")
        return None


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

    # Manufacturing activity (ISM PMI or Philly Fed proxy)
    # ISM-scale: 50-centred (range ~40-65). Philly Fed: 0-centred (range ~-50 to +50).
    # Detect scale by value range and normalise to -1/+1 accordingly.
    if metrics.get("ism_manufacturing") is not None:
        ism = metrics["ism_manufacturing"]
        if -30 <= ism <= 30:   # Philly Fed / 0-centred diffusion index
            g = max(-1, min(1, ism / 25))
        else:                   # ISM-style 50-centred
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

    # VIX (Yahoo Finance: ^VIX) — latest + prev from series
    vix_series = yf_series("^VIX")
    data["vix_latest"] = round(vix_series[-1]["value"], 2) if vix_series else None
    data["vix_prev"]   = round(vix_series[-2]["value"], 2) if len(vix_series) >= 2 else None

    # CNN Fear & Greed index (0–100)
    data["fear_greed"] = fetch_fear_greed()

    # AAII Bull-Bear spread (scraped weekly from aaii.com)
    aaii = scrape_aaii_sentiment()
    data["aaii_bull"]    = aaii["bull"]    if aaii else None
    data["aaii_neutral"] = aaii["neutral"] if aaii else None
    data["aaii_bear"]    = aaii["bear"]    if aaii else None
    data["aaii_spread"]  = aaii["spread"]  if aaii else None   # bull minus bear, in pts

    # Put/Call ratio: CBOE equity options
    data["put_call_ratio"] = scrape_put_call_ratio()

    # Equity flows & NAAIM: TODO scrapers
    data["equity_flows_4w"] = None
    data["naaim_exposure"]  = None

    # Money market fund assets: FRED WRMFNS (WRMFSL was discontinued 2021)
    mmf = fred_latest("WRMFNS")
    data["money_market_aum_latest"] = round(mmf["value"] / 1000, 2) if mmf else None  # convert to trillions
    mmf_prev = fred_prev("WRMFNS")
    data["money_market_aum_prev"]   = round(mmf_prev["value"] / 1000, 2) if mmf_prev else None

    # Margin debt: FINRA monthly statistics (billions USD)
    data["margin_debt"] = scrape_margin_debt()

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

    # S&P 500 trailing P/E via yfinance (SPY); forward P/E not freely available
    data["sp500_fwd_pe"] = fetch_sp500_pe()

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

    # Conference Board LEI: FRED USALOLITONOSTSAM — compute YoY %
    lei_series = fred("USALOLITONOSTSAM", start=TEN_YEARS_AGO)
    if len(lei_series) >= 14:
        data["lei_yoy"]      = round((lei_series[-1]["value"] / lei_series[-13]["value"] - 1) * 100, 2)
        data["lei_prev_yoy"] = round((lei_series[-2]["value"] / lei_series[-14]["value"] - 1) * 100, 2)
    else:
        data["lei_yoy"]      = None
        data["lei_prev_yoy"] = None

    # Manufacturing activity proxy: Philadelphia Fed General Activity Diffusion Index (SA, monthly)
    # FRED: GACDFSA066MSFRBPHI — 0-centred; >0 = expansion, <0 = contraction.
    # ISM Manufacturing PMI is proprietary (not on FRED); Philly Fed is the best free substitute.
    # The cycle-scoring engine normalises whichever scale is detected (see compute_cycle).
    philly = fred_latest("GACDFSA066MSFRBPHI")
    data["ism_manufacturing"] = philly["value"] if philly else None
    philly_p = fred_prev("GACDFSA066MSFRBPHI")
    data["ism_manufacturing_prev"] = philly_p["value"] if philly_p else None
    data["ism_source"] = "Philly Fed" if philly else None

    # ISM Services: no reliable free FRED series — TODO scrape ismworld.org
    data["ism_services"] = None

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
        "food":       fred("CPIFABSL",       start=TWO_YEARS_AGO),  # CPI: Food and Beverages SA
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
