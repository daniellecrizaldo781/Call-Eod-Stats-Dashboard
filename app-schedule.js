/* ---------- Call Schedule page ----------
   Reads D.schedule (raw team-grouped grid pulled from the SCHED_SHEET sheet).
   Default view = "Schedule Grid": each TEAM is its own separate table (like the source
   sheet), showing ONE week at a time. A week dropdown inside the page lets agents pick
   which week to view. Follows the global Main Channel filter. No fabricated data.
*/

const SC = { view: "grid", q: "", week: null };

// team header colors (user spec): Danielle=pink, Brai=green, Cess=blue
const TEAM_COLORS = {
  danielle:{ bg: "#E8578E", fg: "#ffffff" },
  brai:    { bg: "#2E7D4F", fg: "#ffffff" },
  cess:    { bg: "#2F6FB3", fg: "#ffffff" },
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

// ---- week helpers (Monday-based) ----
function isoAdd(d, n){
  const dt = new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10));
  dt.setDate(dt.getDate() + n);
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,"0"), day = String(dt.getDate()).padStart(2,"0");
  return y + "-" + m + "-" + day;
}
function mondayOf(d){ return isoAdd(d, -((new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)).getDay()+6)%7)); }
function weekDays(mon){ const o=[]; for(let i=0;i<7;i++) o.push(isoAdd(mon, i)); return o; }
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtMD(d){ return d.slice(5).replace("-","/"); }
function fmtLong(d){ return MON3[+d.slice(5,7)-1] + " " + (+d.slice(8,10)) + ", " + d.slice(0,4); }
function weekLabel(mon){ return fmtLong(mon) + " – " + fmtLong(isoAdd(mon,6)); }

// classify a raw shift cell for styling
function cellClass(txt){
  const t = (txt || "").trim().toUpperCase();
  if (!t) return "blank";
  if (t === "OFF" || t === "RD" || t === "REST") return "off";
  if (t.includes("LWOP") || t.includes("VL") || t.includes("SL")) return "leave";
  return "shift";
}

// build the list of available weeks from the schedule data (Mondays present)
function scWeeks(schedObj){
  const set = new Set();
  for (const sec of schedObj.raw) for (const d of sec.dates) set.add(mondayOf(d));
  return [...set].sort();
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
      + '  <div class="fgroup"><span class="flabel">Week</span><select id="schedWeek" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">Agent</span>'
      + '    <input id="schedSearch" class="pillinp" placeholder="search agent&hellip;"></div>'
      + '  <div class="fgroup"><span class="flabel">&nbsp;</span>'
      + '    <button class="btn ghost" id="schedReset">Reset</button></div>'
      + '</div>'
      + '<div id="schedBody"></div>'
      + '<p class="pagehint">Source: team schedule sheet (SCHED_SHEET). Each team has its own white box with a colored header '
      + '(Danielle = pink, Brai = green, Cess = blue). Pick a week above to view one week at a time. '
      + 'Shift text is shown exactly as entered (OFF / LWOP / rest appear as-is). Follows the Main Channel filter above.</p>';
    root.dataset.built = "1";

    $("schedSearch").addEventListener("input", e => { SC.q = e.target.value.trim(); renderSchedule(); });
    $("schedWeek").addEventListener("change", e => { SC.week = e.target.value; renderSchedule(); });
    $("schedReset").onclick = () => {
      SC.q = ""; SC.week = SC._defaultWeek || SC.week;
      $("schedSearch").value = ""; renderSchedule();
    };
  }

  const schedObj = (D.schedule && D.schedule.raw) ? D.schedule : (Array.isArray(D.schedule) ? { raw: [], rows: D.schedule } : null);
  const has = !!(schedObj && (schedObj.raw.length || schedObj.rows.length));
  if (!has){
    $("schedScope").innerHTML = 'schedule not loaded &mdash; set SCHED_SHEET secret';
    $("schedKpis").innerHTML = "";
    $("schedBody").innerHTML = '<p class="pagehint">No schedule data. Add the <b>SCHED_SHEET</b> repository '
      + 'secret (schedule sheet ID|GID) and run the sync so the team schedule appears here.</p>';
    return;
  }

  // ---- week selection (drives the whole page; independent of global date range) ----
  const weeks = scWeeks(schedObj);
  // default = week of Aug 3 (user request); fall back to most recent week present
  const defWeek = weeks.includes("2026-08-03") ? "2026-08-03" : (weeks.length ? weeks[weeks.length-1] : null);
  SC._defaultWeek = defWeek;
  if (!SC.week || !weeks.includes(SC.week)) SC.week = defWeek;
  const win = weekDays(SC.week);

  // (re)build week dropdown only if the option set changed
  const opts = weeks.map(w => '<option value="'+w+'"'+(w===SC.week?' selected':'')+'>'+weekLabel(w)+'</option>').join("");
  if ($("schedWeek").innerHTML !== opts) $("schedWeek").innerHTML = opts;
  else if ($("schedWeek").value !== SC.week) $("schedWeek").value = SC.week;

  const q = SC.q.toLowerCase();
  const inWin = r => win.includes(r.d);
  const chanOk = r => (F.chan === "ALL") ? true : (r.team === F.chan || r.team === "ALL");

  // ---- KPIs (minimal) ----
  const visRows = schedObj.rows.filter(r => inWin(r) && chanOk(r));
  const shifts = visRows.length;
  const agents = new Set(visRows.map(r => r.agent));
  const oha = visRows.filter(r => r.team === "OHA").length;
  const noha = visRows.filter(r => r.team === "NON-OHA").length;
  $("schedKpis").innerHTML =
      kpi("Scheduled Shifts", nf(shifts), "agent-days this week", "agent")
    + kpi("Agents", nf(agents.size), "appearing this week", "alt")
    + kpi("OHA Shifts", nf(oha), F.chan === "NON-OHA" ? "filtered out" : "team OHA", "good")
    + kpi("Non-OHA Shifts", nf(noha), F.chan === "OHA" ? "filtered out" : "team Non-OHA", "warn");

  $("schedScope").innerHTML = "Week of " + weekLabel(SC.week)
    + " &middot; " + (F.chan === "ALL" ? "All Channels" : F.chan);

  const body = $("schedBody");
  body.innerHTML = scGrid(schedObj, win, chanOk, q);
}

/* ---------- Schedule Grid: one separate table per team, single week ---------- */
function scGrid(schedObj, win, chanOk, q){
  let h = "";
  for (const sec of schedObj.raw){
    const ags = sec.agents.filter(a => {
      if (q && !a.name.toLowerCase().includes(q)) return false;
      if (F.chan !== "ALL" && a.desig !== F.chan && a.desig !== "ALL") return false;
      // keep agent only if they have a shift in the selected week
      return a.cells.some((txt,i) => {
        const d = sec.dates[i];
        return d && win.includes(d) && (txt||"").trim() && cellClass(txt) === "shift";
      });
    });
    if (!ags.length) continue;
    const col = teamColor(sec.team_key);
    h += '<div class="sched-team">';
    h += '<div class="sched-banner" style="background:'+col.bg+';color:'+col.fg+'">'+esc(sec.team)+'</div>';
    h += '<div class="sched-box"><table class="schedgrid"><thead><tr>'
       + '<th class="sticky-col">Name</th><th>Designation</th>';
    for (const d of win) h += '<th>'+fmtLong(d)+'<br><span class="wd">'+DOW3[dowOf(d)]+'</span></th>';
    h += '</tr></thead><tbody>';
    for (const a of ags){
      h += '<tr><td class="sticky-col">'+esc(a.name)+'</td><td class="desig">'+esc(desigLabel(a.desig))+'</td>';
      for (const d of win){
        const i = sec.dates.indexOf(d);
        const txt = (i >= 0 && i < a.cells.length) ? a.cells[i] : "";
        const cls = cellClass(txt);
        const disp = cls === "blank" ? "" : esc(txt);
        h += '<td class="'+cls+'">'+disp+'</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div></div>';
  }
  if (!h) h = '<p class="pagehint">No agents match the current channel / search filter for this week.</p>';
  return h;
}

/* ---------- Compact By Agent / By Date (derived from rows), single week ---------- */
function scCompact(schedObj, win, chanOk, q, mode){
  const all = schedObj.rows.filter(r => win.includes(r.d) && chanOk(r));
  if (!all.length) return '<p class="pagehint">No scheduled agents in the selected week/filter.</p>';
  const dates = [...new Set(all.map(r => r.d))].sort();
  const agents = [...new Set(all.map(r => r.agent))].sort();
  if (q){ for (let i=agents.length-1;i>=0;i--) if (!agents[i].toLowerCase().includes(q)) agents.splice(i,1); }
  const cell = {};
  for (const r of all) cell[r.agent + "|" + r.d] = r.text;
  let h = '<table class="schedgrid"><thead><tr>';
  if (mode === "agent"){
    h += '<th class="sticky-col">Agent</th>' + dates.map(d => '<th>'+fmtLong(d)+'<br><span class="wd">'+DOW3[dowOf(d)]+'</span></th>').join("");
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
