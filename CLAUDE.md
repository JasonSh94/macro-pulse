# Macro Pulse — Project Context for Claude

## What this is
A macro regime dashboard built for Jason's team. Displays live economic data pulled from FRED and Yahoo Finance, scored into a cycle quadrant (Goldilocks / Inflationary Boom / Stagflation / Deflationary Bust) with factor signal overlays and fundamentals.

Live URL: https://macro-pulse-ebon.vercel.app/
GitHub: https://github.com/JasonSh94/macro-pulse.git

---

## Tech stack
- **Frontend**: React + Vite (`src/App.jsx`) — single-file, no component split
- **Data pipeline**: Python (`macro_pulse_pipeline.py`) — writes `public/data.json`
- **Data sources**: FRED API + Yahoo Finance (via `yfinance`)
- **Hosting**: Vercel (auto-redeploys on push to `main`)
- **CI**: GitHub Actions (`.github/workflows/refresh.yml`) — runs pipeline daily Mon–Fri at 8am UTC, commits `data.json`, triggers Vercel redeploy

---

## Tab structure (as of April 2026)
Three tabs: **REGIME → SENTIMENT → VALUATIONS**

- **REGIME** (default): Cycle Positioning quadrant, Factor Regime Scorecard, Macro Fundamentals (GDP, PCE, CPI, unemployment, etc.)
- **SENTIMENT**: Fear/greed, AAII survey, VIX, put/call ratio, etc.
- **VALUATIONS**: Equity risk premium, yield stack, credit spreads, global snapshot table

The old FUNDAMENTALS tab was dropped and its content folded into REGIME.

---

## FRED API
Key: `0aeeefb16f1283902cdfc629d5c4b39b`
Also stored as GitHub Actions secret `FRED_API_KEY`.

### Known bad series (fixed)
| Old (broken) | Replacement | Reason |
|---|---|---|
| `CUSR0000SA0E` | `CPIENGSL` | Invalid series |
| `WRMFSL` | `WRMFNS` | Discontinued 2021 |
| `BOEBR` | `BOERUKM` | Doesn't exist |

### Rate limiting
FRED blocks ~40+ rapid sequential calls. The pipeline has try/except error handling — failed series return `[]` and log a warning rather than crashing.

---

## GitHub Actions pipeline (`refresh.yml`)
- Schedule: `0 8 * * 1-5` (8am UTC weekdays)
- Commits `public/data.json` to `main` → triggers Vercel redeploy
- Requires secret `FRED_API_KEY` set in repo Settings → Secrets

---

## Known issues / LIVE · null bug
The header shows `LIVE · null` when `fed_funds_latest` or `money_market_aum_latest` comes back null from FRED (rate limiting on rapid runs). Fine on scheduled daily runs. The `resolve()` function in App.jsx falls back to demo values when live is null, but the header status line renders `lastUpdated` directly.

---

## Deployment
Vercel project is connected to the GitHub repo. Any push to `main` triggers a redeploy. No manual steps needed.

To run the pipeline locally:
```bash
cd ~/Documents/macro-pulse
pip install -r requirements.txt
FRED_API_KEY=0aeeefb16f1283902cdfc629d5c4b39b python macro_pulse_pipeline.py
```

---

## Git workflow note
The sandbox Claude runs in cannot push to GitHub (proxy blocks outbound GitHub traffic). Jason must run `git push` from Terminal. The pattern used throughout this project:
1. Claude commits in the sandbox (which writes to the mounted `~/Documents/macro-pulse` folder)
2. Jason runs: `cd ~/Documents/macro-pulse && git pull --rebase origin main && git push`

---

## Design notes
- Mobile-first single-column layout, dark theme (`#080910` background)
- Fonts: Bricolage Grotesque (headings), IBM Plex Sans (body), IBM Plex Mono (numbers/axes)
- Color palette defined in `const C = {...}` at top of App.jsx
- Cards use 10px padding, 10px border-radius
- SecLabel separators use `margin: "10px 0 6px"`
- The team's framework: **regime, sentiment, valuation** — tabs reflect this order
