/* ---------- Call Schedule page ----------
   Reads D.schedule (raw team-grouped grid pulled from the SCHED_SHEET sheet).
   Default view = "Schedule Grid": faithful team sections (Team Cess / Brai / Danielle)
   with date columns and raw shift text, matching the source sheet.
   Alternate views: By Agent / By Date compact grids.
   Follows the global Main Channel filter + From/To range. No fabricated data.
*/

const SC = { view: "grid", q: "" };

// team banner colors (match the source sheet's section banners)
const TEAM_COLORS = {
  cess:    { bg: "#1e3a8a", fg: "#ffffff" },
  brai:    { bg: "#556b2f", fg: "#ffffff" },
  danielle:{ bg: "#4b0082", fg: "#ffffff" },
  other:   { bg: "#9B2C6B", fg: "#ffffff" }
};
function teamColor(key){ return TEAM_COLORS[key] || TEAM_COLORS.other; }
function desigLabel(d){
  const u = (d || "").toUpperCase();
  if (u === "OHA") return "OHA";
  if (u === "NON-OHA") return "Non-OHA";
  if (u === "ALL") return "All Channels";
  return d || "";
}
function dowOf(d){ return (new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)).getDay() + 6) % 7; }
const DOW3 = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// classify a raw shift cell for styling
function cellClass(txt){
  const t = (txt || "").trim().toUpperCase();
  if (!t) return "blank";
  if (t === "OFF" || t === "RD" || t === "REST") return "off";
  if (t.includes("LWOP") || t.includes("VL") || t.includes("SL")) return "leave";
  return "shift";
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
      + '    <button class="pill on" data-v="grid">Schedule Grid</button>'
      + '    <button class="pill" data-v="agent">By Agent</button>'
      + '    <button class="pill" data-v="date">By Date</button></div></div>'
      + '  <div class="fgroup"><span class="flabel">Agent</span>'
      + '    <input id="schedSearch" class="pillinp" placeholder="search agent&hellip;"></div>'
      + '  <div class="fgroup"><span class="flabel">&nbsp;</span>'
      + '    <button class="btn ghost" id="schedReset">Reset</button></div>'
      + '</div>'
      + '<div class="card"><div class="scroll" id="schedBody"></div></div>'
      + '<p class="pagehint">Source: team schedule sheet (SCHED_SHEET). Shift text is shown exactly as entered '
      + '(OFF / LWOP / rest appear as-is). Follows the Main Channel filter and the From&ndash;To date range above.</p>';
    root.dataset.built = "1";

    $("schedViewPills").addEventListener("click", e => {
      const b = e.target.closest(".pill"); if (!b) return;
      [...$("schedViewPills").children].forEach(x => x.classList.remove("on"));
      b.classList.add("on"); SC.view = b.dataset.v; renderSchedule();
    });
    $("schedSearch").addEventListener("input", e => { SC.q = e.target.value.trim(); renderSchedule(); });
    $("schedReset").onclick = () => {
      SC.view = "grid"; SC.q = "";
      [...$("schedViewPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
      $("schedSearch").value = ""; renderSchedule();
    };
  }

  const schedObj = (D.schedule && D.schedule.raw) ? D.schedule : (Array.isArray(D.schedule) ? { raw: [], rows: D.schedule } : null);
  const has = !!(schedObj && (schedObj.raw.length || schedObj.rows.length));
  $("schedScope").innerHTML = (F.chan === "ALL" ? "All Channels" : F.chan)
    + " &middot; " + fmtDY(F.from) + " &rarr; " + fmtDY(F.to)
    + (has ? "" : ' &middot; <span style="color:#D9455F">schedule not loaded &mdash; set SCHED_SHEET secret</span>');

  if (!has){
    $("schedKpis").innerHTML = "";
    $("schedBody").innerHTML = '<p class="pagehint">No schedule data. Add the <b>SCHED_SHEET</b> repository '
      + 'secret (schedule sheet ID|GID) and run the sync so the team schedule appears here.</p>';
    return;
  }

  const rows = schedObj.rows;
  const q = SC.q.toLowerCase();
  const inRange = r => r.d >= F.from && r.d <= F.to;
  const chanOk = r => (F.chan === "ALL") ? true : (r.team === F.chan || r.team === "ALL");

  // ---- KPIs (minimal) ----
  const visRows = rows.filter(r => inRange(r) && chanOk(r));
  const shifts = visRows.length;
  const agents = new Set(visRows.map(r => r.agent));
  const oha = visRows.filter(r => r.team === "OHA").length;
  const noha = visRows.filter(r => r.team === "NON-OHA").length;
  $("schedKpis").innerHTML =
      kpi("Scheduled Shifts", nf(shifts), "agent-days in range", "agent")
    + kpi("Agents", nf(agents.size), "appearing in range", "alt")
    + kpi("OHA Shifts", nf(oha), F.chan === "NON-OHA" ? "filtered out" : "team OHA", "good")
    + kpi("Non-OHA Shifts", nf(noha), F.chan === "OHA" ? "filtered out" : "team Non-OHA", "warn");

  const body = $("schedBody");
  if (SC.view === "grid") body.innerHTML = scGrid(schedObj, inRange, chanOk, q);
  else if (SC.view === "agent") body.innerHTML = scCompact(schedObj, inRange, chanOk, q, "agent");
  else body.innerHTML = scCompact(schedObj, inRange, chanOk, q, "date");
}

/* ---------- Schedule Grid (faithful team-grouped, like the source sheet) ---------- */
function scGrid(schedObj, inRange, chanOk, q){
  // gather all dates present in range across sections
  const dates = [...new Set(schedObj.rows.filter(r => inRange(r)).map(r => r.d))].sort();
  if (!dates.length) return '<p class="pagehint">No scheduled dates in the selected range.</p>';
  let h = "";
  for (const sec of schedObj.raw){
    // filter agents in this section by channel + search
    const ags = sec.agents.filter(a => {
      if (q && !a.name.toLowerCase().includes(q)) return false;
      // channel filter on designation
      if (F.chan !== "ALL" && a.desig !== F.chan && a.desig !== "ALL") return false;
      return true;
    }).filter(a => a.cells.some((txt,i) => {
      // keep agent if any of their in-range date cells has a shift
      const d = sec.dates[i];
      return d && inRange({d}) && (txt||"").trim() && cellClass(txt) === "shift";
    }));
    if (!ags.length) continue;
    const col = teamColor(sec.team_key);
    h += '<div class="sched-team">';
    h += '<div class="sched-banner" style="background:'+col.bg+';color:'+col.fg+'">'+esc(sec.team)+'</div>';
    h += '<table class="schedgrid"><thead><tr>'
       + '<th class="sticky-col">Name</th><th>Designation</th>';
    for (const d of dates) h += '<th>'+fmtMD(d)+'<br><span class="wd">'+DOW3[dowOf(d)]+'</span></th>';
    h += '</tr></thead><tbody>';
    for (const a of ags){
      h += '<tr><td class="sticky-col">'+esc(a.name)+'</td><td class="desig">'+esc(desigLabel(a.desig))+'</td>';
      for (const d of dates){
        const i = sec.dates.indexOf(d);
        const txt = (i >= 0 && i < a.cells.length) ? a.cells[i] : "";
        const cls = cellClass(txt);
        const disp = cls === "blank" ? "" : esc(txt);
        h += '<td class="'+cls+'">'+disp+'</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
  }
  if (!h) h = '<p class="pagehint">No agents match the current channel / search filter in this range.</p>';
  return h;
}

/* ---------- Compact By Agent / By Date (derived from rows) ---------- */
function scCompact(schedObj, inRange, chanOk, q, mode){
  const all = schedObj.rows.filter(r => inRange(r) && chanOk(r));
  if (!all.length) return '<p class="pagehint">No scheduled agents in the selected range/filter.</p>';
  const dates = [...new Set(all.map(r => r.d))].sort();
  const agents = [...new Set(all.map(r => r.agent))].sort();
  if (q){ const ql = q; for (let i=agents.length-1;i>=0;i--) if (!agents[i].toLowerCase().includes(ql)) agents.splice(i,1); }
  // per (agent,date) -> shift text from raw records
  const cell = {};
  for (const r of all) cell[r.agent + "|" + r.d] = r.text;
  const colOf = d => '<th>'+fmtMD(d)+'<br><span class="wd">'+DOW3[dowOf(d)]+'</span></th>';
  let h = '<table class="schedgrid"><thead><tr>';
  if (mode === "agent"){
    h += '<th class="sticky-col">Agent</th>' + dates.map(colOf).join("");
  } else {
    h += '<th class="sticky-col">Date</th>' + agents.map(a => '<th>'+esc(a)+'</th>').join("");
  }
  h += '</tr></thead><tbody>';
  const rowsOut = mode === "agent" ? agents.map(a => ({k:a, cells: dates.map(d => cell[a+"|"+d]||"")}))
                                    : dates.map(d => ({k:d, cells: agents.map(a => cell[a+"|"+d]||"")}));
  for (const r of rowsOut){
    h += '<tr><td class="sticky-col">'+(mode==="agent"?esc(r.k):(fmtMD(r.k)+' <span class="wd">'+DOW3[dowOf(r.k)]+'</span>'))+'</td>';
    for (const txt of r.cells){
      const cls = cellClass(txt); const disp = cls === "blank" ? "" : esc(txt);
      h += '<td class="'+cls+'">'+disp+'</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  return h;
}

function fmtMD(d){ return d.slice(5).replace("-","/"); }
