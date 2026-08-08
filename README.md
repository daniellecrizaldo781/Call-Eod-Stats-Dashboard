# 💗 Call EOD Stats Dashboard

An offline, pink-themed executive BI dashboard for Aircall inbound-call performance across the
**OHA** and **Non-OHA** hotlines. Pure HTML/CSS/vanilla JS with hand-rolled SVG charts — no CDN,
no build step, no internet needed to view it.

---

## Quick start

**View the dashboard** — double-click `index.html`.

**Refresh the data** — double-click `update_dashboard.bat`.

That's it. The `.bat` pulls both Google Sheets, rebuilds the data, and reopens the dashboard.

---

## Data source

The dashboard reads two Google Sheets (both must be shared as *Anyone with the link → Viewer*):

| Channel | Sheet |
|---|---|
| **OHA** | `15Z-j8RJqu-18rBA6esc45wTfGss_Xz7Q5TPpsJ4n7So` |
| **Non-OHA** | `1YCRRmvrhalb8OHt_1UO2vX0iQljgkT6ZrHNEaYY1CuY` |

### Manual sync

```bash
cd ~/call-eod-dashboard

python sync_sheets.py            # pull both sheets once
python sync_sheets.py --watch    # keep running, re-check every 10 minutes
python sync_sheets.py --watch --every=300   # ...every 5 minutes instead
```

Add rows in Google Sheets → run the sync → refresh the browser.

**Safety guarantees**

- **Duplicates blocked** by `call id`, so re-running is always safe.
- **Atomic write** — `data.js` is written to a temp file then swapped, so refreshing
  mid-sync can never show half-written data.
- **Abort on empty** — if a fetch returns nothing, the sync aborts rather than
  destroying your existing `data.js`.

---

## What's in the dashboard

**Filters** — All / OHA / Non-OHA toggle · IVR branch dropdown (incl. *No IVR Branch /
Unassigned*) · presets (Today, Yesterday, This/Last Week, This/Last Month, All Data,
Custom Range) · Daily / Weekly / Monthly granularity · from/to dates.

**Sections**

1. **Executive KPIs** — total, answered, missed, abandoned, OOH, answer/missed/abandon rates, AHT,
   no-IVR abandoned + %, plus an auto-written plain-English summary.
2. **Volume & Mix** — calls by day, call-type donut, calls by hour, answer-rate trend.
3. **Comparisons** — period-over-period with any two periods, and IVR branch period-over-period.
4. **IVR Branch Performance** — answered vs abandoned bars, abandonment ranking, full table,
   and an IVR × Channel breakdown.
5. **Period Performance** — pick any number of weeks/days/months as chips to compare
   (with a first-vs-last delta table), plus an hourly breakdown.
6. **Agent Performance** — per-agent calls handled, AHT, answered, missed; AHT split by OHA/Non-OHA.
7. **Data & Validation** — sync instructions and data-quality counts.

Every number is computed from the source data at render time — nothing is hard-coded.

---

## Business rules

- **Channel** (OHA vs Non-OHA) and **IVR Branch** are separate dimensions and never conflated.
- Calls with a blank IVR value are **kept**, not dropped, and reported as
  **"No IVR Branch / Unassigned"**. Abandoned calls in that bucket are tracked separately
  since they represent callers who hung up before choosing an option.
- **AHT** is computed from real duration seconds (`in-call duration`), never by averaging
  formatted strings. Answered calls with zero/missing duration are excluded from the AHT
  numerator but still counted in volume.
- Data-quality issues are surfaced in the notice bar rather than silently swallowed.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Layout and section markup |
| `styles.css` | Pink executive theme |
| `app-core.js` | Data model, filtering, aggregation, formatters |
| `app-charts.js` | SVG chart primitives (bars, lines, donut) |
| `app-period.js` | Multi-period picker and delta comparison |
| `app-render1/2/3.js` | KPIs & volume · agents · comparisons |
| `app-init.js` | Filter wiring and bootstrap |
| `sync_sheets.py` | Google Sheets → `data.js` |
| `build_data.py` | Excel → `data.js` (legacy/offline path, still works) |
| `update_dashboard.bat` | One-click sync + open |
| `data.js` | Generated aggregate cube |

`data.js` is committed so the dashboard works immediately after cloning.

---

## Troubleshooting

**"Sync failed" / HTML instead of CSV** — a sheet isn't public. Open it → Share →
*Anyone with the link* → **Viewer**.

**Dashboard shows old numbers** — hard-refresh with `Ctrl+F5`.

**Dates parsed wrong** — Google exports dates as text (e.g. `19-Jun-26`). `sync_sheets.py`
handles the common formats; add yours to `parse_date_cell()` if needed.
