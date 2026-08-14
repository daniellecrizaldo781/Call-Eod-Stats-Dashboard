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

# Optional: Call Breakdown ticket sheet (multi-tab). Repo secret BREAKDOWN_SHEET.
BREAKDOWN_SECRET = os.environ.get("BREAKDOWN_SHEET")

# Optional 5th sheet: the team's break / lunch / back-office tracker
# (per-agent, per-day totals of break minutes). Stored as repo secret
# BREAK_SHEET = "SHEET_ID|GID" (single tab). If unset, breaks are skipped.
BREAK_SECRET = os.environ.get("BREAK_SHEET")


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

    Layout (observed): each section is a banner row ('Team Cess' / 'Team Brai' /
    'Team Danielle' / 'Overtime Shift Schedule'). The banner row itself usually
    carries the date labels in cols 2+ (sometimes the date labels sit on the row
    immediately BEFORE the banner, e.g. the overtime block). After the banner a
    'Designation' / day-of-week row follows, then agent rows
    [agentName, designation, shiftTextForDate1, ...].

    Returns [] if SCHED_SECRET is missing. Produces:
      raw:  [{team, team_key, dates:[(col,ISO)...], agents:[{name, desig, cells:[rawText...], ot_team?}]}]
      rows: [{d, agent, team, desig, text, hours:[int...]}]   # one per agent per scheduled date
            (also feeds the Forecast page; hours derived from text)
    """
    if not SCHED_SECRET or "|" not in SCHED_SECRET:
        print("SCHED_SHEET not set — skipping schedule data", flush=True)
        return []
    sid, gid = SCHED_SECRET.split("|", 1)
    sid = sid.strip(); gid = gid.strip()
    print("fetching schedule ...", flush=True)
    text = fetch(sid, gid)
    rdr = csv.reader(io.StringIO(text))
    raw_rows = [r for r in rdr if r and any(str(x).strip() for x in r)]

    def looks_date(s):
        return bool(re.search(r"[A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4}", str(s)))

    def parse_dates(r):
        out = []
        for ci, cell in enumerate(r):
            if ci < 2:
                continue
            s = str(cell).strip()
            if not looks_date(s):
                continue
            s2 = s.replace(",", " ")
            d = None
            for fmt in ("%b %d %Y", "%B %d %Y"):
                try:
                    d = datetime.datetime.strptime(s2, fmt).date().isoformat()
                    break
                except ValueError:
                    continue
            if d:
                y = int(d[:4])
                if y < 2000:      # skip Google Sheets serial-date artifacts (e.g. 1899-12-31)
                    continue
                out.append((ci, d))
        return out

    def is_title(a0):
        a = (a0 or "").strip()
        if not a:
            return False
        if re.search(r"team\s+\w+", a, re.I):
            return True
        if a.lower().startswith("overtime") or a.lower().startswith("ovetime"):
            return True
        return False

    def team_key(name):
        u = name.lower()
        if u.startswith("overtime") or u.startswith("ovetime"):
            return "overtime"
        if "cess" in u: return "cess"
        if "brai" in u: return "brai"
        if "danielle" in u or "dani" in u: return "danielle"
        return "other"

    def norm_team(t):
        u = t.strip().upper()
        if u.startswith("OHA"): return "OHA"
        if u.startswith("NON"): return "NON-OHA"
        if u.startswith("ALL"): return "ALL"
        return t.strip().upper() or "ALL"

    sections = []          # list of {team, team_key, dates, agents}
    rows_out = []           # flattened agent-date rows (feeds Forecast page)
    roster = {"brai": set(), "danielle": set(), "cess": set(), "other": set()}
    cur = None
    last_valid_dates = []   # most recent section that had real dates (fallback for header-less blocks)
    for i, r in enumerate(raw_rows):
        a0 = (r[0].strip() if r else "")
        if is_title(a0):
            key = team_key(a0)
            dc = parse_dates(r)
            if not dc and i > 0:
                dc = parse_dates(raw_rows[i - 1])   # date labels sometimes sit on the prior row
            if not dc:
                dc = list(last_valid_dates)        # fallback: borrow last valid date set (e.g. OT block w/ no headers)
            cur = {"team": a0, "team_key": key, "dates": dc, "agents": []}
            if dc:
                last_valid_dates = list(dc)
            sections.append(cur)
            roster.setdefault(key, set())
            continue
        if not a0:
            continue
        if cur is None:
            cur = {"team": "Team", "team_key": "other", "dates": parse_dates(r), "agents": []}
            sections.append(cur)
        team_label = norm_team(r[1] if len(r) > 1 else "")
        cells = []
        for ci, d in cur["dates"]:
            txt = (r[ci].strip() if ci < len(r) else "")
            cells.append(txt)
            hrs = _shift_hours(txt)
            if hrs:
                rows_out.append({"d": d, "agent": a0, "team": team_label,
                                 "desig": team_label, "text": txt, "hours": sorted(hrs)})
        ot_team = None
        if cur["team_key"] == "overtime":
            if a0 in roster.get("brai", set()):
                ot_team = "brai"
            elif a0 in roster.get("danielle", set()):
                ot_team = "danielle"
            else:
                ot_team = "danielle"
        cur["agents"].append({"name": a0, "desig": team_label,
                              "cells": cells, "ot_team": ot_team})
        if cur["team_key"] in roster:
            roster[cur["team_key"]].add(a0)

    # merge duplicate team sections (keep first banner name + combined agents)
    merged = {}
    merged_order = []
    for s in sections:
        k = s["team_key"]
        if k == "overtime":
            merged.setdefault("overtime", {"team": "Overtime Shift Schedule", "team_key": "overtime", "dates": s["dates"], "agents": []})
            merged["overtime"]["agents"].extend(s["agents"])
            if "overtime" not in merged_order:
                merged_order.append("overtime")
            continue
        if k in merged:
            merged[k]["agents"].extend(s["agents"])
            if merged[k]["dates"] and s["dates"]:
                pass  # keep first section's dates
        else:
            merged[k] = {"team": s["team"], "team_key": k, "dates": s["dates"], "agents": s["agents"]}
            merged_order.append(k)
    raw_out = [merged[k] for k in merged_order if merged[k]["agents"]]

    print("  schedule: %d agent-date shifts across %d team section(s)" % (len(rows_out), len(raw_out)), flush=True)
    return {"raw": raw_out, "rows": rows_out}


def _safe_schedule():
    """Run build_schedule() but never let it abort the whole sync."""
    try:
        return build_schedule()
    except Exception as e:
        print("!! schedule failed (skipped): " + str(e), flush=True)
        return []


def build_breaks():
    """Pull the break/lunch/back-office tracker sheet.

    Layout: one row per (Member, Date, activity). Column 3 (Client) holds the
    activity label (e.g. '1st break (15 minutes)', 'Restroom Break',
    'Call Support - ORICLE', 'CSR - Call Team, Team Brai - CALL TEAM').
    Column 1 = Member, column 2 = Date, column 8 (Break time) and column 7
    (Regular hours) hold H:MM:SS durations.

    NOTE: the sheet records per-DAY totals, NOT per-interval timestamps, so we
    can only compute total break minutes per agent per day (used to derive an
    unavailable fraction), never "who was on break at 2 PM".

    Returns {} if BREAK_SECRET is missing. Produces:
      byMember: { "Member|ISOdate": {regular, break, restroom, backoffice, total} }  (seconds)
      dates:    [ISO...]   present in the sheet
      members:  [name...]
    """
    if not BREAK_SECRET or "|" not in BREAK_SECRET:
        print("BREAK_SHEET not set — skipping break data", flush=True)
        return {}
    sid, gid = BREAK_SECRET.split("|", 1)
    sid = sid.strip(); gid = gid.strip()
    print("fetching breaks ...", flush=True)
    text = fetch(sid, gid)
    rdr = csv.reader(io.StringIO(text))
    rows = [r for r in rdr if r and any(str(x).strip() for x in r)]
    if not rows:
        return {}
    hdr = [str(h).strip().lower() for h in rows[0]]
    idx = {h: i for i, h in enumerate(hdr) if h}

    def col(name):
        # activity label is in 'client' (col 3); fall back to first matching header
        if name in idx:
            return idx[name]
        # the break sheet stores the task label in the 'client' column
        return idx.get("client", idx.get("task", -1))

    i_member = idx.get("member", 0)
    i_date = idx.get("date", 1)
    i_break = idx.get("break time", idx.get("break", 8))
    i_reg = idx.get("regular hours", idx.get("regular", 7))

    # The sheet's header is shifted one column from its data (the activity label
    # such as 'Restroom Break' / '1st break (15 minutes)' / 'Call Support ...'
    # lives in the data column that the header labels 'project', not 'client').
    # Detect the activity column by scanning data rows for a known label.
    KNOWN = ("restroom", "break", "lunch", "back", "admin", "call support", "csr")
    i_activity = -1
    for ci in range(len(hdr)):
        for r in rows[1:200]:
            if ci < len(r) and (r[ci].strip().lower()) and any(k in r[ci].strip().lower() for k in KNOWN):
                i_activity = ci
                break
        if i_activity >= 0:
            break
    if i_activity < 0:
        i_activity = idx.get("client", idx.get("to-do", idx.get("project", 3)))

    def to_secs(v):
        s = (str(v or "")).strip()
        if not s or s == "-":
            return 0.0
        parts = s.split(":")
        try:
            parts = [float(x) for x in parts]
        except ValueError:
            return 0.0
        while len(parts) < 3:
            parts.insert(0, 0.0)
        return parts[0] * 3600 + parts[1] * 60 + parts[2]

    def categorize(label):
        l = (label or "").lower()
        if "restroom" in l:
            return "restroom"
        if "1st break" in l or "2nd break" in l or "break" in l:
            return "break"
        if "lunch" in l:
            return "lunch"
        if "back" in l or "admin" in l:
            return "backoffice"
        if "call" in l or "csr" in l or "support" in l:
            return "regular"
        return None

    byMember = {}
    dates = set()
    members = set()
    for r in rows[1:]:
        member = (r[i_member].strip() if i_member < len(r) else "")
        if not member:
            continue
        date = (r[i_date].strip() if i_date < len(r) else "")
        if not date:
            continue
        activity = (r[i_activity].strip() if i_activity < len(r) else "")
        cat = categorize(activity)
        if cat is None:
            continue
        dates.add(date)
        members.add(member)
        sec = to_secs(r[i_break].strip() if i_break < len(r) else "")
        if cat == "regular":
            reg = to_secs(r[i_reg].strip() if i_reg < len(r) else "") or sec
            sec = reg  # regular call-work minutes
        key = member + "|" + date
        d = byMember.setdefault(key, {"regular": 0.0, "break": 0.0, "restroom": 0.0,
                                       "lunch": 0.0, "backoffice": 0.0, "total": 0.0})
        if cat == "regular":
            d["regular"] += sec
        elif cat == "break":
            d["break"] += sec
        elif cat == "restroom":
            d["restroom"] += sec
        elif cat == "lunch":
            d["lunch"] += sec
        elif cat == "backoffice":
            d["backoffice"] += sec
        # unavailable = break + restroom + lunch + backoffice
        d["total"] = d["break"] + d["restroom"] + d["lunch"] + d["backoffice"]

    print("  breaks: %d member-days across %d dates" % (len(byMember), len(dates)), flush=True)
    return {"byMember": byMember, "dates": sorted(dates), "members": sorted(members)}


def _safe_breaks():
    """Run build_breaks() but never let it abort the whole sync."""
    try:
        return build_breaks()
    except Exception as e:
        print("!! breaks failed (skipped): " + str(e), flush=True)
        return {}


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
        "breaks": (_safe_breaks()),
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
