"""Aggregate Aircall EOD exports into a compact JSON cube for the dashboard."""
import openpyxl, datetime, json, os, sys, zlib, collections

FILES = [
    ("OHA", r"C:\Users\Danielle\Downloads\OHA INBOUND CALLS.xlsx"),
    ("NON-OHA", r"C:\Users\Danielle\Downloads\NON OHA INBOUND CALLS.xlsx"),
]
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data.js")
SEEN_FILE = os.path.join(BASE, "_seen_ids.json")

NO_IVR = "No IVR Branch / Unassigned"

# normalise messy ivr branch labels (typos / spacing seen in source)
IVR_FIX = {
    "locaation": "Location",
    "complaints": "Complaints",
    "others/ innquiries": "Others / Inquiries",
    "others": "Others",
    "return/ complaints": "Return / Complaints",
    "shipping and location": "Shipping and Location",
}

def clean_ivr(v):
    if v is None:
        return NO_IVR
    s = str(v).strip()
    if s == "" or s.lower() in ("none", "nan", "-"):
        return NO_IVR
    return IVR_FIX.get(s.lower(), s)

def clean_agent(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s in ("[No associated user]", "None"):
        return None
    return s.replace("\ufffd", "n")  # fix mojibake in Cari\ufffdo

def to_secs(v):
    """duration -> seconds. handles numbers, 'H:MM:SS', timedelta, time."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, datetime.timedelta):
        return v.total_seconds()
    if isinstance(v, datetime.time):
        return v.hour * 3600 + v.minute * 60 + v.second
    s = str(v).strip()
    if not s or s.lower() == "none":
        return None
    if ":" in s:
        p = s.split(":")
        try:
            p = [float(x) for x in p]
        except ValueError:
            return None
        while len(p) < 3:
            p.insert(0, 0.0)
        return p[0] * 3600 + p[1] * 60 + p[2]
    try:
        return float(s)
    except ValueError:
        return None

def to_hour(row, idx, r):
    """hour of day from 'call start time', fallback 'time'."""
    for key in ("call start time", "time"):
        if key not in idx:
            continue
        v = r[idx[key]] if idx[key] < len(r) else None
        if v is None:
            continue
        if isinstance(v, datetime.datetime):
            return v.hour
        if isinstance(v, datetime.time):
            return v.hour
        s = str(v).strip()
        if " " in s:
            s = s.split(" ")[-1]
        if ":" in s:
            try:
                return int(s.split(":")[0])
            except ValueError:
                pass
    return None

def to_date(v):
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    s = str(v).strip()[:10]
    return s if len(s) == 10 and s[4] == "-" else None

STATUS = {
    "answered": "answered",
    "missed": "missed",
    "abandoned": "abandoned",
    "out of business hours": "ooh",
}

def classify(call_type, reason, answered):
    ct = (str(call_type or "")).strip().lower()
    if ct in STATUS:
        return STATUS[ct]
    rs = (str(reason or "")).strip().lower()
    if str(answered).strip().lower() == "yes":
        return "answered"
    if rs == "out_of_opening_hours":
        return "ooh"
    if rs in ("abandoned_in_ivr", "short_abandoned"):
        return "abandoned"
    if rs in ("no_available_agent", "agents_did_not_answer"):
        return "missed"
    return "missed"


def load_existing():
    if not os.path.exists(OUT):
        return None
    txt = open(OUT, "r", encoding="utf-8").read()
    i = txt.find("{")
    try:
        d = json.loads(txt[i:txt.rfind("}") + 1])
    except Exception:
        return None
    d["seen"] = json.load(open(SEEN_FILE)) if os.path.exists(SEEN_FILE) else []
    return d


def main(files=FILES, append=False):
    base = load_existing() if append else None
    calls = collections.Counter()      # (date,hour,channel,line,ivr,status) -> n
    dur = collections.Counter()        # same key -> seconds sum (answered only)
    agent = collections.Counter()      # (date,channel,agent,status) -> n
    adur = collections.Counter()
    seen = set()
    issues = collections.Counter()

    if base:
        for k, v in base["cube"].items():
            calls[tuple(k.split("\u0001"))] = v[0]
            dur[tuple(k.split("\u0001"))] = v[1]
        for k, v in base["agents"].items():
            agent[tuple(k.split("\u0001"))] = v[0]
            adur[tuple(k.split("\u0001"))] = v[1]
        seen = set(base["seen"])

    for channel, path in files:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        hdr = [str(h).strip().lower() if h is not None else "" for h in next(it)]
        idx = {h: i for i, h in enumerate(hdr) if h}
        for r in it:
            if r is None or all(x is None for x in r):
                continue
            g = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else None
            cid = g("call id") or g("call id (internal)")
            key_id = f"{channel}|{cid}"
            if cid:
                if key_id in seen:
                    issues["duplicate_skipped"] += 1
                    continue
                seen.add(key_id)
            d = to_date(g("date"))
            if not d:
                issues["missing_date"] += 1
                continue
            h = to_hour(hdr, idx, r)
            if h is None:
                issues["invalid_time"] += 1
                h = -1
            ivr = clean_ivr(g("ivr branch"))
            if ivr == NO_IVR:
                issues["no_ivr_branch"] += 1
            st = classify(g("call type"), g("missed_call_reason"), g("answered"))
            line = str(g("line") or "Unknown").strip()
            ag = clean_agent(g("user"))
            secs = to_secs(g("in-call duration"))
            if secs is None:
                secs = to_secs(g("duration (in call)"))
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
        wb.close()

    cube = {"\u0001".join(k): [v, round(dur[k], 1)] for k, v in calls.items()}
    agents = {"\u0001".join(k): [v, round(adur[k], 1)] for k, v in agent.items()}
    payload = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "cube": cube,
        "agents": agents,
        "issues": dict(issues),
        "noIvrLabel": NO_IVR,
    }
    json.dump(sorted(seen), open(SEEN_FILE, "w"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.CALL_DATA = ")
        json.dump(payload, f, separators=(",", ":"))
        f.write(";\n")
    print("cube keys:", len(cube), "agent keys:", len(agents),
          "calls:", sum(calls.values()), "issues:", dict(issues))
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--append"]
    append = "--append" in sys.argv
    if args:
        # usage: build_data.py --append "file.xlsx" OHA ["file2.xlsx" NON-OHA ...]
        files = []
        for i in range(0, len(args) - 1, 2):
            files.append((args[i + 1].upper(), args[i]))
        main(files=files, append=append)
    else:
        main(append=append)
