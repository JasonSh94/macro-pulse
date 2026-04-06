import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ── FONTS ─────────────────────────────────────────────────────────────────────
function GoogleFonts() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(l);
  }, []);
  return null;
}

const DARK_C = {
  bg: "#080910", surface: "#0c0e17", card: "#10121d", border: "#1c1f32", borderBright: "#2a2e4a",
  text: "#dde1f0", muted: "#5a6080", dim: "#2e3250",
  amber: "#e8a020", amberDim: "#e8a02018", green: "#27c87e", greenDim: "#27c87e18",
  red: "#e8445a", redDim: "#e8445a18", blue: "#4a94f0", purple: "#9068f0",
};
const LIGHT_C = {
  bg: "#f0f2f8", surface: "#ffffff", card: "#f5f6fb", border: "#dde1ef", borderBright: "#c0c5db",
  text: "#1a1d2e", muted: "#6b7094", dim: "#c0c5d8",
  amber: "#c97a00", amberDim: "#e8a02018", green: "#1a9e60", greenDim: "#27c87e18",
  red: "#cc2a3e", redDim: "#e8445a18", blue: "#2a6fd4", purple: "#6a48d4",
};
let C = { ...DARK_C };
const BOLD = "'Bricolage Grotesque', system-ui, sans-serif";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace"; // chart axes + table numerics only
let AXIS_TICK = { fontSize: 16, fill: C.muted, fontFamily: MONO };
let TT_STYLE  = { backgroundColor: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 6, fontSize: 19, fontFamily: SANS, color: C.text };

// ── LIVE DATA HOOK ────────────────────────────────────────────────────────────
/**
 * Fetches /public/data.json (written by macro_pulse_pipeline.py).
 * Falls back to null — components use hardcoded demo values when null.
 * Shows a "LIVE" badge and last-updated time when data is fresh.
 */
function useLiveData() {
  const [live, setLive] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | live | demo

  useEffect(() => {
    fetch("/data.json")
      .then(r => { if (!r.ok) throw new Error("no data.json"); return r.json(); })
      .then(d => { setLive(d); setStatus("live"); })
      .catch(() => setStatus("demo"));
  }, []);

  return { live, status };
}

/**
 * Resolve a metric value: use live data if available, else demo fallback.
 * liveVal  — value from data.json (may be null)
 * demoVal  — hardcoded string shown in demo mode
 */
function resolve(liveVal, demoVal, transform = v => String(v)) {
  if (liveVal != null) return transform(liveVal);
  return demoVal;
}

// ── SCORING ENGINE ─────────────────────────────────────────────────────────────
// Used when live data is available; otherwise falls back to DEMO_SCORES.
function computeCycleFromLive(d) {
  const signals = [];
  const add = (growth, inflation, weight) => signals.push({ growth, inflation, weight });

  if (d.yield_curve_spread != null) add(Math.max(-1, Math.min(1, d.yield_curve_spread / 2)), 0.0, 1.5);
  if (d.ism_manufacturing   != null) { const v = d.ism_manufacturing; add(Math.max(-1, Math.min(1, Math.abs(v) <= 30 ? v / 25 : (v - 50) / 10)), 0.2, 1.2); }
  if (d.initial_claims_latest != null) add(Math.max(-1, Math.min(1, -(d.initial_claims_latest - 220000) / 80000)), 0.0, 1.0);
  if (d.unemployment_latest != null) add(Math.max(-1, Math.min(1, -(d.unemployment_latest - 4.0) / 1.5)), 0.0, 0.8);
  if (d.copper_gold_ratio   != null) add(Math.max(-1, Math.min(1, (d.copper_gold_ratio - 0.45) / 0.2)), 0.0, 0.9);
  if (d.hy_spread_latest    != null) add(Math.max(-1, Math.min(1, -(d.hy_spread_latest - 3.5) / 2.0)), 0.1, 1.0);
  if (d.core_pce_latest     != null) add(0.0, Math.max(-1, Math.min(1, (d.core_pce_latest - 2.0) / 1.5)), 1.5);
  if (d.breakeven_10y_latest!= null) add(0.0, Math.max(-1, Math.min(1, (d.breakeven_10y_latest - 2.0) / 1.0)), 1.0);
  if (d.real_yield_10y_latest!=null) add(-0.2, Math.max(-1, Math.min(1, -(d.real_yield_10y_latest - 1.5) / 1.0)), 1.0);

  if (!signals.length) return null;
  const totalW = signals.reduce((a, s) => a + s.weight, 0);
  const growth    = signals.reduce((a, s) => a + s.growth    * s.weight, 0) / totalW;
  const inflation = signals.reduce((a, s) => a + s.inflation * s.weight, 0) / totalW;
  const quadrant  = growth < 0 && inflation > 0 ? "stagflation"
    : growth > 0 && inflation > 0 ? "boom"
    : growth > 0 && inflation < 0 ? "goldilocks" : "bust";
  const agreeing  = signals.filter(s => {
    const q = s.growth < 0 && s.inflation > 0 ? "stagflation" : s.growth > 0 && s.inflation > 0 ? "boom"
      : s.growth > 0 && s.inflation < 0 ? "goldilocks" : "bust";
    return q === quadrant;
  }).length;
  return { growth: +growth.toFixed(3), inflation: +inflation.toFixed(3), quadrant, confidence: Math.round(agreeing / signals.length * 100) };
}

// Demo scores (used when data.json not available)
const DEMO_SCORES = [
  { growth: -0.4, inflation: 0.1, w: 1.5 }, { growth: -0.7, inflation: 0.0, w: 1.5 },
  { growth: -0.5, inflation: 0.2, w: 1.2 }, { growth: -0.2, inflation: 0.3, w: 1.2 },
  { growth: -0.3, inflation: 0.1, w: 1.0 }, { growth: -0.4, inflation: 0.0, w: 0.8 },
  { growth: 0.0,  inflation: 0.7, w: 1.5 }, { growth: 0.0,  inflation: 0.6, w: 1.3 },
  { growth: 0.0,  inflation: 0.4, w: 1.0 }, { growth: 0.1,  inflation: 0.5, w: 1.0 },
  { growth: -0.6, inflation: 0.2, w: 1.2 }, { growth: -0.4, inflation: 0.1, w: 1.0 },
  { growth: -0.5, inflation: 0.0, w: 0.9 }, { growth: -0.3, inflation: 0.0, w: 0.8 },
  { growth: -0.2, inflation: 0.3, w: 1.0 }, { growth: -0.1, inflation: 0.2, w: 0.8 },
];
function computeCycleFromDemo() {
  const totalW    = DEMO_SCORES.reduce((a, s) => a + s.w, 0);
  const growth    = DEMO_SCORES.reduce((a, s) => a + s.growth    * s.w, 0) / totalW;
  const inflation = DEMO_SCORES.reduce((a, s) => a + s.inflation * s.w, 0) / totalW;
  const quadrant  = growth < 0 && inflation > 0 ? "stagflation"
    : growth > 0 && inflation > 0 ? "boom"
    : growth > 0 && inflation < 0 ? "goldilocks" : "bust";
  const agreeing  = DEMO_SCORES.filter(s => {
    const q = s.growth < 0 && s.inflation > 0 ? "stagflation" : s.growth > 0 && s.inflation > 0 ? "boom"
      : s.growth > 0 && s.inflation < 0 ? "goldilocks" : "bust";
    return q === quadrant;
  }).length;
  return { growth: +growth.toFixed(3), inflation: +inflation.toFixed(3), quadrant, confidence: Math.round(agreeing / DEMO_SCORES.length * 100) };
}

// ── QUADRANT METADATA ──────────────────────────────────────────────────────────
const QUADRANTS = {
  goldilocks:  { label: "Goldilocks",       sub: "Growth ↑  Inflation ↓", color: C.green,  alts: "Amplify",  altsDesc: "In Goldilocks, both legs of a traditional portfolio are working. Alternatives should amplify returns — think leveraged equity strategies, private equity, and event-driven funds that thrive in benign, low-vol environments. This is the regime to take more risk, not less." },
  boom:        { label: "Inflationary Boom",sub: "Growth ↑  Inflation ↑", color: C.amber,  alts: "Modify",   altsDesc: "In an inflationary boom, growth is still positive but inflation is eroding purchasing power. Alternatives should modify portfolio inflation exposure — think commodities, real assets, infrastructure, and macro funds long energy and materials." },
  stagflation: { label: "Stagflation",      sub: "Growth ↓  Inflation ↑", color: C.red,    alts: "Hedge",    altsDesc: "Stagflation is the most hostile regime for traditional 60/40 — bonds can't protect you because inflation keeps yields elevated, while equities suffer from slowing growth. The Hedge bucket means alternatives should protect capital: managed futures, global macro long/short, and long volatility strategies." },
  bust:        { label: "Deflationary Bust",sub: "Growth ↓  Inflation ↓", color: C.purple, alts: "Diversify",altsDesc: "In a deflationary bust, correlations across risk assets spike. Alternatives should provide genuine diversification — strategies with returns uncorrelated to markets, like equity market neutral, systematic multi-strat, and event-driven funds." },
};

// ── FACTOR DATA ────────────────────────────────────────────────────────────────
const STYLE_FACTORS = [
  { id: "value",        label: "Value",         favorable: ["boom","stagflation"], unfavorable: ["goldilocks"],        tip: "Cheap vs. expensive stocks. Inflation helps, but growth deceleration hurts cyclical value. Mixed in current regime." },
  { id: "momentum",     label: "Momentum",      favorable: ["goldilocks","boom"],  unfavorable: ["stagflation","bust"], tip: "Price winners continue to outperform. Breaks down sharply in volatile, regime-shifting environments like today." },
  { id: "quality",      label: "Quality",       favorable: ["stagflation","bust"], unfavorable: [],                    tip: "High ROE, stable earnings, low leverage. Classic defensive factor — most favored in the current stagflation regime." },
  { id: "growth_f",     label: "Growth",        favorable: ["goldilocks"],         unfavorable: ["stagflation","bust"], tip: "High earnings growth stocks. Crushed by rising real yields — 2%+ real yields are historically hostile to this factor." },
  { id: "smallcap",     label: "Small Cap",     favorable: ["goldilocks","boom"],  unfavorable: ["stagflation","bust"], tip: "Real premium over long run but highly cyclical. Underperforms during credit stress and growth deceleration — both present today." },
  { id: "minvol",       label: "Min Vol",       favorable: ["stagflation","bust"], unfavorable: ["boom"],              tip: "Low volatility stocks outperform in deteriorating environments. Well-supported by current risk-off sentiment and rising VIX." },
  { id: "carry",        label: "Carry",         favorable: ["boom","goldilocks"],  unfavorable: ["bust"],              tip: "Works in stable, moderate inflation environments. Currently vulnerable to credit spread widening and liquidity shocks." },
  { id: "income",       label: "Income",        favorable: ["stagflation","bust"], unfavorable: [],                    tip: "Dividend yield factor. Resilient in stagflation — income stocks hold value better than growth. Flight-to-income dynamic building." },
  { id: "profitability",label: "Profitability", favorable: ["stagflation","bust","goldilocks"], unfavorable: [],       tip: "Gross profit/assets (Novy-Marx). Distinct from quality — captures current operational efficiency. Works across most regimes." },
  { id: "earn_rev",     label: "Earnings Rev.", favorable: ["goldilocks","boom"],  unfavorable: ["stagflation"],       tip: "Analyst upgrade/downgrade momentum. Currently net negative across most sectors — a leading indicator of price momentum." },
  { id: "shyield",      label: "Shrhldr Yield", favorable: ["stagflation","goldilocks"], unfavorable: [],              tip: "Buybacks + dividends combined. Broader than income alone. Companies with high total capital return well-positioned in low growth." },
  { id: "liquidity_f",  label: "Liquidity",     favorable: ["goldilocks","boom"],  unfavorable: ["bust"],              tip: "Illiquidity premium. Currently risky given spread widening and potential redemption pressure." },
];
const MACRO_FACTORS = [
  { id: "growth_m",    label: "Growth",          favorable: ["goldilocks","boom"],  unfavorable: ["stagflation","bust"], tip: "Long assets that benefit from economic expansion. Currently short signal given rolling-over leading indicators." },
  { id: "inflation_m", label: "Inflation",       favorable: ["boom","stagflation"], unfavorable: ["bust","goldilocks"], tip: "Long inflation beneficiaries (TIPS, commodities, real assets). Strongest positive regime signal right now." },
  { id: "fin_cond",    label: "Fin. Conditions", favorable: ["goldilocks"],         unfavorable: ["stagflation"],       tip: "Composite of spreads, yields, dollar, equity vol. Currently tightening — a headwind for risk assets and growth." },
  { id: "liquidity_m", label: "Liquidity",       favorable: ["goldilocks","boom"],  unfavorable: ["stagflation"],       tip: "M2, central bank balance sheets, money markets. QT still ongoing — net liquidity headwind remains." },
  { id: "vol_regime",  label: "Vol. Regime",     favorable: ["bust"],               unfavorable: ["goldilocks"],        tip: "Rising vol regime changes factor behavior — momentum breaks, min vol and quality rewarded." },
  { id: "risk_app",    label: "Risk Appetite",   favorable: ["goldilocks","boom"],  unfavorable: ["stagflation"],       tip: "Cross-asset composite. Measures whether capital is flowing toward or away from risk globally. Currently risk-off." },
  { id: "dollar",      label: "Dollar Cycle",    favorable: [],                     unfavorable: ["stagflation"],       tip: "Strong USD = headwind for EM, commodities, international equities and US multinationals." },
  { id: "duration",    label: "Duration",        favorable: ["bust","goldilocks"],  unfavorable: ["boom"],              tip: "Growth falling is positive for duration, but sticky inflation is negative. Net neutral — wait for inflation rollover." },
];

const FACTOR_STOCKS = {
  value:        { stat: "P/E",          stocks: [{ t: "BRK.B", n: "Berkshire Hathaway", v: "11.2×" }, { t: "JPM",  n: "JPMorgan Chase",    v: "12.4×" }, { t: "XOM",  n: "ExxonMobil",       v: "13.1×" }, { t: "CVX",  n: "Chevron",            v: "12.8×" }, { t: "BAC",  n: "Bank of America",    v: "10.9×" }] },
  momentum:     { stat: "12M Return",   stocks: [{ t: "NVDA", n: "Nvidia",              v: "+156%" }, { t: "META", n: "Meta Platforms",     v: "+68%"  }, { t: "AVGO", n: "Broadcom",          v: "+72%"  }, { t: "LLY",  n: "Eli Lilly",          v: "+44%"  }, { t: "GE",   n: "GE Aerospace",       v: "+58%"  }] },
  quality:      { stat: "ROE",          stocks: [{ t: "MSFT", n: "Microsoft",           v: "38%"   }, { t: "AAPL", n: "Apple",              v: "147%"  }, { t: "V",    n: "Visa",              v: "44%"   }, { t: "MA",   n: "Mastercard",         v: "155%"  }, { t: "JNJ",  n: "Johnson & Johnson",  v: "22%"   }] },
  growth_f:     { stat: "EPS Growth",   stocks: [{ t: "NVDA", n: "Nvidia",              v: "+103%" }, { t: "AMZN", n: "Amazon",             v: "+84%"  }, { t: "META", n: "Meta Platforms",    v: "+71%"  }, { t: "GOOGL",n: "Alphabet",            v: "+32%"  }, { t: "CRM",  n: "Salesforce",         v: "+28%"  }] },
  smallcap:     { stat: "Mkt Cap",      stocks: [{ t: "AXON", n: "Axon Enterprise",     v: "$28B"  }, { t: "DOCS", n: "Doximity",           v: "$4.1B" }, { t: "CAVA", n: "Cava Group",         v: "$8.6B" }, { t: "FTAI", n: "FTAI Aviation",       v: "$9.2B" }, { t: "KTOS", n: "Kratos Defense",      v: "$3.8B" }] },
  minvol:       { stat: "Beta",         stocks: [{ t: "JNJ",  n: "Johnson & Johnson",   v: "0.52"  }, { t: "PG",   n: "Procter & Gamble",   v: "0.58"  }, { t: "KO",   n: "Coca-Cola",         v: "0.55"  }, { t: "WMT",  n: "Walmart",            v: "0.48"  }, { t: "VZ",   n: "Verizon",            v: "0.41"  }] },
  carry:        { stat: "Yield",        stocks: [{ t: "MO",   n: "Altria Group",        v: "8.4%"  }, { t: "T",    n: "AT&T",               v: "6.7%"  }, { t: "O",    n: "Realty Income",     v: "5.8%"  }, { t: "MPC",  n: "Marathon Petroleum", v: "2.1%+bb"}, { t: "KMI",  n: "Kinder Morgan",      v: "6.2%"  }] },
  income:       { stat: "Div Yield",    stocks: [{ t: "VZ",   n: "Verizon",             v: "6.7%"  }, { t: "T",    n: "AT&T",               v: "6.7%"  }, { t: "MO",   n: "Altria Group",      v: "8.4%"  }, { t: "IBM",  n: "IBM",                v: "3.3%"  }, { t: "PM",   n: "Philip Morris",      v: "5.4%"  }] },
  profitability:{ stat: "Gross Margin", stocks: [{ t: "MSFT", n: "Microsoft",           v: "69%"   }, { t: "GOOGL",n: "Alphabet",            v: "57%"   }, { t: "V",    n: "Visa",              v: "81%"   }, { t: "AAPL", n: "Apple",              v: "44%"   }, { t: "MA",   n: "Mastercard",         v: "79%"   }] },
  earn_rev:     { stat: "Rev Trend",    stocks: [{ t: "JPM",  n: "JPMorgan Chase",      v: "↑↑↑"  }, { t: "GS",   n: "Goldman Sachs",      v: "↑↑↑"  }, { t: "XOM",  n: "ExxonMobil",       v: "↑↑"   }, { t: "CAT",  n: "Caterpillar",        v: "↑↑"   }, { t: "RTX",  n: "RTX Corp",           v: "↑↑↑"  }] },
  shyield:      { stat: "Total Yield",  stocks: [{ t: "AAPL", n: "Apple",               v: "4.1%"  }, { t: "META", n: "Meta Platforms",     v: "3.8%"  }, { t: "GOOGL",n: "Alphabet",            v: "2.9%"  }, { t: "MPC",  n: "Marathon Petroleum", v: "8.2%"  }, { t: "PSX",  n: "Phillips 66",        v: "7.1%"  }] },
  liquidity_f:  { stat: "Avg Daily Vol",stocks: [{ t: "BOOT", n: "Boot Barn",           v: "$42M"  }, { t: "CAVA", n: "Cava Group",         v: "$55M"  }, { t: "UFPI", n: "UFP Industries",     v: "$38M"  }, { t: "LNTH", n: "Lantheus Holdings",   v: "$91M"  }, { t: "IIPR", n: "Innovative Ind Props", v: "$28M" }] },
  growth_m:     { stat: "Exposure",     stocks: [{ t: "XLY",  n: "Cons. Discret. ETF",  v: "Cyclical"   }, { t: "XLI",  n: "Industrials ETF",    v: "Cyclical"   }, { t: "XLK",  n: "Technology ETF",    v: "Growth"     }, { t: "IWM",  n: "Russell 2000 ETF",    v: "Risk-on"    }, { t: "EEM",  n: "EM Equities ETF",     v: "Global growth" }] },
  inflation_m:  { stat: "Inflation β",  stocks: [{ t: "GLD",  n: "Gold ETF",            v: "High"       }, { t: "TIP",  n: "TIPS ETF",          v: "Direct"     }, { t: "XLE",  n: "Energy ETF",        v: "High"       }, { t: "PDBC", n: "Commodities ETF",     v: "High"       }, { t: "VNQ",  n: "Real Estate ETF",     v: "Medium"        }] },
  fin_cond:     { stat: "FCI Sensitiv.",stocks: [{ t: "XLF",  n: "Financials ETF",      v: "High"       }, { t: "KRE",  n: "Regional Banks ETF",v: "Very high"  }, { t: "HYG",  n: "High Yield ETF",    v: "High"       }, { t: "XLRE", n: "Real Estate ETF",     v: "Medium"     }, { t: "XLU",  n: "Utilities ETF",       v: "Medium"        }] },
  liquidity_m:  { stat: "Liquidity β",  stocks: [{ t: "BTC",  n: "Bitcoin (proxy)",     v: "Very high"  }, { t: "IWM",  n: "Russell 2000 ETF",  v: "High"       }, { t: "ARKK", n: "ARK Innovation ETF", v: "Very high"  }, { t: "EEM",  n: "EM Equities ETF",     v: "High"       }, { t: "HYG",  n: "High Yield ETF",      v: "Medium"        }] },
  vol_regime:   { stat: "Vol Exposure", stocks: [{ t: "VIXY", n: "Short-Term VIX ETF",  v: "Long vol"   }, { t: "PUTW", n: "Put Write ETF",      v: "Short vol"  }, { t: "TAIL", n: "Cambria Tail Risk",  v: "Long tail"  }, { t: "SPLV", n: "S&P Low Vol ETF",     v: "Low beta"   }, { t: "UVXY", n: "Ultra VIX ETF",       v: "Lev. long vol" }] },
  risk_app:     { stat: "Risk Score",   stocks: [{ t: "SPY",  n: "S&P 500 ETF",         v: "Benchmark"  }, { t: "EEM",  n: "EM Equities ETF",    v: "High risk"  }, { t: "HYG",  n: "High Yield ETF",    v: "Credit risk"}, { t: "IWM",  n: "Russell 2000 ETF",    v: "High beta"  }, { t: "GLD",  n: "Gold ETF",            v: "Risk-off"      }] },
  dollar:       { stat: "USD Sensitiv.",stocks: [{ t: "EEM",  n: "EM Equities ETF",     v: "–ve"        }, { t: "GLD",  n: "Gold ETF",           v: "–ve"        }, { t: "XLE",  n: "Energy ETF",        v: "–ve"        }, { t: "AAPL", n: "Apple (intl rev)",    v: "–ve"        }, { t: "UUP",  n: "USD Bull ETF",        v: "Direct long"   }] },
  duration:     { stat: "Duration",     stocks: [{ t: "TLT",  n: "20+ Yr Treasury ETF", v: "17.5 yrs"   }, { t: "EDV",  n: "Extended Duration",  v: "24.5 yrs"   }, { t: "ZROZ", n: "Zero Coupon ETF",    v: "26.8 yrs"   }, { t: "TIP",  n: "TIPS ETF",           v: "7.4 yrs"    }, { t: "IEF",  n: "7-10 Yr Tsy ETF",    v: "7.7 yrs"       }] },
};

// ── DEMO CHART DATA ────────────────────────────────────────────────────────────
const GDP_DATA = [
  { q:"Q1'22",consumption:1.8,investment:0.9,govt:0.2,netExports:-3.2 },
  { q:"Q2'22",consumption:0.7,investment:-0.3,govt:-0.5,netExports:1.4 },
  { q:"Q3'22",consumption:1.4,investment:-0.6,govt:0.3,netExports:2.8 },
  { q:"Q4'22",consumption:1.5,investment:-0.3,govt:0.6,netExports:0.5 },
  { q:"Q1'23",consumption:2.5,investment:0.5,govt:0.4,netExports:-0.1 },
  { q:"Q2'23",consumption:1.7,investment:0.8,govt:0.5,netExports:0.6 },
  { q:"Q3'23",consumption:2.4,investment:0.9,govt:0.8,netExports:0.1 },
  { q:"Q4'23",consumption:1.9,investment:0.5,govt:0.6,netExports:0.4 },
  { q:"Q1'24",consumption:1.4,investment:0.3,govt:0.5,netExports:-0.5 },
  { q:"Q2'24",consumption:1.8,investment:0.4,govt:0.9,netExports:-0.6 },
];
const YIELD_DATA = [
  { m:"Jan'23",y2:4.42,y10:3.88,real10:1.54,hy:4.52 },
  { m:"Apr'23",y2:4.34,y10:3.57,real10:1.42,hy:4.31 },
  { m:"Jul'23",y2:4.87,y10:3.97,real10:1.88,hy:3.98 },
  { m:"Oct'23",y2:5.02,y10:4.93,real10:2.45,hy:4.65 },
  { m:"Jan'24",y2:4.38,y10:4.03,real10:1.91,hy:3.42 },
  { m:"Apr'24",y2:4.97,y10:4.67,real10:2.21,hy:3.24 },
  { m:"Jul'24",y2:4.26,y10:4.20,real10:1.97,hy:3.17 },
  { m:"Oct'24",y2:4.14,y10:4.28,real10:2.02,hy:2.95 },
  { m:"Jan'25",y2:4.27,y10:4.52,real10:2.14,hy:3.05 },
  { m:"Mar'25",y2:4.01,y10:4.31,real10:2.07,hy:3.74 },
];
const CPI_DATA = [
  { m:"Jan'23",shelter:3.1,supercore:1.8,food:1.0,energy:-0.8,goods:-0.2 },
  { m:"Apr'23",shelter:2.8,supercore:1.6,food:0.9,energy:-0.3,goods:-0.3 },
  { m:"Jul'23",shelter:2.4,supercore:1.4,food:0.4,energy:0.4,goods:-0.4 },
  { m:"Oct'23",shelter:2.5,supercore:1.3,food:0.3,energy:0.2,goods:-0.3 },
  { m:"Jan'24",shelter:2.6,supercore:1.4,food:0.2,energy:-0.2,goods:-0.2 },
  { m:"Apr'24",shelter:2.7,supercore:1.6,food:0.2,energy:0.5,goods:-0.1 },
  { m:"Jul'24",shelter:2.5,supercore:1.5,food:0.2,energy:-0.3,goods:-0.1 },
  { m:"Oct'24",shelter:2.6,supercore:1.6,food:0.3,energy:0.1,goods:0.1 },
  { m:"Jan'25",shelter:2.7,supercore:1.8,food:0.3,energy:0.3,goods:0.2 },
  { m:"Mar'25",shelter:2.8,supercore:2.0,food:0.4,energy:0.4,goods:0.3 },
];
const GLOBAL_DEMO = [
  { r:"🇺🇸 US",    gdp:2.4, cpi:3.1, rate:"4.38", y10:"4.31" },
  { r:"🇪🇺 Euro",  gdp:0.4, cpi:2.6, rate:"2.65", y10:"2.54" },
  { r:"🇬🇧 UK",    gdp:0.3, cpi:3.4, rate:"4.50", y10:"4.62" },
  { r:"🇯🇵 Japan", gdp:0.1, cpi:2.8, rate:"0.50", y10:"1.54" },
  { r:"🇨🇳 China", gdp:4.5, cpi:0.2, rate:"3.10", y10:"1.81" },
  { r:"🇮🇳 India", gdp:6.4, cpi:3.9, rate:"6.25", y10:"6.72" },
  { r:"🇧🇷 Brazil",gdp:2.1, cpi:5.1, rate:"13.75",y10:"14.2" },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fsig(f, q) { return f.unfavorable.includes(q) ? "bad" : f.favorable.includes(q) ? "good" : "warn"; }
function sigCol(s)   { return s === "good" ? C.green : s === "bad" ? C.red : C.amber; }
function sigBg(s)    { return s === "good" ? C.greenDim : s === "bad" ? C.redDim : C.amberDim; }
function sigLabel(s) { return s === "good" ? "FAVORED" : s === "bad" ? "AVOID" : "NEUTRAL"; }
function fmt(v, decimals = 2, prefix = "", suffix = "") {
  if (v == null) return "—";
  return `${prefix}${(+v).toFixed(decimals)}${suffix}`;
}

// ── PRIMITIVES ─────────────────────────────────────────────────────────────────
function Tip({ text, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, []);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span onClick={() => setOpen(v => !v)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} style={{ cursor: "help" }}>{children}</span>
      {open && (
        <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", minWidth: 240, maxWidth: 300, background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 8, padding: "11px 13px", fontSize: 20, lineHeight: 1.6, color: C.text, fontFamily: SANS, zIndex: 9999, boxShadow: "0 12px 40px rgba(0,0,0,0.7)", whiteSpace: "normal", pointerEvents: "none" }}>
          <span style={{ color: C.amber, fontWeight: 700, fontSize: 16, fontFamily: BOLD, letterSpacing: "0.12em", display: "block", marginBottom: 5 }}>SO WHAT?</span>
          {text}
        </span>
      )}
    </span>
  );
}

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, ...style }}>{children}</div>;
}

function SecLabel({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 6px" }}>
      <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.18em", color: C.muted, whiteSpace: "nowrap" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function Takeaway({ text }) {
  return (
    <div style={{ borderLeft: `2px solid ${C.amber}`, background: `linear-gradient(90deg,${C.amberDim},transparent)`, borderRadius: "0 6px 6px 0", padding: "9px 13px", marginBottom: 12, fontSize: 20, lineHeight: 1.65, color: C.muted, fontFamily: SANS }}>
      <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: C.amber, letterSpacing: "0.12em", display: "block", marginBottom: 3 }}>▸ TAKEAWAY</span>
      {text}
    </div>
  );
}

function Tile({ label, value, prev, signal, tip, isLive }) {
  return (
    <Tip text={tip}>
      <Card style={{ cursor: "help" }}>
        <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em", color: C.muted, marginBottom: 6 }}>
          {label} <span style={{ color: C.dim, fontWeight: 400 }}>ⓘ</span>
          {isLive && <span style={{ float: "right", fontSize: 12, color: C.green, fontFamily: BOLD, fontWeight: 700 }}>LIVE</span>}
        </div>
        <div style={{ fontSize: 34, fontFamily: BOLD, fontWeight: 800, color: sigCol(signal), lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 16, fontFamily: SANS, color: C.muted, marginTop: 5 }}>prev {prev}</div>
      </Card>
    </Tip>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
      {items.map(([l, c]) => (
        <span key={l} style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 2, background: c, display: "inline-block" }} />{l}
        </span>
      ))}
    </div>
  );
}

function BoxLegend({ items }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {items.map(([l, c]) => (
        <span key={l} style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: c, display: "inline-block" }} />{l}
        </span>
      ))}
    </div>
  );
}

// ── FACTOR MODAL ──────────────────────────────────────────────────────────────
function FactorModal({ factor, quadrant, onClose }) {
  const sig = fsig(factor, quadrant);
  const col = sigCol(sig);
  const data = FACTOR_STOCKS[factor.id];
  const isStyle = STYLE_FACTORS.find(f => f.id === factor.id);
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.72)" }} />
      <div style={{ position: "relative", background: C.surface, borderRadius: "16px 16px 0 0", border: `1px solid ${C.borderBright}`, borderBottom: "none", padding: "20px 18px 36px", zIndex: 1, animation: "slideUp 0.25s ease" }}>
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        <div style={{ width: 36, height: 4, background: C.dim, borderRadius: 2, margin: "0 auto 20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.14em", color: C.muted, marginBottom: 4 }}>{isStyle ? "STYLE FACTOR" : "MACRO FACTOR"}</div>
            <div style={{ fontFamily: BOLD, fontWeight: 800, fontSize: 38, color: C.text, lineHeight: 1, letterSpacing: "-0.01em" }}>{factor.label}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.12em", color: C.muted, marginBottom: 4 }}>REGIME SIGNAL</div>
            <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 5, background: sigBg(sig), border: `1px solid ${col}40`, fontSize: 18, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.08em", color: col }}>{sigLabel(sig)}</div>
          </div>
        </div>
        <div style={{ fontSize: 21, lineHeight: 1.7, color: C.muted, fontFamily: SANS, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${C.border}` }}>{factor.tip}</div>
        {data && <>
          <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.14em", color: C.muted, marginBottom: 10 }}>REPRESENTATIVE NAMES · {data.stat.toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.stocks.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, background: col + "20", border: `1px solid ${col}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: col, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontFamily: BOLD, fontWeight: 700, color: C.text }}>{s.t}</div>
                  <div style={{ fontSize: 18, color: C.muted, fontFamily: SANS, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.n}</div>
                </div>
                <div style={{ fontSize: 20, fontFamily: BOLD, fontWeight: 700, color: col, flexShrink: 0 }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 16, fontFamily: SANS, color: C.dim, textAlign: "center" }}>Illustrative only · Demo data · Not a recommendation</div>
        </>}
        <button onClick={onClose} style={{ marginTop: 16, width: "100%", padding: "12px", background: "none", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 18, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em", color: C.muted, cursor: "pointer" }}>CLOSE</button>
      </div>
    </div>
  );
}

// ── CYCLE QUADRANT ─────────────────────────────────────────────────────────────
function CycleQuadrant({ cycle }) {
  const [altsOpen, setAltsOpen] = useState(false);
  const altsRef = useRef();
  useEffect(() => {
    const h = e => { if (altsRef.current && !altsRef.current.contains(e.target)) setAltsOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, []);
  const Q = QUADRANTS[cycle.quadrant];
  const dotX = 100 + cycle.growth * 66;
  const dotY = 50 - cycle.inflation * 34;
  const ql = [
    { label: ["GOLDILOCKS"],          x: 150, y: 80, color: C.green,  q: "goldilocks" },
    { label: ["INFLATIONARY","BOOM"], x: 150, y: 20, color: C.amber,  q: "boom" },
    { label: ["STAGFLATION"],         x: 50,  y: 20, color: C.red,    q: "stagflation" },
    { label: ["DEFLATIONARY","BUST"], x: 50,  y: 78, color: C.purple, q: "bust" },
  ];
  return (
    <Card>
      <div style={{ display: "flex", gap: 48, alignItems: "center" }}>
        <div style={{ flex: "0 0 1040px" }}>
          <svg viewBox="0 0 200 100" width="100%" style={{ display: "block" }}>
            <rect x="0" y="0" width="100" height="50" fill={C.red    + "0f"} />
            <rect x="100" y="0" width="100" height="50" fill={C.amber  + "0a"} />
            <rect x="0" y="50" width="100" height="50" fill={C.purple + "0a"} />
            <rect x="100" y="50" width="100" height="50" fill={C.green  + "0a"} />
            <line x1="100" y1="4" x2="100" y2="96" stroke={C.dim} strokeWidth="0.5" />
            <line x1="4" y1="50" x2="196" y2="50" stroke={C.dim} strokeWidth="0.5" />
            <text x="100" y="2.8" textAnchor="middle" fontSize="3.8" fill={C.muted} fontFamily={BOLD} fontWeight="700">INFLATION ↑</text>
            <text x="100" y="99"  textAnchor="middle" fontSize="3.8" fill={C.muted} fontFamily={BOLD} fontWeight="700">INFLATION ↓</text>
            <text x="2"   y="51.5" fontSize="3.2" fill={C.muted} fontFamily={BOLD} fontWeight="700">↓ GROWTH</text>
            <text x="166" y="51.5" fontSize="3.2" fill={C.muted} fontFamily={BOLD} fontWeight="700">GROWTH ↑</text>
            {ql.map(q => q.label.map((line, i) => (
              <text key={`${q.q}-${i}`} x={q.x} y={q.y + i * 5.5 - (q.label.length - 1) * 2.5} textAnchor="middle" fontSize="3.8"
                fill={cycle.quadrant === q.q ? q.color : C.dim} fontFamily={BOLD}
                fontWeight={cycle.quadrant === q.q ? "800" : "700"}>{line}</text>
            )))}
            <circle cx={dotX} cy={dotY} r="6"   fill={Q.color + "20"} />
            <circle cx={dotX} cy={dotY} r="3.5" fill={Q.color + "55"} />
            <circle cx={dotX} cy={dotY} r="2"   fill={Q.color} />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.14em", color: C.muted, marginBottom: 4 }}>CURRENT REGIME</div>
          <div style={{ fontFamily: BOLD, fontWeight: 800, fontSize: 34, color: Q.color, lineHeight: 1.1, marginBottom: 2, letterSpacing: "-0.01em" }}>{Q.label}</div>
          <div style={{ fontSize: 18, fontFamily: SANS, color: C.muted, marginBottom: 12 }}>{Q.sub}</div>
          <div style={{ marginBottom: 12, maxWidth: 320 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>SIGNAL CONFIDENCE</span>
              <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: Q.color }}>{cycle.confidence}%</span>
            </div>
            <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${cycle.confidence}%`, background: Q.color, borderRadius: 2 }} />
            </div>
          </div>
          <div ref={altsRef} style={{ position: "relative", display: "inline-block" }}>
            <div onClick={() => setAltsOpen(v => !v)} onMouseEnter={() => setAltsOpen(true)} onMouseLeave={() => setAltsOpen(false)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, background: Q.color + "18", border: `1px solid ${Q.color}35`, borderRadius: 5, padding: "5px 11px", cursor: "help" }}>
              <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>ALTS BUCKET</span>
              <span style={{ fontSize: 19, fontFamily: BOLD, fontWeight: 800, color: Q.color }}>{Q.alts}</span>
              <span style={{ fontSize: 16, color: C.dim }}>ⓘ</span>
            </div>
            {altsOpen && (
              <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 280, background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 10, padding: "13px 14px", zIndex: 500, boxShadow: "0 12px 40px rgba(0,0,0,0.8)", pointerEvents: "none" }}>
                <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.12em", color: Q.color, marginBottom: 6 }}>ALTS → {Q.alts.toUpperCase()}</div>
                <div style={{ fontSize: 20, lineHeight: 1.65, color: C.muted, fontFamily: SANS, marginBottom: 12 }}>{Q.altsDesc}</div>
                <div style={{ paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em", color: C.muted, marginBottom: 6 }}>ALL REGIME MAPPINGS</div>
                  {Object.entries(QUADRANTS).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontFamily: SANS, padding: "3px 0" }}>
                      <span style={{ color: k === cycle.quadrant ? v.color : C.dim }}>{k === cycle.quadrant ? "▸ " : "  "}{v.label}</span>
                      <span style={{ color: k === cycle.quadrant ? v.color : C.dim, fontFamily: BOLD, fontWeight: 700 }}>{v.alts}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── FACTOR SCORECARD ───────────────────────────────────────────────────────────
function FactorCard({ quadrant, onSelectFactor }) {
  const all = [...STYLE_FACTORS, ...MACRO_FACTORS];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.14em", color: C.muted }}>FACTOR REGIME SIGNALS</span>
        <div style={{ display: "flex", gap: 10 }}>
          {[["FAVORED","good"],["NEUTRAL","warn"],["AVOID","bad"]].map(([l,s]) => (
            <span key={s} style={{ fontSize: 14, fontFamily: BOLD, fontWeight: 700, color: sigCol(s), display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: sigCol(s), display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
        {all.map(f => {
          const sig = fsig(f, quadrant); const col = sigCol(sig);
          return (
            <div key={f.id} onClick={() => onSelectFactor(f)}
              style={{ background: sigBg(sig), border: `1px solid ${col}22`, borderRadius: 7, padding: "8px 6px", cursor: "pointer", textAlign: "center", transition: "border-color 0.15s, transform 0.1s", userSelect: "none" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = col+"55"; e.currentTarget.style.transform = "scale(1.04)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = col+"22"; e.currentTarget.style.transform = "scale(1)"; }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: col, margin: "0 auto 5px" }} />
              <div style={{ fontSize: 14, fontFamily: BOLD, fontWeight: 700, color: C.muted, lineHeight: 1.3 }}>{f.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
        {[["STYLE", STYLE_FACTORS],["MACRO", MACRO_FACTORS]].map(([lbl, arr]) => (
          <div key={lbl} style={{ display: "flex", gap: 6 }}>
            <span style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: C.dim }}>{lbl}:</span>
            {[["good","▲"],["warn","–"],["bad","▼"]].map(([s,sym]) => (
              <span key={s} style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: sigCol(s) }}>{arr.filter(f => fsig(f, quadrant) === s).length}{sym}</span>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 16, fontFamily: SANS, color: C.dim, textAlign: "center" }}>Tap any factor for detail & representative names</div>
    </Card>
  );
}

// ── TAB CONTENT ────────────────────────────────────────────────────────────────
function SentimentTab({ live }) {
  const L = live;
  const isLive = f => !!L && L[f] != null;

  const tiles = [
    { label: "VIX",            value: resolve(L?.vix_latest,  "24.3", v => v.toFixed(1)), prev: resolve(L?.vix_prev, "19.1", v => v.toFixed(1)), signal: L?.vix_latest != null ? (L.vix_latest > 30 ? "bad" : L.vix_latest > 20 ? "warn" : "good") : "warn", tip: "Options-implied fear gauge. >30 = panic, <15 = complacency. Elevated — markets pricing near-term uncertainty without full panic.", live: isLive("vix_latest") },
    { label: "Fear & Greed",   value: resolve(L?.fear_greed,  "32",   v => Math.round(v).toString()),    prev: "58",    signal: L?.fear_greed != null ? (L.fear_greed < 25 ? "bad" : L.fear_greed < 45 ? "warn" : "good") : "bad",  tip: "CNN composite of 7 market signals: 0–25 Extreme Fear, 25–45 Fear, 45–55 Neutral, 55–75 Greed, 75–100 Extreme Greed. Contrarian indicator — extreme fear has preceded short-term rallies historically.", live: isLive("fear_greed") },
    { label: "AAII Bull–Bear", value: resolve(L?.aaii_spread, "–18pts", v => `${v >= 0 ? "+" : ""}${v.toFixed(0)}pts`), prev: "+12pts", signal: L?.aaii_spread != null ? (L.aaii_spread < -20 ? "bad" : L.aaii_spread < 0 ? "warn" : "good") : "bad",  tip: "Retail investor bull minus bear %. Net below –20pts is a reliable contrarian buy signal historically.", live: isLive("aaii_spread") },
    { label: "Put/Call Ratio", value: resolve(L?.put_call_ratio, "1.18", v => v.toFixed(2)),              prev: "0.87",  signal: L?.put_call_ratio != null ? (L.put_call_ratio > 1.2 ? "bad" : L.put_call_ratio > 0.9 ? "warn" : "good") : "warn", tip: ">1 = more puts bought than calls. Equity put/call >1.2 often marks short-term capitulation lows — a contrarian buy signal.", live: isLive("put_call_ratio") },
    { label: "NAAIM Exposure", value: "48%",   prev: "71%",   signal: "warn", tip: "Active manager equity allocation. Well below neutral — institutional positioning cautious but not capitulated.", live: false },
    { label: "Margin Debt",    value: "$748B", prev: "$779B", signal: "good", tip: "Declining margin debt = leverage being unwound. Reduces systemic fragility. Historically peaks lead equity peaks by 3–6 months.", live: false },
    { label: "Money Mkt AUM",  value: resolve(L?.money_market_aum_latest, "6.8", v => `$${v.toFixed(1)}T`), prev: resolve(L?.money_market_aum_prev, "$6.56T", v => `$${v.toFixed(2)}T`), signal: "warn", tip: "Record high signals extreme risk aversion — but also enormous potential dry powder for any sentiment shift.", live: isLive("money_market_aum_latest") },
    { label: "Equity Flows 4w",value: "–$38B", prev: "+$12B", signal: "bad", tip: "Sustained outflows over 4 weeks. Historically a contrarian indicator when sentiment already extreme.", live: false },
  ];
  return <>
    <Takeaway text="Sentiment deteriorated sharply across retail and institutional measures. Readings at these levels have preceded recoveries historically — but typically only after credit spreads peak and forced selling clears." />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {tiles.map((m, i) => <Tile key={i} {...m} isLive={m.live} />)}
    </div>
  </>;
}

function ValuationsTab({ live }) {
  const L = live;
  const isLive = f => !!L && L[f] != null;

  const tiles = [
    { label: "S&P Fwd P/E",    value: resolve(L?.sp500_fwd_pe,    "21.4×", v => `${v.toFixed(1)}×`), prev: "19.8×",   signal: "bad",  tip: "Price / next 12-month earnings. At 21.4× vs 18.5× hist avg — expensive with real yields at 2%+.",          live: isLive("sp500_fwd_pe") },
    { label: "Equity Risk Prem",value: resolve(L?.equity_risk_premium,"1.8%", v => `${v.toFixed(1)}%`), prev: "2.9%", signal: "bad",  tip: "Earnings yield minus real yield. At 1.8%, stocks offer almost no premium over risk-free bonds.",               live: isLive("equity_risk_premium") },
    { label: "10Y Treasury",    value: resolve(L?.yield_10y_latest, "4.31%", v => `${v.toFixed(2)}%`), prev: resolve(L?.yield_10y_prev,"3.88%",v=>`${v.toFixed(2)}%`), signal: "warn", tip: "Global cost of capital benchmark. Above 4% = sustained pressure on equity multiples.", live: isLive("yield_10y_latest") },
    { label: "10Y Real Yield",  value: resolve(L?.real_yield_10y_latest,"2.07%",v=>`${v.toFixed(2)}%`), prev: resolve(L?.real_yield_10y_prev,"1.42%",v=>`${v.toFixed(2)}%`), signal: "bad", tip: "TIPS-implied real return. Above 2% is historically restrictive — crushes growth multiples.", live: isLive("real_yield_10y_latest") },
    { label: "10Y Breakeven",   value: resolve(L?.breakeven_10y_latest,"2.24%",v=>`${v.toFixed(2)}%`), prev: resolve(L?.breakeven_10y_prev,"2.15%",v=>`${v.toFixed(2)}%`), signal: "warn", tip: "Market's implied 10-year inflation forecast. Rising breakevens signal re-acceleration fears.", live: isLive("breakeven_10y_latest") },
    { label: "IG Credit Spread",value: resolve(L?.ig_spread_latest,"1.38%",v=>`+${v.toFixed(2)}%`),   prev: resolve(L?.ig_spread_prev,"+1.09%",v=>`+${v.toFixed(2)}%`), signal: "warn", tip: "Investment grade premium above Treasuries. Widening trend signals deteriorating corporate credit conditions.", live: isLive("ig_spread_latest") },
    { label: "HY Credit Spread",value: resolve(L?.hy_spread_latest,"3.74%",v=>`+${v.toFixed(2)}%`),   prev: resolve(L?.hy_spread_prev,"+2.95%",v=>`+${v.toFixed(2)}%`), signal: "bad",  tip: "Best real-time recession indicator. Approaching 4% danger zone. Rapid widening signals systemic credit stress.", live: isLive("hy_spread_latest") },
    { label: "Copper/Gold Ratio",value: resolve(L?.copper_gold_ratio,"0.41",v=>v.toFixed(3)), prev: "0.45", signal: "bad",  tip: "Copper = growth, gold = fear. Falling ratio = markets pricing decelerating global demand. At 18-month low.", live: isLive("copper_gold_ratio") },
  ];

  // Build yield chart from live data if available
  const yieldChart = (L?.yield_chart)
    ? (() => {
        const merged = {};
        ["y2","y10","real10","hy","be10"].forEach(k => {
          const key = { y2:"y2", y10:"y10", real10:"real10", hy:"hy", be10:"be10" }[k];
          const src = L.yield_chart[{ y2:"y2",y10:"y10",real10:"real10",hy:"hy",be10:"be10" }[k]];
          if (!src) return;
          src.forEach(({ date, value }) => {
            const m = date.slice(0,7);
            if (!merged[m]) merged[m] = { m };
            merged[m][k] = value;
          });
        });
        return Object.values(merged).slice(-20);
      })()
    : YIELD_DATA;

  return <>
    <Takeaway text="Equity risk premium near a two-decade low relative to real yields. Credit spreads widening confirms risk repricing underway. Valuations compressing but not yet at distressed entry levels across the stack." />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
      {tiles.map((m, i) => <Tile key={i} {...m} isLive={m.live} />)}
    </div>
    <SecLabel>YIELD STACK & CREDIT</SecLabel>
    <Card style={{ marginBottom: 4 }}>
      <ResponsiveContainer width="100%" height={175}>
        <LineChart data={yieldChart} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
          <XAxis dataKey="m" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <ReTooltip contentStyle={TT_STYLE} cursor={{ stroke: C.borderBright }} />
          <Line type="monotone" dataKey="y2"    stroke={C.blue}   strokeWidth={1.5} dot={false} name="2Y Tsy" />
          <Line type="monotone" dataKey="y10"   stroke={C.amber}  strokeWidth={2}   dot={false} name="10Y Tsy" />
          <Line type="monotone" dataKey="real10" stroke={C.green} strokeWidth={1.5} dot={false} name="10Y Real" />
          <Line type="monotone" dataKey="hy"    stroke={C.red}    strokeWidth={1.5} dot={false} name="HY Spread" strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
      <Legend items={[["2Y Tsy",C.blue],["10Y Tsy",C.amber],["10Y Real",C.green],["HY Spread",C.red]]} />
    </Card>
    <SecLabel>GLOBAL SNAPSHOT</SecLabel>
    <Card>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["REGION","GDP%","CPI%","RATE","10Y"].map(h => (
            <th key={h} style={{ textAlign: "left", color: C.muted, fontWeight: 700, paddingBottom: 8, paddingRight: 10, fontSize: 16, fontFamily: BOLD, letterSpacing: "0.1em" }}>{h}</th>
          ))}</tr></thead>
          <tbody>{GLOBAL_DEMO.map((row, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 10px 8px 0", color: C.text, fontFamily: SANS, fontSize: 19, whiteSpace: "nowrap" }}>{row.r}</td>
              <td style={{ padding: "8px 10px 8px 0", color: row.gdp > 1 ? C.green : C.amber, fontFamily: MONO, fontSize: 19 }}>{row.gdp}%</td>
              <td style={{ padding: "8px 10px 8px 0", color: row.cpi > 3 ? C.red : C.amber, fontFamily: MONO, fontSize: 19 }}>{row.cpi}%</td>
              <td style={{ padding: "8px 10px 8px 0", color: C.muted, fontFamily: MONO, fontSize: 19 }}>{row.rate}%</td>
              <td style={{ padding: "8px 0", color: C.muted, fontFamily: MONO, fontSize: 19 }}>{row.y10}%</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  </>;
}

function FundamentalsTab({ live }) {
  const L = live;
  const isLive = f => !!L && L[f] != null;

  const tiles = [
    { label: "GDP QoQ",          value: resolve(L?.gdp_qoq_latest,"+1.8%",v=>`${v>0?"+":""}${v.toFixed(1)}%`), prev: resolve(L?.gdp_qoq_prev,"+2.4%",v=>`${v>0?"+":""}${v.toFixed(1)}%`), signal:"warn", tip:"Latest quarter annualized. Decelerating — consumption slowing, investment soft, government spending propping headline.", live:isLive("gdp_qoq_latest") },
    { label: "Core PCE",         value: resolve(L?.core_pce_latest,"3.1%",v=>`${v.toFixed(1)}%`), prev: resolve(L?.core_pce_prev,"2.8%",v=>`${v.toFixed(1)}%`), signal:"bad",  tip:"Fed's true north star. At 3.1% and re-accelerating — well above 2% target. Primary obstacle to rate cuts.", live:isLive("core_pce_latest") },
    { label: "CPI YoY",          value: resolve(L?.cpi_latest,"3.5%",v=>`${v.toFixed(1)}%`), prev: resolve(L?.cpi_prev,"3.1%",v=>`${v.toFixed(1)}%`), signal:"bad", tip:"Headline inflation year-on-year. Supercore (services ex-shelter) is the Fed's preferred real-time signal — re-accelerating and tied to wage growth.", live:isLive("cpi_latest") },
    { label: "Unemployment",     value: resolve(L?.unemployment_latest,"4.2%",v=>`${v.toFixed(1)}%`), prev: resolve(L?.unemployment_prev,"3.7%",v=>`${v.toFixed(1)}%`), signal:"warn", tip:"Rising but still historically low. Lagging indicator — by the time it's clearly bad, recession is usually already underway.", live:isLive("unemployment_latest") },
    { label: "Initial Claims",   value: resolve(L?.initial_claims_latest,"226k",v=>`${Math.round(v/1000)}k`), prev: resolve(L?.initial_claims_prev,"192k",v=>`${Math.round(v/1000)}k`), signal:"warn", tip:"Weekly — most real-time labor signal available. Trending up — early warning of deteriorating hiring conditions.", live:isLive("initial_claims_latest") },
    { label: "Conference Bd LEI", value: resolve(L?.lei_yoy, "–0.6%", v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`), prev: resolve(L?.lei_prev_yoy, "–0.2%", v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`), signal: L?.lei_yoy != null ? (L.lei_yoy < -2 ? "bad" : L.lei_yoy < 0 ? "warn" : "good") : "bad", tip:"Composite of 10 leading indicators (YoY %). Sustained decline = recession signal. Has predicted every US recession with ~12 month lead.", live:isLive("lei_yoy") },
    { label: L?.ism_source === "Philly Fed" ? "Philly Fed Mfg" : "ISM Manufacturing", value: resolve(L?.ism_manufacturing, "48.3", v => L?.ism_source === "Philly Fed" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1)), prev: resolve(L?.ism_manufacturing_prev, "50.1", v => L?.ism_source === "Philly Fed" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1)), signal: L?.ism_manufacturing != null ? (L.ism_source === "Philly Fed" ? (L.ism_manufacturing < -5 ? "bad" : L.ism_manufacturing < 0 ? "warn" : "good") : (L.ism_manufacturing < 48 ? "bad" : L.ism_manufacturing < 50 ? "warn" : "good")) : "bad", tip: L?.ism_source === "Philly Fed" ? "Philadelphia Fed General Activity Diffusion Index (proxy for ISM Manufacturing). >0 = expansion, <0 = contraction." : "<50 = contraction. Multiple months below 50 signal global industrial cycle deteriorating.", live:isLive("ism_manufacturing") },
    { label: "ISM Services",      value: "51.4",      prev: "53.8",    signal:"warn", tip:"Services = 80% of US economy. Still in expansion above 50 but trend deteriorating. Watch for crossing 50.", live:false },
    { label: "Fed Funds Rate",    value: resolve(L?.fed_funds_latest,"4.25–4.50%",v=>`${v.toFixed(2)}%`), prev: "4.25–4.50%", signal:"warn", tip:"On hold since Dec 2024. Market pricing only 1 cut in 2025 — down from 4 expected at year start.", live:isLive("fed_funds_latest") },
    { label: "M2 Money Supply",   value: resolve(L?.m2_yoy,"+3.1%",v=>`${v>0?"+":""}${v.toFixed(1)}%`), prev: "+2.4%", signal:"warn", tip:"M2 growth after unprecedented 2022–23 contraction. Recovering but below trend — net liquidity headwind remains.", live:isLive("m2_yoy") },
  ];

  return <>
    <Takeaway text="GDP holding up via government spending but private demand is softening. Inflation re-accelerating in services keeps the Fed on hold. Leading indicators point to further deceleration over the next 2–3 quarters." />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
      {tiles.map((m, i) => <Tile key={i} {...m} isLive={m.live} />)}
    </div>
    <SecLabel>GDP BY COMPONENT (QoQ, pp)</SecLabel>
    <Card style={{ marginBottom: 4 }}>
      <BoxLegend items={[["Consumption",C.blue],["Investment",C.purple],["Govt",C.amber],["Net Exports",C.green]]} />
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={GDP_DATA} barCategoryGap="20%" margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
          <XAxis dataKey="q" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <ReTooltip contentStyle={TT_STYLE} cursor={{ fill: "#ffffff06" }} />
          <ReferenceLine y={0} stroke={C.dim} />
          <Bar dataKey="consumption" stackId="a" fill={C.blue} />
          <Bar dataKey="investment"  stackId="a" fill={C.purple} />
          <Bar dataKey="govt"        stackId="a" fill={C.amber} />
          <Bar dataKey="netExports"  stackId="a" fill={C.green} radius={[3,3,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
    <SecLabel>CPI BY COMPONENT (monthly pp)</SecLabel>
    <Card>
      <BoxLegend items={[["Shelter",C.red],["Supercore",C.amber],["Food",C.blue],["Energy",C.green],["Goods",C.muted]]} />
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={CPI_DATA} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
          <XAxis dataKey="m" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <ReTooltip contentStyle={TT_STYLE} />
          <Area type="monotone" dataKey="shelter"   stackId="1" stroke={C.red}   fill={C.red  +"50"} />
          <Area type="monotone" dataKey="supercore" stackId="1" stroke={C.amber} fill={C.amber+"50"} />
          <Area type="monotone" dataKey="food"      stackId="1" stroke={C.blue}  fill={C.blue +"50"} />
          <Area type="monotone" dataKey="energy"    stackId="1" stroke={C.green} fill={C.green+"50"} />
          <Area type="monotone" dataKey="goods"     stackId="1" stroke={C.muted} fill={C.muted+"50"} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  </>;
}

// ── REGIME TAB ─────────────────────────────────────────────────────────────────
function RegimeTab({ cycle, live, onSelectFactor }) {
  return <>
    <SecLabel>CYCLE POSITIONING</SecLabel>
    <CycleQuadrant cycle={cycle} />
    <SecLabel>FACTOR REGIME SCORECARD</SecLabel>
    <FactorCard quadrant={cycle.quadrant} onSelectFactor={onSelectFactor} />
    <SecLabel>MACRO FUNDAMENTALS</SecLabel>
    <FundamentalsTab live={live} />
  </>;
}

// ── APP ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("regime");
  const [selectedFactor, setSelectedFactor] = useState(null);
  const [dark, setDark] = useState(false);
  const { live, status } = useLiveData();

  // Sync theme palette before any render
  C = dark ? DARK_C : LIGHT_C;
  AXIS_TICK = { fontSize: 16, fill: C.muted, fontFamily: MONO };
  TT_STYLE  = { backgroundColor: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 6, fontSize: 19, fontFamily: SANS, color: C.text };

  // Compute cycle from live data if available, else demo scores
  const cycle = (live && live.cycle)
    ? live.cycle
    : (live ? computeCycleFromLive(live) : null) ?? computeCycleFromDemo();

  const TABS = [
    { id: "regime",      label: "REGIME" },
    { id: "sentiment",   label: "SENTIMENT" },
    { id: "valuations",  label: "VALUATIONS" },
  ];

  const lastUpdated = live?.last_updated
    ? new Date(live.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: SANS }}>
      <GoogleFonts />

      {/* HEADER */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1900, margin: "0 auto", padding: "12px 16px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontFamily: BOLD, fontWeight: 800, fontSize: 32, letterSpacing: "-0.02em" }}>Macro Pulse</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, color: C.muted }}>
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ fontSize: 16, fontFamily: BOLD, fontWeight: 700, marginTop: 1,
              color: status === "live" ? C.green : status === "demo" ? C.amber : C.dim }}>
              {status === "live" ? `● LIVE · ${lastUpdated}` : status === "demo" ? "● DEMO DATA" : "● LOADING…"}
            </div>
            <button onClick={() => setDark(v => !v)} style={{
              marginTop: 5, background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 20, padding: "3px 9px", cursor: "pointer",
              fontSize: 14, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.1em",
              color: C.muted, display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              {dark ? "☀ LIGHT" : "☾ DARK"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "none", border: "none", padding: "7px 13px",
              fontSize: 16, fontFamily: BOLD, fontWeight: 700, letterSpacing: "0.14em",
              color: tab === t.id ? C.amber : C.muted,
              borderBottom: `2px solid ${tab === t.id ? C.amber : "transparent"}`,
              cursor: "pointer", transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
        </div>
      </div>

      <div style={{ maxWidth: 1900, margin: "0 auto", padding: "6px 12px 24px" }}>
        {tab === "regime"     && <RegimeTab cycle={cycle} live={live} onSelectFactor={setSelectedFactor} />}
        {tab === "sentiment"  && <SentimentTab live={live} />}
        {tab === "valuations" && <ValuationsTab live={live} />}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", textAlign: "center" }}>
        <div style={{ maxWidth: 1900, margin: "0 auto" }}>
          <div style={{ fontSize: 16, fontFamily: SANS, color: C.dim, lineHeight: 2 }}>
            For illustrative purposes only · Not financial advice<br />
            Sources: FRED · BLS · BEA · Yahoo Finance · CNN · AAII · CBOE
          </div>
        </div>
      </div>

      {selectedFactor && <FactorModal factor={selectedFactor} quadrant={cycle.quadrant} onClose={() => setSelectedFactor(null)} />}
    </div>
  );
}
