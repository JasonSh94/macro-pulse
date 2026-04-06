# Macro Pulse

Systematic macro cycle dashboard. Sentiment · Valuations · Fundamentals.

Data refreshes daily via GitHub Actions → FRED API + Yahoo Finance → `public/data.json` → Vercel CDN.

---

## Stack

| Layer | Tool |
|---|---|
| Frontend | React + Vite + Recharts |
| Hosting | Vercel (free tier) |
| Data pipeline | Python + GitHub Actions |
| Data sources | FRED API (free), Yahoo Finance (free) |

---

## Setup — step by step

### 1. Get a free FRED API key

Go to [https://fredaccount.stlouisfed.org/login/secure/](https://fredaccount.stlouisfed.org/login/secure/) and register. It takes about 2 minutes. Copy your API key.

### 2. Create the GitHub repository

```bash
# Clone or fork this project, then push to a new GitHub repo
git init
git add .
git commit -m "init: macro pulse"
git remote add origin https://github.com/YOUR_USERNAME/macro-pulse.git
git push -u origin main
```

### 3. Add your FRED API key as a GitHub secret

In your GitHub repo:
1. Go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `FRED_API_KEY`
4. Value: your key from step 1
5. Save

### 4. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**
3. Import your `macro-pulse` repository
4. Framework preset: **Vite**
5. Build command: `npm run build`
6. Output directory: `dist`
7. Click **Deploy**

Vercel will give you a URL like `macro-pulse-abc123.vercel.app`. You can add a custom domain in Vercel's settings.

### 5. Test the data pipeline locally

```bash
# Install Python deps
pip install -r requirements.txt

# Copy and fill in your key
cp .env.example .env
# Edit .env and add your FRED_API_KEY

# Run the pipeline
python macro_pulse_pipeline.py
```

This writes `public/data.json`. Open `http://localhost:5173` with `npm run dev` and the dashboard will show `● LIVE` with real data.

### 6. Enable the daily GitHub Action

The pipeline runs automatically at 8am UTC on weekdays (after US pre-market data drops).

To trigger it manually:
1. Go to your repo on GitHub
2. Click **Actions → Daily Data Refresh**
3. Click **Run workflow**

After it runs, GitHub commits updated `data.json` to the repo, Vercel detects the change and redeploys automatically within ~30 seconds.

---

## Data sources

| Series | Source | Frequency |
|---|---|---|
| Treasury yields (2Y, 10Y, 30Y) | FRED | Daily |
| Real yields (TIPS) | FRED | Daily |
| Breakeven inflation | FRED | Daily |
| IG / HY credit spreads | FRED | Daily |
| Core PCE | FRED | Monthly |
| CPI components | FRED | Monthly |
| GDP components | FRED | Quarterly |
| Unemployment, Claims | FRED | Monthly / Weekly |
| Fed Funds rate, M2 | FRED | Daily / Monthly |
| Money market AUM | FRED | Weekly |
| S&P 500, DXY, Gold, WTI, BTC | Yahoo Finance | Daily |
| Copper/Gold ratio | Yahoo Finance | Daily |

### Pending scrapers (show demo data until implemented)

| Series | Source |
|---|---|
| VIX time series | Yahoo Finance (easy — already works for spot) |
| ISM Manufacturing / Services | ismworld.org |
| AAII Bull-Bear Spread | aaii.com/sentimentsurvey |
| NAAIM Exposure Index | naaim.org |
| Put/Call Ratio | cboe.com |
| Margin Debt | finra.org |
| Forward P/E | multpl.com or Quandl |

---

## Project structure

```
macro-pulse/
├── .github/
│   └── workflows/
│       └── refresh.yml       # Daily data pipeline
├── public/
│   └── data.json             # Written by pipeline, read by frontend
├── src/
│   ├── main.jsx              # React entry point
│   └── App.jsx               # Full dashboard component
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── macro_pulse_pipeline.py   # Data pipeline script
├── requirements.txt
├── .env.example
└── README.md
```

---

## Swapping in Ida Bold

When you have the Ida Bold font files (`.woff2`):

1. Add them to `public/fonts/`
2. In `src/App.jsx`, replace the `GoogleFonts` component with:

```jsx
function FontFace() {
  return (
    <style>{`
      @font-face {
        font-family: 'Ida Bold';
        src: url('/fonts/IdaBold.woff2') format('woff2');
        font-weight: 700 800;
        font-display: swap;
      }
    `}</style>
  );
}
```

3. Change the `BOLD` constant at the top of `App.jsx`:
```js
const BOLD = "'Ida Bold', system-ui, sans-serif";
```

---

## Local development

```bash
npm install
npm run dev
# → http://localhost:5173
```
