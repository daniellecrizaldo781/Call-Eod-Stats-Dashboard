/* ---------- Agent Status History ----------
   Reads D.status.rows = [{d, t, agent, team, team_key, status, min}] built by
   sync_sheets.build_status() (one row per status interval, min = minutes).
   The sheet has ONE TAB PER TEAM; each row is tagged with its authoritative team_key.

   Surfaces (all computed client-side so the Week toggle filters live):
     • Back-office load per agent  (hours in the "doing_back_office" status tag only)
     • Aux-jumping flags           (3+ away-aux toggles within 10 min, resolving to available)
     • Time in Status per Status   (total hours per aux state, per agent)
   Honors the Team chips (Danielle / Brai / Cess / Entire) and a Week toggle.
   If STATUS_SHEET is not set, D.status is {rows:[]} and we show a friendly notice.
*/

const ST_TEAMS = [
  {key:"all",      label:"Entire Call Team"},
  {key:"danielle", label:"Team Danielle"},
  {key:"brai",     label:"Team Brai"},
  {key:"cess",     label:"Team Cess"},
];

// abbreviation map: full status label -> short column/cause label
const AUX_ABBR = {
  offline:"offline", available:"avail", in_call:"in_call", ringing:"ring",
  after_call_work:"acw", doing_back_office:"back_off", back_office:"back_off",
  other:"other", do_not_disturb:"dnd", on_a_break:"break", out_for_lunch:"lunch",
  in_training:"train"
};

// back-office = ONLY the "doing_back_office" status tag from the sheet
// (do NOT sum admin/training/break/lunch/offline/etc. — those are separate auxes)
const AUX_BACK = ["doing_back_office"];
function isBack(label){
  const l = (label||"").toLowerCase().replace(/ /g,"_");
  return l === "doing_back_office";
}
function normStatus(label){
  let l = (label||"").toLowerCase().replace(/ /g,"_").trim();
  if (!l || ["-","nan","none","null"].indexOf(l) > -1) return null;
  l = l.replace(/^[^a-z0-9]+/,"").replace(/[(\-]\s*\d+\s*[sm]?\s*[)]?$/,"").replace(/[._:-]+$/,"");
  if (!l) return null;
  return l.split(/[(\/]/)[0];
}
function fmtHrs(min){
  if (min > 0 && min < 0.3) return "<0.01 h";
  const h = min/60;
  if (h >= 100) return nf(Math.round(h)) + " h";
  if (h >= 10)  return h.toFixed(1) + " h";
  return h.toFixed(2) + " h";
}
function inWeek(d, wk){
  if (!wk || wk === "ALL") return true;
  return weekStart(d) === wk;
}

function renderStatus(){
  const root = $("pageAgent");
  if (!root || F.page !== "agent") return;        // only render on the agent page
  const wrap = $("stKpis");
  if (!wrap) return;
  const st = D.status;
  const rows = (st && st.rows) || [];
  if (!rows.length){
    wrap.innerHTML = '<div class="empty" style="padding:18px">No Agent Status History data. '
      + 'Add the <b>STATUS_SHEET</b> repo secret (SHEET_ID|GID_BRAI|GID_DANIELLE|GID_CESS) and '
      + 'make the sheet public ("Anyone with the link can view"). The hourly sync will populate this section.</div>';
    ["chStatusBO","tStatusJump","tStatusPerAgent","tStatusDailyBO"].forEach(id => { const e=$(id); if (e) e.innerHTML=""; });
    return;
  }

  const team = F.stTeam || "all";
  const wk   = F.stWeek || "ALL";
  const teamLabel = (ST_TEAMS.find(t => t.key === team) || {}).label || "Entire Call Team";

  // filter rows by team + week
  const filt = rows.filter(r =>
    (team === "all" || r.team_key === team) && inWeek(r.d, wk));

  // Away (not-available, not-live-call) states considered for aux-jumping.
  // An agent is flagged only when they flicker among these (offline / back office /
  // other / etc.) 3+ times within a few minutes, then go back ONLINE (available).
  // A normal call cycle (ringing -> in_call -> after_call_work -> available) is NOT a jump.
  const AWAY = new Set(["offline","doing_back_office","back_office","other","do_not_disturb",
    "on_a_break","out_for_lunch","in_training"]);
  const JUMP_WINDOW = 10; // minutes: away flicker must resolve this fast before going online

  // aggregate per agent
  const A = {};   // agent -> {team, team_key, min, bo_min, auxes, statusMin}
  // per-agent per-day timeline (event clock = cumulative minutes from day start)
  const TL = {};  // agent -> { date -> {last, ev:[{state, off}]} }
  filt.forEach(r => {
    const a = A[r.agent] || (A[r.agent] = {team:r.team, team_key:r.team_key, min:0, bo_min:0,
      auxes:{}, statusMin:{}});
    const m = +r.min || 0;
    a.min += m;
    if (isBack(r.status)) a.bo_min += m;
    const ns = normStatus(r.status);
    if (ns) a.auxes[ns] = (a.auxes[ns]||0) + m;
    if (r.status) a.statusMin[r.status] = (a.statusMin[r.status]||0) + m;
    // timeline
    TL[r.agent] = TL[r.agent] || {};
    const day = TL[r.agent][r.d] || (TL[r.agent][r.d] = {last:0, ev:[]});
    day.ev.push({state:(r.status||"").toLowerCase(), off:day.last});
    day.last += m;
  });

  // aux-jump = >=3 away toggles within JUMP_WINDOW minutes, ending when agent goes available.
  // BUT we do NOT flag it when that availability flows straight into a NEW OUTBOUND CALL
  // (ringing -> in_call): going back-office / online to engage an outbound call is legitimate
  // work, not aux-jumping. Records the away-states seen in each qualifying flicker for the CAUSE column.
  const ENGAGE_WINDOW = 12; // min: how soon after "available" an outbound call may start
  function computeJumps(ev, cause){
    let jumps = 0, win = [];
    for (let i=0;i<ev.length;i++){
      const e = ev[i];
      if (e.state === "available"){
        const recent = win.filter(w => (e.off - w.off) <= JUMP_WINDOW);
        if (recent.length >= 3 && new Set(recent.map(w => w.state)).size >= 2){
          // peek ahead: if this availability leads into an outbound call (ringing/in_call) shortly,
          // it's the agent going online to take/make a call — NOT an aux-jump
          let engaged = false;
          for (let j=i+1;j<ev.length;j++){
            const dt = ev[j].off - e.off;
            if (dt > ENGAGE_WINDOW) break;
            const st = ev[j].state;
            if (st === "ringing" || st === "in_call"){ engaged = true; break; }
            // another away flicker or re-available before any call = not a clean call takeoff
            if (st === "available" || AWAY.has(st)) break;
          }
          if (!engaged){
            jumps++;
            recent.forEach(w => { cause[w.state] = (cause[w.state]||0) + 1; });
          }
        }
        win = [];
      } else if (AWAY.has(e.state)){
        win.push({state:e.state, off:e.off});
        while (win.length && (e.off - win[0].off) > JUMP_WINDOW) win.shift();
      }
      // live-call states (ringing/in_call/after_call_work) are ignored for jump detection
    }
    return jumps;
  }

  const agents = Object.entries(A).map(([n,a]) => {
    const cause = {};
    let jumps = 0;
    const days = TL[n] || {};
    Object.keys(days).forEach(d => { jumps += computeJumps(days[d].ev, cause); });
    return {name:n, team:a.team, team_key:a.team_key, min:a.min, bo_min:a.bo_min,
            jumps, cause, distinct_aux:Object.keys(a.auxes).length, auxes:a.auxes, statusMin:a.statusMin};
  });

  const s = ($("stSort") ? $("stSort").value : "bo_desc");
  const cmp = {
    bo_desc:(x,y)=> y.bo_min - x.bo_min,
    bo_asc :(x,y)=> x.bo_min - y.bo_min,
    jumps_desc:(x,y)=> y.jumps - x.jumps,
    name:(x,y)=> x.name.localeCompare(y.name),
  }[s] || ((x,y)=> y.bo_min - x.bo_min);
  agents.sort(cmp);

  const totalBO = agents.reduce((s, a) => s + a.bo_min, 0);
  const jumpers = agents.filter(a => a.jumps > 0);
  const topBO   = agents.length ? agents[0] : null;

  // KPIs
  wrap.innerHTML =
      kpi("Back-Office Hours", fmtHrs(totalBO), teamLabel + (wk!=="ALL" ? " · " + fmtWeek(wk) : " · total"), "alt")
    + kpi("Agents Tracked", nf(agents.length), teamLabel, "big")
    + kpi("Aux-Jumping Agents", nf(jumpers.length), "away-aux flicker before online", jumpers.length ? "bad" : "good")
    + kpi("Top Back-Office", topBO ? esc(topBO.name) : "—",
          topBO ? fmtHrs(topBO.bo_min) : "", "warn");

  // Back-office bar chart -- show HOURS (value is minutes in data).
  // Entire Call Team: top 5 only; individual teams: top 20.
  const boTop = (team === "all") ? 5 : 20;
  const bo = agents.filter(a => a.bo_min > 0).slice(0, boTop);
  if (bo.length){
    hBars("chStatusBO", bo.map(a => ({label:a.name, value:a.bo_min/60,
      note: fmtHrs(a.bo_min) + " back-office"})), {unit:"h", labelW:160, color:"#B99BDD"});
  } else {
    $("chStatusBO").innerHTML = '<div class="empty">No back-office hours for this selection.</div>';
  }

  // Aux-jumping table  -- with a "What Causes It" column explaining the away-aux flicker
  const flagged = jumpers.slice().sort((x,y) => y.jumps - x.jumps);
  const jrows = flagged.map(a => {
    const topAux = Object.entries(a.auxes).sort((x,y)=>y[1]-x[1]).slice(0,3)
      .map(([k,v]) => esc(k) + " (" + (v/60).toFixed(1) + "h)").join(", ");
    // cause: away-states that appeared in the agent's flicker windows, by frequency
    const cause = Object.entries(a.cause).sort((x,y)=>y[1]-x[1])
      .map(([k,v]) => (AUX_ABBR[k]||k) + " ×" + v).join(", ");
    return {a:esc(a.name), t:'<span class="tag lav">'+esc(a.team)+'</span>',
            j:nf(a.jumps), d:nf(a.distinct_aux), aux: topAux || "—",
            cause: cause || "—", bo: fmtHrs(a.bo_min)};
  });
  tbl($("tStatusJump"),
    [{t:"Agent",k:"a"},{t:"Team",k:"t"},{t:"Aux-Jumps",k:"j",n:1},
     {t:"Distinct Aux",k:"d",n:1},{t:"Top Aux States",k:"aux"},{t:"What Causes It",k:"cause"},{t:"Back-Office",k:"bo",n:1}],
    jrows.length ? jrows :
      [{a:'<div class="empty" style="padding:14px">No agents flagged for aux-jumping in this selection. 🎉</div>', t:"", j:"", d:"", aux:"", cause:"", bo:""}]);

  // Per-agent time-in-status table  ->  PIVOT: one column per status, one row per agent
  // (much easier to scan than one giant stacked cell per agent)
  const STATUS_ABBR = {
    offline:"offline", available:"avail", in_call:"in_call", ringing:"ring",
    after_call_work:"acw", doing_back_office:"back_off", back_office:"back_off",
    other:"other", do_not_disturb:"dnd", on_a_break:"break", out_for_lunch:"lunch",
    in_training:"train"
  };
  const STATUS_ORDER = ["offline","available","in_call","ringing","after_call_work",
    "doing_back_office","other","do_not_disturb","on_a_break","out_for_lunch","in_training"];
  // union of statuses present, ordered by STATUS_ORDER then any extras
  const allSt = [];
  agents.forEach(a => Object.keys(a.statusMin).forEach(s => { if (!allSt.includes(s)) allSt.push(s); }));
  allSt.sort((x,y) => {
    const ix = STATUS_ORDER.indexOf(x), iy = STATUS_ORDER.indexOf(y);
    return (ix<0?99:ix) - (iy<0?99:iy) || x.localeCompare(y);
  });
  const stCols = allSt.map(s => ({t: STATUS_ABBR[s] || s, k:"_" + s, n:1}));
  const perRows = agents.map(a => {
    const row = {a:esc(a.name), t:'<span class="tag lav">'+esc(a.team)+'</span>',
                 tot:fmtHrs(a.min), bo:fmtHrs(a.bo_min)};
    allSt.forEach(s => { row["_" + s] = a.statusMin[s] ? fmtHrs(a.statusMin[s]) : "0.00"; });
    return row;
  });
  tbl($("tStatusPerAgent"),
    [{t:"Agent",k:"a"},{t:"Team",k:"t"},{t:"Total Hrs",k:"tot",n:1},{t:"Back-Office Hrs",k:"bo",n:1}]
      .concat(stCols),
    perRows.length ? perRows :
      [{a:'<div class="empty" style="padding:14px">No status data for this selection.</div>', t:"", tot:"", bo:""}]);
  // legend mapping abbreviations -> full status names
  const leg = $("stStatusLegend");
  if (leg){
    leg.innerHTML = "<b>Status key:</b> " + allSt.map(s =>
      '<span class="lg"><b>'+(STATUS_ABBR[s]||s)+'</b> = '+esc(s)+'</span>').join(" &middot; ");
  }

  // Daily back-office hours per agent -- wide pivot (Agent | Team | Total | <date>...)
  // Plus chips: highest-ever single-day BO, lowest active single-day BO, and target.
  (function(){
    const byAD = {};    // "agent|date" -> {agent, team, d, bo_min}
    const dates = new Set();
    filt.forEach(r => {
      if (!isBack(r.status)) return;
      dates.add(r.d);
      const key = r.agent + "|" + r.d;
      const o = byAD[key] || (byAD[key] = {agent:r.agent, team:r.team, team_key:r.team_key, d:r.d, bo_min:0});
      o.bo_min += +r.min || 0;
    });

    // distinct dates (Mon->Sun as they appear), then sorted for column headers
    const dateCols = [...dates].sort();

    // aggregate per agent across all days in the selection
    const byA = {};   // agent -> {agent, team, team_key, total:0, byDate:{date:min}}
    Object.keys(byAD).forEach(k => {
      const o = byAD[k];
      const a = byA[o.agent] || (byA[o.agent] = {agent:o.agent, team:o.team, team_key:o.team_key, total:0, byDate:{}});
      a.total += o.bo_min;
      a.byDate[o.d] = (a.byDate[o.d] || 0) + o.bo_min;
    });

    let rows = Object.keys(byA).map(ag => {
      const a = byA[ag];
      return {ag, t:'<span class="tag lav">'+esc(a.team)+'</span>', tot:a.total,
              _rows: Object.keys(a.byDate).map(d => ({d, m:a.byDate[d], _fmt:fmtHrs(a.byDate[d])}))};
    });
    rows.sort((x,y) => y.tot - x.tot);

    // flatten to a table-friendly shape: one column per date
    const flatRows = rows.map(r => {
      const out = {ag:esc(r.ag), team:r.t, tot:fmtHrs(r.tot), _tot:r.tot};
      dateCols.forEach(d => { out["_"+d] = r._rows.find(x => x.d===d) ? r._rows.find(x=>x.d===d)._fmt : ""; });
      return out;
    });

    // chips: highest single-day BO, lowest non-zero single-day BO, target
    let hi = {agent:"", team:"", d:"", min:0}, lo = null, dayTotals = [];
    Object.keys(byAD).forEach(k => {
      const o = byAD[k];
      dayTotals.push(o);
      if (o.bo_min > hi.min){ hi = {agent:o.agent, team:o.team, d:o.d, min:o.bo_min}; }
      if (o.bo_min > 0 && (!lo || o.bo_min < lo.min)){ lo = {agent:o.agent, team:o.team, d:o.d, min:o.bo_min}; }
    });
    const dayVals = dayTotals.map(o => o.bo_min);
    const target = dayVals.length ? fmtHrs(dayVals.reduce((s,v)=>s+v,0)/dayVals.length) : "—";

    // build columns: Agent | Team | Total BO | <each date>
    const cols = [{t:"Agent",k:"ag"},{t:"Team",k:"team"},{t:"Total BO",k:"tot",n:1}];
    dateCols.forEach(d => cols.push({t:fmtDY(d),k:"_"+d}));

    const t = $("tStatusDailyBO");
    if (t){
      tbl(t, cols,
        flatRows.length ? flatRows :
          [{ag:'<div class="empty" style="padding:14px">No back-office hours for this selection.</div>', team:"", tot:"", _tot:0}]);
      // chips
      const ch = $("stDailyBOChips");
      if (ch){
        ch.innerHTML = '<span class="chip g">Highest: '+esc(hi.agent)+' ('+(hi.team||'?')+') on '+fmtDY(hi.d)+' — '+fmtHrs(hi.min)+'</span>'
          + (lo ? '<span class="chip y">Lowest: '+esc(lo.agent)+' ('+(lo.team||'?')+') on '+fmtDY(lo.d)+' — '+fmtHrs(lo.min)+'</span>' : '')
          + '<span class="chip b">Daily avg (target): '+esc(target)+'</span>';
      }
    }
  })();
}
