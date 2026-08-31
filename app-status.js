/* ---------- Agent Status History ----------
   Reads D.status = { rows, byAgent, dates, members } built by sync_sheets.build_status().
   Categorised by team (Danielle / Brai / Cess / Entire Call Team).
   Surfaces:
     • Back-office load per agent (total back-office/admin/training minutes)
     • Aux-jumping flags (agents toggling between 3+ distinct aux states within one hour)
   If the STATUS_SHEET secret is not set, D.status is [] and the section shows a
   friendly "no data" notice instead of crashing.
*/
const ST_TEAMS = [
  {key:"all", label:"Entire Call Team"},
  {key:"danielle", label:"Team Danielle"},
  {key:"brai", label:"Team Brai"},
  {key:"cess", label:"Team Cess"},
];

function renderStatus(){
  const root = $("pageAgent");
  if (!root || F.page !== "agent") return;          // only render on the agent page
  const wrap = $("stKpis");
  if (!wrap) return;
  const st = D.status;
  if (!st || !st.byAgent || !Object.keys(st.byAgent).length){
    wrap.innerHTML = '<div class="empty" style="padding:18px">No Agent Status History data. '
      + 'Add the <b>STATUS_SHEET</b> repo secret (SHEET_ID|GID) and make the sheet public '
      + '("Anyone with the link can view"). The hourly sync will populate this section.</div>';
    const bo = $("chStatusBO"); if (bo) bo.innerHTML = "";
    const jt = $("tStatusJump"); if (jt) jt.innerHTML = "";
    return;
  }

  // filter by selected team
  const team = F.stTeam || "all";
  let agents = Object.entries(st.byAgent);
  if (team !== "all"){
    agents = agents.filter(([_, a]) => a.team_key === team);
  }

  // sort
  const s = ($("stSort") ? $("stSort").value : "bo_desc");
  const cmp = {
    bo_desc:(x,y)=> y[1].backoffice_min - x[1].backoffice_min,
    bo_asc:(x,y)=> x[1].backoffice_min - y[1].backoffice_min,
    jumps_desc:(x,y)=> y[1].jumps - x[1].jumps,
    name:(x,y)=> x[0].localeCompare(y[0]),
  }[s] || ((x,y)=> y[1].backoffice_min - x[1].backoffice_min);
  agents.sort(cmp);

  const totalBO = agents.reduce((s, [_, a]) => s + a.backoffice_min, 0);
  const jumpers = agents.filter(([_, a]) => a.jumps > 0);
  const teamLabel = (ST_TEAMS.find(t=>t.key===team)||{}).label || "Entire Call Team";

  // KPIs
  wrap.innerHTML =
      kpi("Back-Office Minutes", nf(Math.round(totalBO)), teamLabel + " · total", "alt")
    + kpi("Agents Tracked", nf(agents.length), teamLabel, "big")
    + kpi("Aux-Jumping Agents", nf(jumpers.length), "flagged (3+ aux/hr)", jumpers.length? "bad":"good")
    + kpi("Top Back-Office", agents.length? esc(agents[0][0]) : "—",
          agents.length? nf(Math.round(agents[0][1].backoffice_min))+" min" : "", "warn");

  // Back-office bar chart (top 20 by minutes)
  const topBO = agents.slice(0, 20).filter(([_, a]) => a.backoffice_min > 0);
  if (topBO.length){
    hBars("chStatusBO", topBO.map(([n, a]) => ({
      label:n, value:a.backoffice_min,
      note: nf(Math.round(a.backoffice_min)) + " min back-office"
    })), {unit:"min", labelW:150, color:"#B99BDD"});
  } else {
    $("chStatusBO").innerHTML = '<div class="empty">No back-office minutes recorded for this team.</div>';
  }

  // Aux-jumping table (only flagged agents; sorted by jump count)
  const flagged = jumpers.slice().sort((x,y)=> y[1].jumps - x[1].jumps);
  const rows = flagged.map(([n, a]) => {
    const topAux = [...a.auxes.entries()].sort((x,y)=>y[1]-x[1]).slice(0,3)
      .map(([k,v]) => esc(k)+" ("+v+")").join(", ");
    return {a:esc(n), t:'<span class="tag lav">'+esc(a.team)+'</span>',
            j:nf(a.jumps), d:nf(a.distinct_aux),
            aux: topAux || "—", bo: nf(Math.round(a.backoffice_min))+" min"};
  });
  tbl($("tStatusJump"),
    [{t:"Agent",k:"a"},{t:"Team",k:"t"},{t:"Aux-Jumps",k:"j",n:1},
     {t:"Distinct Aux",k:"d",n:1},{t:"Top Aux States",k:"aux"},{t:"Back-Office",k:"bo",n:1}],
    rows.length ? rows : [{a:'<div class="empty" style="padding:14px">No agents flagged for aux-jumping in this team. 🎉</div>', t:"", j:"", d:"", aux:"", bo:""}]);
}
