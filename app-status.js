/* ---------- Agent Status History ----------
   Reads D.status.rows = [{d, t, agent, team, team_key, status, min}] built by
   sync_sheets.build_status() (one row per status interval, min = minutes).
   The sheet has ONE TAB PER TEAM; each row is tagged with its authoritative team_key.

   Surfaces (all computed client-side so the Week toggle filters live):
     • Back-office load per agent  (hours in back_office/admin/training/after_call_work/etc.)
     • Aux-jumping flags           (3+ distinct aux states within a single clock hour)
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

// back-office = time NOT spent handling live calls
const AUX_BACK = ["back_office","backoffice","admin","after_call_work","acw","training",
  "coaching","meeting","project","non_call","noncall","offline","email","chat","wfm",
  "qa","quality","floor","break","lunch","restroom","rest_room","personal","wrap"];
function isBack(label){
  const l = (label||"").toLowerCase().replace(/ /g,"_");
  return !!l && AUX_BACK.some(k => l.indexOf(k) > -1);
}
function normStatus(label){
  let l = (label||"").toLowerCase().replace(/ /g,"_").trim();
  if (!l || ["-","nan","none","null"].indexOf(l) > -1) return null;
  l = l.replace(/^[^a-z0-9]+/,"").replace(/[(\-]\s*\d+\s*[sm]?\s*[)]?$/,"").replace(/[._:-]+$/,"");
  if (!l) return null;
  return l.split(/[(\/]/)[0];
}
function fmtHrs(min){
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
    ["chStatusBO","tStatusJump","tStatusPerAgent"].forEach(id => { const e=$(id); if (e) e.innerHTML=""; });
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

  // aux-jump = >=3 away toggles within JUMP_WINDOW minutes, ending when agent goes available
  function computeJumps(ev){
    let jumps = 0, win = [];
    for (const e of ev){
      if (e.state === "available"){
        const recent = win.filter(w => (e.off - w.off) <= JUMP_WINDOW);
        if (recent.length >= 3 && new Set(recent.map(w => w.state)).size >= 2) jumps++;
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
    let jumps = 0;
    const days = TL[n] || {};
    Object.keys(days).forEach(d => { jumps += computeJumps(days[d].ev); });
    return {name:n, team:a.team, team_key:a.team_key, min:a.min, bo_min:a.bo_min,
            jumps, distinct_aux:Object.keys(a.auxes).length, auxes:a.auxes, statusMin:a.statusMin};
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

  // Back-office bar chart (top 20)
  const bo = agents.filter(a => a.bo_min > 0).slice(0, 20);
  if (bo.length){
    hBars("chStatusBO", bo.map(a => ({label:a.name, value:a.bo_min,
      note: fmtHrs(a.bo_min) + " back-office"})), {unit:"h", labelW:160, color:"#B99BDD"});
  } else {
    $("chStatusBO").innerHTML = '<div class="empty">No back-office hours for this selection.</div>';
  }

  // Aux-jumping table
  const flagged = jumpers.slice().sort((x,y) => y.jumps - x.jumps);
  const jrows = flagged.map(a => {
    const topAux = Object.entries(a.auxes).sort((x,y)=>y[1]-x[1]).slice(0,3)
      .map(([k,v]) => esc(k) + " (" + (v/60).toFixed(1) + "h)").join(", ");
    return {a:esc(a.name), t:'<span class="tag lav">'+esc(a.team)+'</span>',
            j:nf(a.jumps), d:nf(a.distinct_aux), aux: topAux || "—", bo: fmtHrs(a.bo_min)};
  });
  tbl($("tStatusJump"),
    [{t:"Agent",k:"a"},{t:"Team",k:"t"},{t:"Aux-Jumps",k:"j",n:1},
     {t:"Distinct Aux",k:"d",n:1},{t:"Top Aux States",k:"aux"},{t:"Back-Office",k:"bo",n:1}],
    jrows.length ? jrows :
      [{a:'<div class="empty" style="padding:14px">No agents flagged for aux-jumping in this selection. 🎉</div>', t:"", j:"", d:"", aux:"", bo:""}]);

  // Per-agent time-in-status table
  const perRows = agents.map(a => {
    const cells = Object.entries(a.statusMin)
      .sort((x,y)=>y[1]-x[1])
      .map(([st,v]) => esc(st) + " <b>" + fmtHrs(v) + "</b>").join("<br>");
    return {a:esc(a.name), t:'<span class="tag lav">'+esc(a.team)+'</span>',
            tot:fmtHrs(a.min), bo:fmtHrs(a.bo_min), breakdown: cells || "—"};
  });
  tbl($("tStatusPerAgent"),
    [{t:"Agent",k:"a"},{t:"Team",k:"t"},{t:"Total Hrs",k:"tot",n:1},
     {t:"Back-Office Hrs",k:"bo",n:1},{t:"Time in Status (hrs per status)",k:"breakdown"}],
    perRows.length ? perRows :
      [{a:'<div class="empty" style="padding:14px">No status data for this selection.</div>', t:"", tot:"", bo:"", breakdown:""}]);
}
