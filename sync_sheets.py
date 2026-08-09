"""Pull the OHA / Non-OHA Google Sheets and rebuild data.js.

Usage:
    python sync_sheets.py            # fetch both sheets, rebuild dashboard data
    python sync_sheets.py --watch    # keep running, re-check every 10 minutes

The sheets must be shared as "Anyone with the link can view".
"""
import csv, io, json, os, sys, time, datetime, collections, urllib.request

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
