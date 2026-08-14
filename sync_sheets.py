"""Pull the OHA / Non-OHA Google Sheets and rebuild data.js.

Usage:
    python sync_sheets.py            # fetch both sheets, rebuild dashboard data
    python sync_sheets.py --watch    # keep running, re-check every 10 minutes

The sheets must be shared as "Anyone with the link can view".
"""
import csv, io, json, os, sys, time, datetime, collections, urllib.request, re

import build_data as B   # reuse the exact same parsing/classification logic

BASE = os.path.dirname(os.path.abspath(__file__))

# Sheet IDs + tab (gid) come from GitHub repo secrets (env vars), NOT hardcoded,
# so they are never publicly visible in this repo. Format: "SHEET_ID|GID".
# Fall back to env only (no plaintext IDs committed).
def _sheet_from_env(name, channel):
    raw = os.environ.get(name)
    if not raw or "|" not in raw:
        raise RuntimeError(
            "Missing repo secret %s — set it in Settings > Secrets and variables > Actions "
            "with value SHEET_ID|GID" % name
        )
    sid, gid = raw.split("|", 1)
    return (channel, sid.strip(), gid.strip())

SHEETS = [
    _sheet_from_env("OHA_SHEET", "OHA"),
    _sheet_from_env("NONOHA_SHEET", "NON-OHA"),
]
URL = "https://docs.google.com/spreadsheets/d/{}/export?format=csv&gid={}"

# Optional 4th sheet: the team's call schedule (agents x dates grid of shift strings).
# Stored as repo secret SCHED_SHEET = "SHEET_ID|GID" (single tab). If unset, schedule is skipped.
SCHED_SECRET = os.environ.get("SCHED_SHEET")


# ---- shift parsing: turn a cell like "6AM-3PM" / "7AM - 8AM\n5PM - 6PM" into a set of hours ----
_HOURS = {str(h): h for h in range(24)}
for h in range(24):
    _HOURS[("%02d" % h) + ":00"] = h
    _HOURS[("%02d" % h)] = h
_MERIDIAN = {"am": 0, "a": 0, "pm": 12, "p": 12}
def _parse_clock(tok):
    """Parse a clock token like '6AM', '3:00 PM', '14' -> hour int or None."""
    tok = tok.strip().lower().replace(".", "")
    if not tok:
        return None
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$", tok)
    if not m:
        return None
    h = int(m.group(1)); ap = m.group(3)
    if ap:
        h = h % 12 + _MERIDIAN[ap]
    elif h >= 24:
        return None
    return h


def _shift_hours(cell):
    """Return a set of hours an agent is scheduled, given a raw schedule cell.
    Handles single or multiple ranges separated by newlines/commas/semicolons.
    Unparseable cells contribute no hours (never fabricated)."""
    if cell is None:
        return set()
    txt = str(cell)
    hours = set()
    # split into separate ranges
    for part in re.split(r"[\n;,]+", txt):
        part = part.strip()
        if not part or part.upper() == "OFF":
            continue
        # a range looks like CLOCK - CLOCK ; a lone clock is a 1-hour slot
        m = re.split(r"\s*(?:to|-|–|—)\s*", part, maxsplit=1)
        if len(m) == 2:
            a = _parse_clock(m[0]); b = _parse_clock(m[1])
            if a is None or b is None:
                continue
            if b < a:
                b += 24          # e.g. 5PM-6PM already fine; 10PM-2AM wraps
            for h in range(a, b):
                hours.add(h % 24)
        else:
            a = _parse_clock(m[0])
            if a is not None:
                hours.add(a % 24)
    return hours


def _money(v):
    if v is None:
        return 0.0
    s = str(v).replace("$", "").replace(",", "").strip()
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def discover_gids(sid):
    """List every tab (worksheet) GID in the sheet via the public gviz metadata endpoint.
    Works for sheets shared 'Anyone with the link can view'. Returns [] if it can't list."""
    url = "https://docs.google.com/spreadsheets/d/{}/gviz/tq?tqx=out:json".format(sid)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print("  !! tab discovery failed: " + str(e), flush=True)
        return []
    # The gviz workbook response embeds a JSON object; extract sheetIds from it.
    import re
    # gviz wraps the JSON in a JS callback; strip it.
    txt = raw
    if txt.lstrip().startswith("/*"):
        txt = txt.lstrip()[2:]
        if txt.startswith("O_o*/"):
            txt = txt[5:]
    txt = txt.strip()
    if txt.startswith("google.visualization.Query.setResponse("):
        txt = txt[len("google.visualization.Query.setResponse("):]
        if txt.rstrip().endswith(");"):
            txt = txt.rstrip()[:-2]
    try:
        obj = json.loads(txt)
    except Exception as e:
        print("  !! tab discovery JSON parse failed: " + str(e), flush=True)
        return []
    gids = []
    # gviz workbook response has a "tables" map keyed by gid when multiple sheets exist
    tables = obj.get("tables") or {}
    for key in tables:
        try:
            gids.append(str(int(key)))
        except ValueError:
            gids.append(str(key))
    if gids:
        print("  discovered " + str(len(gids)) + " tab(s): " + ", ".join(gids), flush=True)
        return gids
    # Fallback: single-sheet workbook — pull the default (gid 0)
    print("  (single-sheet workbook — using default tab)", flush=True)
    return ["0"]


def build_breakdown():
    """Pull the Call Breakdown ticket sheet into a compact array of row dicts.
    Returns [] if the secret is missing (so the rest of the dashboard is unaffected).

    Secret format (repo secret BREAKDOWN_SHEET):
      - "SHEET_ID"                      -> discover & pull EVERY tab in the sheet
      - "SHEET_ID|GID1|GID2|..."        -> pull only the listed tabs (backward compatible)
    """
    if not BREAKDOWN_SECRET or "|" not in BREAKDOWN_SECRET:
        print("BREAKDOWN_SHEET not set — skipping Call Breakdown data", flush=True)
        return []
    parts = [p.strip() for p in BREAKDOWN_SECRET.split("|")]
    sid = parts[0]
    if not sid:
        print("BREAKDOWN_SHEET missing sheet id — skipping Call Breakdown data", flush=True)
        return []
    gids = parts[1:]
    if not gids:
        # bare SHEET_ID -> auto-discover all tabs
        gids = discover_gids(sid)
        if not gids:
            print("  (no tabs discovered — skipping)", flush=True)
            return []
    print("fetching Call Breakdown (" + str(len(gids)) + " tab(s)) ...", flush=True)
    out = []
    n = 0
    for gi, gid in enumerate(gids):
        try:
            text = fetch(sid, gid)
        except Exception as e:
            print("  !! tab " + str(gi + 1) + " (gid " + gid + ") fetch failed: " + str(e) + " — skipping", flush=True)
            continue
        rows = list(rows_from_csv(text))
        if not rows:
            print("  (tab " + str(gi + 1) + " empty)", flush=True)
            continue
        for idx, r in rows:
            g = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else None
            d = parse_date_cell(g("date"))
            if not d:
                continue
            brand = (str(g("brand") or "Unknown")).strip() or "Unknown"
            out.append({
                "d": d,                                   # ISO date
                "brand": brand,
                "channel": (str(g("channel") or "ALL")).strip() or "ALL",
                "concern": (str(g("concern type") or "Unknown")).strip() or "Unknown",
                "cat": (str(g("category") or "Unknown")).strip() or "Unknown",     # = branch
                "sub": (str(g("subcategory") or "Unknown")).strip() or "Unknown",  # = call driver
                "res": (str(g("resolution") or "Unknown")).strip() or "Unknown",
                "refund": _money(g("total amount refunded")),
            })
            n += 1
        print("  tab " + str(gi + 1) + ": " + str(len(rows)) + " rows", flush=True)
    print("  Call Breakdown total", n, "tickets", flush=True)
    return out


def fetch(sid, gid):
    url = URL.format(sid, gid)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    if b"<html" in raw[:400].lower():
        raise RuntimeError(
            "Google returned an HTML page instead of CSV — the sheet is not public.\n"
            "Open it, click Share, and set 'Anyone with the link' to Viewer."
        )
    return raw.decode("utf-8", errors="replace")


def rows_from_csv(text):
    rdr = csv.reader(io.StringIO(text))
    hdr = [h.strip().lower() for h in next(rdr)]
    idx = {h: i for i, h in enumerate(hdr) if h}
    for r in rdr:
        if not r or all(not str(x).strip() for x in r):
            continue
        yield idx, r


def parse_date_cell(v):
    """CSV dates arrive as text; try the common Google/Excel renderings."""
    s = str(v).strip()
    if not s:
        return None
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y",
              "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%B %d, %Y", "%b %d, %Y",
              "%d-%B-%y", "%Y/%m/%d"):
        try:
            return datetime.datetime.strptime(s, f).date().isoformat()
        except ValueError:
            pass
    return B.to_date(s)


def hour_from_cell(idx, r):
    for key in ("call start time", "time"):
        if key not in idx or idx[key] >= len(r):
            continue
        s = str(r[idx[key]]).strip()
        if not s:
            continue
        if " " in s:
            s = s.split(" ")[-1]
        if ":" in s:
            try:
                return int(s.split(":")[0])
            except ValueError:
                pass
    return None


def build_schedule():
    """Pull the team schedule sheet (agents x dates grid of shift strings).

    Layout (observed): row 0 = dates header (col B+), row 1 = ['', 'Designation', <dow>, ...],
    each following row = [agentName, designation, shiftForDate1, shiftForDate2, ...].
    Returns [] if SCHED_SECRET is missing. Produces compact records:
        {d: ISO date, agent, team, hours:[int,...]}   # one record per agent per scheduled date
    """
    if not SCHED_SECRET or "|" not in SCHED_SECRET:
        print("SCHED_SHEET not set — skipping schedule data", flush=True)
        return []
    sid, gid = SCHED_SECRET.split("|", 1)
    sid = sid.strip(); gid = gid.strip()
    print("fetching schedule ...", flush=True)
    text = fetch(sid, gid)
    rows = list(rows_from_csv(text))
    if not rows:
        print("  (schedule empty)", flush=True)
        return []
    hdr = [h.strip().lower() for h in next(iter(rows_from_csv(text)))] if False else None
    # reuse the parsed rows; recompute header from the first non-empty row
    rdr = csv.reader(io.StringIO(text))
    raw = [r for r in rdr if r and any(str(x).strip() for x in r)]
    # header row = first row whose col-A is blank and col-B looks like a date (the dates banner)
    def looks_date(s):
        return bool(re.search(r"[A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4}", str(s)))
    date_cols = []   # list of (col_index, iso_date)
    header_row = None
    for ri, r in enumerate(raw):
        if ri == 0 and (not r[0].strip()) and looks_date(r[1] if len(r) > 1 else ""):
            header_row = r
            break
    if header_row is None:
        # fallback: assume first row is the date banner
        header_row = raw[0]
    for ci, cell in enumerate(header_row):
        if ci < 2:
            continue
        s = str(cell).strip()
        if not looks_date(s):
            continue
        s2 = s.replace(",", "")
        d = None
        for fmt in ("%b %d %Y", "%B %d %Y"):
            try:
                d = datetime.datetime.strptime(s2, fmt).date().isoformat()
                break
            except ValueError:
                continue
        if d:
            date_cols.append((ci, d))
    if not date_cols:
        print("  (no date columns found in schedule — skipping)", flush=True)
        return []
    out = []
    n_dates = 0
    for r in raw[1:]:
        name = (r[0].strip() if r and len(r) > 0 else "")
        if not name:
            continue
        team = (r[1].strip() if len(r) > 1 else "")
        team = "OHA" if team.upper().startswith("OHA") else ("NON-OHA" if team.upper().startswith("NON") else "ALL")
        for ci, d in date_cols:
            if ci >= len(r):
                continue
            hrs = _shift_hours(r[ci])
            if hrs:
                out.append({"d": d, "agent": name, "team": team, "hours": sorted(hrs)})
                n_dates += 1
    print("  schedule: %d agent-date shifts" % n_dates, flush=True)
    return out


def _safe_schedule():
    """Run build_schedule() but never let it abort the whole sync."""
    try:
        return build_schedule()
    except Exception as e:
        print("!! schedule failed (skipped): " + str(e), flush=True)
        return []


def _safe_breakdown():
    """Run build_breakdown() but never let it abort the whole sync."""
    try:
        return build_breakdown()
    except Exception as e:
        print("!! Call Breakdown failed (skipped): " + str(e), flush=True)
        return []


def build():
    calls, dur = collections.Counter(), collections.Counter()
    agent, adur = collections.Counter(), collections.Counter()
    issues = collections.Counter()
    seen = set()
    per_sheet = {}

    for channel, sid, gid in SHEETS:
        print("fetching", channel, "...", flush=True)
        text = fetch(sid, gid)
        n = 0
        for idx, r in rows_from_csv(text):
            g = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else None
            cid = (g("call id") or g("call id (internal)") or "").strip()
            key_id = channel + "|" + cid
            if cid:
                if key_id in seen:
                    issues["duplicate_skipped"] += 1
                    continue
                seen.add(key_id)
            d = parse_date_cell(g("date"))
            if not d:
                issues["missing_date"] += 1
                continue
            h = hour_from_cell(idx, r)
            if h is None:
                issues["invalid_time"] += 1
                h = -1
            ivr = B.clean_ivr(g("ivr branch"))
            if ivr == B.NO_IVR:
                issues["no_ivr_branch"] += 1
            st = B.classify(g("call type"), g("missed_call_reason"), g("answered"))
            line = (str(g("line") or "Unknown")).strip() or "Unknown"
            ag = B.clean_agent(g("user"))
            secs = B.to_secs(g("in-call duration"))
            if secs is None:
                secs = B.to_secs(g("duration (in call)"))
            if st == "answered" and (secs is None or secs <= 0):
                issues["invalid_aht"] += 1
                secs = 0.0
            secs = secs or 0.0

            k = (d, str(h), channel, line, ivr, st)
            calls[k] += 1
            if st == "answered":
                dur[k] += secs
            if ag:
                ka = (d, channel, ag, st)
                agent[ka] += 1
                if st == "answered":
                    adur[ka] += secs
            elif st == "answered":
                issues["answered_without_agent"] += 1
            n += 1
        per_sheet[channel] = n
        print("  ", channel, n, "rows", flush=True)

    if not calls:
        raise RuntimeError("No rows parsed — aborting so the existing data.js is not destroyed.")

    S = "\u0001"
    payload = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "source": "google-sheets",
        "cube": {S.join(k): [v, round(dur[k], 1)] for k, v in calls.items()},
        "agents": {S.join(k): [v, round(adur[k], 1)] for k, v in agent.items()},
        "issues": dict(issues),
        "noIvrLabel": B.NO_IVR,
        "rowsPerSheet": per_sheet,
        "breakdown": (_safe_breakdown()),
        "schedule": (_safe_schedule()),
    }
    out = os.path.join(BASE, "data.js")
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.CALL_DATA = ")
        json.dump(payload, f, separators=(",", ":"))
        f.write(";\n")
    os.replace(tmp, out)   # atomic: dashboard never reads a half-written file
    json.dump(sorted(seen), open(os.path.join(BASE, "_seen_ids.json"), "w"))
    total = sum(calls.values())
    print("OK  %s calls  %s cube keys  issues=%s" % (total, len(payload["cube"]), dict(issues)))
    print("wrote", out)
    return total


if __name__ == "__main__":
    if "--watch" in sys.argv:
        every = 600
        for a in sys.argv:
            if a.startswith("--every="):
                every = int(a.split("=")[1])
        print("watching Google Sheets every %ss — Ctrl+C to stop" % every)
        last = None
        while True:
            try:
                t = build()
                if last is not None and t != last:
                    print(">>> data changed: %s -> %s calls" % (last, t))
                last = t
            except Exception as e:
                print("!! sync failed:", e)
            time.sleep(every)
    else:
        build()
