/* ---------- core: data model, filtering, aggregation ---------- */
const D = window.CALL_DATA, NO_IVR = D.noIvrLabel;
const SEP = "\u0001";
const ST = ["answered","missed","abandoned","ooh"];
const COL = {answered:"#E8578E",missed:"#D9455F",abandoned:"#B99BDD",ooh:"#D9A0B8"};

// explode cube -> row objects  [date,hour,channel,line,ivr,status] = n, secs
const ROWS = [];
for (const k in D.cube){
  const p = k.split(SEP), v = D.cube[k];
  ROWS.push({d:p[0], h:+p[1], ch:p[2], line:p[3], ivr:p[4], st:p[5], n:v[0], sec:v[1]});
}
const AROWS = [];
for (const k in D.agents){
  const p = k.split(SEP), v = D.agents[k];
  AROWS.push({d:p[0], ch:p[1], ag:p[2], st:p[3], n:v[0], sec:v[1]});
}

const ALL_DATES = [...new Set(ROWS.map(r=>r.d))].sort();
const MIN_D = ALL_DATES[0], MAX_D = ALL_DATES[ALL_DATES.length-1];
const IVRS = [...new Set(ROWS.map(r=>r.ivr))].sort((a,b)=> a===NO_IVR?1:b===NO_IVR?-1:a.localeCompare(b));

/* ---- date helpers (all local, ISO yyyy-mm-dd) ---- */
const dt = s => { const p=s.split("-"); return new Date(+p[0],+p[1]-1,+p[2]); };
const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const addD = (s,n) => { const d=dt(s); d.setDate(d.getDate()+n); return iso(d); };
// week starts Monday
function weekStart(s){ const d=dt(s); const w=(d.getDay()+6)%7; d.setDate(d.getDate()-w); return iso(d); }
function monthStart(s){ return s.slice(0,7)+"-01"; }
// last day of the month for a yyyy-mm key (clamped to MAX_D if the month is partial)
function monthEnd(s){
  const y=+s.slice(0,4), m=+s.slice(5,7);
  const last = new Date(y, m, 0); // day 0 of next month = last day of this month
  let e = iso(last);
  return e > MAX_D ? MAX_D : e;
}
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtD(s){ const d=dt(s); return MON[d.getMonth()]+" "+d.getDate(); }
function fmtDY(s){ return fmtD(s)+", "+s.slice(0,4); }
function fmtWeek(s){ return fmtD(s)+"\u2013"+fmtD(addD(s,6)); }
function fmtMonth(s){ return MON[+s.slice(5,7)-1]+" "+s.slice(0,4); }
function periodKey(d,g){ return g==="none" ? "RANGE" : g==="weekly" ? weekStart(d) : g==="monthly" ? monthStart(d) : d; }
function periodLabel(k,g){ return g==="none" ? "Full Range" : g==="weekly" ? fmtWeek(k) : g==="monthly" ? fmtMonth(k) : fmtD(k); }

/* ---- top-most WEEK / QUARTER navigator ---- */
// All distinct weeks (Mon-Sun) present in the data, oldest -> newest.
function listWeeks(){
  const seen = new Set(), out = [];
  for (const d of ALL_DATES){
    const k = weekStart(d);
    if (!seen.has(k)){ seen.add(k); out.push(k); }
  }
  return out;                  // [weekStartISO, ...]
}
function applyWeek(isoStart){
  // set range to that Mon-Sun; View stays as-is (None/Daily) — user controls granularity
  if (isoStart === "ALL"){
    F.from = MIN_D; F.to = MAX_D;
  } else {
    F.from = isoStart;
    F.to   = addD(isoStart, 6) > MAX_D ? MAX_D : addD(isoStart, 6);
  }
  syncDateInputs();
}
// All distinct months present in the data, oldest -> newest.
function listMonths(){
  const seen = new Set(), out = [];
  for (const d of ALL_DATES){
    const k = d.slice(0,7);                 // "yyyy-mm"
    if (!seen.has(k)){ seen.add(k); out.push(k); }
  }
  return out;                              // ["2026-06","2026-07",...]
}
function applyMonth(ym){
  if (ym === "ALL"){
    F.from = MIN_D; F.to = MAX_D;
  } else {
    const start = ym + "-01";
    // last day of the month = day before the 1st of next month
    const y = +ym.slice(0,4), m = +ym.slice(5,7);
    const ny = m === 12 ? y+1 : y, nm = m === 12 ? 1 : m+1;
    const endNext = ny + "-" + String(nm).padStart(2,"0") + "-01";
    const end = addD(endNext, -1);
    F.from = start < MIN_D ? MIN_D : start;
    F.to   = end   > MAX_D ? MAX_D : end;
  }
  syncDateInputs();
}
function syncDateInputs(){
  if (document.getElementById("fFrom")) document.getElementById("fFrom").value = F.from;
  if (document.getElementById("fTo"))   document.getElementById("fTo").value   = F.to;
}
const F = {chan:"ALL", ivr:"ALL", gran:"daily", ivrGran:"daily", from:MIN_D, to:MAX_D, picks:new Set(),
  page:"main", agGran:"weekly", agPeriod:null, dayScope:"ALL"};

/* ---- filtering ---- */
function pass(r, opt){
  const o = opt||F;
  if (r.d < o.from || r.d > o.to) return false;
  if (o.chan !== "ALL" && r.ch !== o.chan) return false;
  if (o.ivr  !== "ALL" && r.ivr !== o.ivr) return false;
  return true;
}
function slice(opt){ return ROWS.filter(r=>pass(r,opt)); }
/* Like slice() but forces the IVR filter to ALL — used by the IVR Branch
   Performance breakdown, which must always list every branch regardless of
   the selected IVR filter (otherwise clicking a row collapses the table). */
function sliceAllIvr(opt){ return ROWS.filter(r=>pass(r, Object.assign({}, opt||F, {ivr:"ALL"}))); }
function sliceAgents(opt){
  const o = opt||F;
  // agent rows carry no ivr/line dimension -> ignore those filters (documented in UI)
  return AROWS.filter(r => r.d>=o.from && r.d<=o.to && (o.chan==="ALL"||r.ch===o.chan));
}

/* ---- metric aggregation ---- */
function blank(){ return {total:0,answered:0,missed:0,abandoned:0,ooh:0,sec:0,noIvrAband:0,ivrAband:0}; }
function acc(m,r){
  m.total += r.n; m[r.st] += r.n;
  if (r.st==="answered") m.sec += r.sec;
  if (r.st==="abandoned"){ if (r.ivr===NO_IVR) m.noIvrAband += r.n; else m.ivrAband += r.n; }
  return m;
}
function agg(rows){ const m=blank(); rows.forEach(r=>acc(m,r)); return finish(m); }
function finish(m){
  // Calls received by an agent's phone = all calls minus IVR-menu-abandoned (never reached an
  // agent) minus outside-business-hours calls. No-IVR-branch abandoneds ARE counted, because the
  // caller reached an agent and then abandoned (per the raw sheet definition).
  m.agentReceived = m.total - m.ivrAband - m.ooh;
  // Unanswered = calls that reached an agent but were NOT answered.
  m.unanswered = m.agentReceived - m.answered;
  m.answerRate = m.agentReceived ? m.answered  /m.agentReceived*100 : 0;   // answered / calls received by agents
  m.missRate   = m.agentReceived ? m.missed   /m.agentReceived*100 : 0;   // missed / calls received by agents
  m.abandRate  = m.total ? m.abandoned/m.total*100 : 0;
  m.aht        = m.answered ? m.sec/m.answered : 0;
  m.noIvrPct   = m.abandoned ? m.noIvrAband/m.abandoned*100 : 0;
  return m;
}
function groupBy(rows, keyFn){
  const g = new Map();
  rows.forEach(r=>{ const k=keyFn(r); if(!g.has(k)) g.set(k,blank()); acc(g.get(k), r); });
  const out = new Map(); g.forEach((v,k)=>out.set(k, finish(v)));
  return out;
}

/* ---- formatting ---- */
const nf = n => (n||0).toLocaleString("en-US");
const pf = n => (n||0).toFixed(1)+"%";
function mmss(s){ s=Math.round(s||0); const m=Math.floor(s/60), r=s%60;
  return m>=60 ? Math.floor(m/60)+"h "+(m%60)+"m" : m+"m "+String(r).padStart(2,"0")+"s"; }
function hourLbl(h){ if(h<0) return "Unknown"; const ap=h<12?"AM":"PM"; const x=h%12||12; return x+" "+ap; }
function deltaHtml(cur, prev, invert, fmt){
  if (prev===undefined||prev===null) return "";
  const d = cur-prev, f = fmt||nf;
  if (Math.abs(d) < 1e-9) return '<span class="delta flat">&mdash; no change</span>';
  const better = invert ? d<0 : d>0;
  return '<span class="delta '+(better?"up":"down")+'">'+(d>0?"\u25B2 +":"\u25BC ")+f(Math.abs(d)*(1))+'</span>';
}
