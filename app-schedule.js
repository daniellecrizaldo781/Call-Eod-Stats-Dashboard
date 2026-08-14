/* ---------- Call Schedule page ----------
   Reads D.schedule (agent x date shift grid, pulled from the SCHED_SHEET sheet).
   Table-first: By Agent (agents x dates) or By Date (dates x agents).
   Follows the global Main Channel filter + From/To range. No fabricated data.
*/

const SC = { view: "agent", q: "" };

function scTeamOk(team){
  if (F.chan === "ALL") return true;
  return team === F.chan || team === "ALL";
}
function scHour12(h){
  const ap = h < 12 ? "A" : "P";
  let hr = h % 12; if (hr === 0) hr = 12;
  return hr + ap;
}
// compact shift label from a set of hours, e.g. {6..14} -> "6A-3P", {22,23,0,1} -> "10P-2A"
function scShiftLabel(hours){
  if (!hours || !hours.size) return "";
  const hs = [...hours].sort((a,b)=>a-b);
  // build contiguous runs (with day wrap)
  const runs = []; let cur = [hs[0]];
  for (let i=1;i<hs.length;i++){
    if (hs[i] === hs[i-1]+1) cur.push(hs[i]);
    else { runs.push(cur); cur = [hs[i]]; }
  }
  runs.push(cur);
  const parts = runs.map(r => scHour12(r[0]) + "-" + scHour12(r[r.length-1]+1));
  return parts.join(" / ");
}
function scDatesInRange(sched){
  const ds = [...new Set(sched.map(s => s.d))].filter(d => d >= F.from && d <= F.to).sort();
  return ds;
}
function scAgentsInRange(sched){
  let ags = [...new Set(sched.map(s => s.agent))].sort();
  if (SC.q){ const q = SC.q.toLowerCase(); ags = ags.filter(a => a.toLowerCase().includes(q)); }
  return ags;
}
// per (agent,date) -> shift label (cache from records)
function scCellMap(sched){
  const m = {}; // agent|date -> shiftLabel
  for (const s of sched){
    const k = s.agent + "|" + s.d;
    m[k] = scShiftLabel(s.hours);
  }
  return m;
}

function renderSchedule(){
  if (F.page !== "sched") return;
  const root = $("schedRoot");
  if (!root) return;
  if (!root.dataset.built){
    root.innerHTML =
      '<div class="sect"><h2>&#128197; Call Schedule</h2>'
      + '<span class="chip" id="schedScope"></span><div class="line"></div></div>'
      + '<div class="kpis" id="schedKpis"></div>'
      + '<div class="sched-controls">'
      + '  <div class="fgroup"><span class="flabel">View</span><div class="pills" id="schedViewPills">'
      + '    <button class="pill on" data-v="agent">By Agent</button>'
      + '    <button class="pill" data-v="date">By Date</button></div></div>'
      + '  <div class="fgroup"><span class="flabel">Agent</span>'
      + '    <input id="schedSearch" class="pillinp" placeholder="search agent&hellip;"></div>'
      + '  <div class="fgroup"><span class="flabel">&nbsp;</span>'
      + '    <button class="btn ghost" id="schedReset">Reset</button></div>'
      + '</div>'
      + '<div class="card"><div class="scroll" id="schedBody"></div></div>'
      + '<p class="pagehint">Source: team schedule sheet (SCHED_SHEET). Shifts are derived from the '
      + 'schedule grid &mdash; OFF / empty left blank. Follows the Main Channel filter (OHA / Non-OHA) '
      + 'and the From&ndash;To date range above.</p>';
    root.dataset.built = "1";

    $("schedViewPills").addEventListener("click", e => {
      const b = e.target.closest(".pill"); if (!b) return;
      [...$("schedViewPills").children].forEach(x => x.classList.remove("on"));
      b.classList.add("on"); SC.view = b.dataset.v; renderSchedule();
    });
    $("schedSearch").addEventListener("input", e => { SC.q = e.target.value.trim(); renderSchedule(); });
    $("schedReset").onclick = () => {
      SC.view = "agent"; SC.q = "";
      [...$("schedViewPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
      $("schedSearch").value = ""; renderSchedule();
    };
  }

  const all = D.schedule || [];
  const has = all.length > 0;
  $("schedScope").innerHTML = (F.chan === "ALL" ? "All Channels" : F.chan)
    + " &middot; " + fmtDY(F.from) + " &rarr; " + fmtDY(F.to)
    + (has ? "" : ' &middot; <span style="color:#D9455F">schedule not loaded &mdash; set SCHED_SHEET secret</span>');

  if (!has){
    $("schedKpis").innerHTML = "";
    $("schedBody").innerHTML = '<p class="pagehint">No schedule data. Add the <b>SCHED_SHEET</b> repository '
      + 'secret (schedule sheet ID|GID) and run the sync so the team schedule appears here.</p>';
    return;
  }

  const sched = all.filter(s => s.d >= F.from && s.d <= F.to && scTeamOk(s.team));
  const dates = scDatesInRange(sched);
  const agents = scAgentsInRange(sched);
  const cell = scCellMap(sched);

  // ---- KPIs (minimal) ----
  const shifts = sched.length;
  const oha = sched.filter(s => s.team === "OHA").length;
  const noha = sched.filter(s => s.team === "NON-OHA").length;
  $("schedKpis").innerHTML =
      kpi("Scheduled Shifts", nf(shifts), dates.length + " days in range", "agent")
    + kpi("Agents", nf(agents.length), "appearing in range", "alt")
    + kpi("OHA Shifts", nf(oha), F.chan === "NON-OHA" ? "filtered out" : "team OHA", "good")
    + kpi("Non-OHA Shifts", nf(noha), F.chan === "OHA" ? "filtered out" : "team Non-OHA", "warn");

  if (!dates.length || !agents.length){
    $("schedBody").innerHTML = '<p class="pagehint">No scheduled agents in the selected range/filter.</p>';
    return;
  }

  const body = $("schedBody");
  if (SC.view === "agent") body.innerHTML = scAgentTable(agents, dates, cell);
  else body.innerHTML = scDateTable(dates, agents, cell);
}

function scAgentTable(agents, dates, cell){
  let h = '<table class="schedtbl"><thead><tr><th class="sticky-col">Agent</th>';
  for (const d of dates){
    const wd = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][(new Date(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10)).getDay()+6)%7];
    h += '<th>'+d.slice(5)+'<br><span class="wd">'+wd+'</span></th>';
  }
  h += '</tr></thead><tbody>';
  for (const a of agents){
    h += '<tr><td class="sticky-col">'+esc(a)+'</td>';
    for (const d of dates){
      const v = cell[a + "|" + d] || "";
      h += v ? '<td class="shift">'+esc(v)+'</td>' : '<td class="off"></td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  return h;
}

function scDateTable(dates, agents, cell){
  let h = '<table class="schedtbl"><thead><tr><th class="sticky-col">Date</th>';
  for (const a of agents) h += '<th>'+esc(a)+'</th>';
  h += '</tr></thead><tbody>';
  for (const d of dates){
    const wd = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][(new Date(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10)).getDay()+6)%7];
    h += '<tr><td class="sticky-col">'+d.slice(5)+' <span class="wd">'+wd+'</span></td>';
    for (const a of agents){
      const v = cell[a + "|" + d] || "";
      h += v ? '<td class="shift">'+esc(v)+'</td>' : '<td class="off"></td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  return h;
}
