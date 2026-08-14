/* ---------- Call Forecast & Staffing page ----------
   Reads window.CALL_DATA (cube ROWS + schedule) — never fabricates numbers.
   Forecast = historical average call volume by (day-of-week, hour), derived from ROWS.
   Staffing = agents scheduled per hour, derived from D.schedule (read live from the sheet).
   Respects the global F.chan (All Channels / OHA / Non-OHA) and F.from/F.to date range.
*/

const FC = { gran: "daily", fhour: "ALL", fteam: "ALL" };

// workload thresholds (calls per scheduled agent, per hour) used to flag staffing.
// Grounded in the brief's examples: 8.0/agent = understaffed, 3.6 = adequate, 1.5 = overstaffed.
const FC_UNDER = 6.0;   // >= this many calls/agent/hr -> Understaffed (red)
const FC_OVER  = 2.5;   // <= this many calls/agent/hr -> Overstaffed (yellow)
const FC_TARGET = 4.0;  // healthy calls/agent/hr used to recommend ideal staffing

const DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const HOURS = [...Array(24).keys()];
function hourLbl(h){ const am = h < 12; const hr = h % 12 === 0 ? 12 : h % 12; return hr + (am ? " AM" : " PM"); }
function dowOf(d){ return (new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)).getDay() + 6) % 7; } // Mon=0

function fcFilteredRows(){
  return ROWS.filter(r =>
    r.d >= F.from && r.d <= F.to &&
    (F.chan === "ALL" || r.ch === F.chan) &&
    r.h >= 0);
}
// schedule records in range + team-filtered (OHA/NON-OHA/ALL). channel ALL -> every team.
function fcSchedRows(){
  if (!D.schedule || !D.schedule.length) return [];
  return D.schedule.filter(s =>
    s.d >= F.from && s.d <= F.to &&
    (F.chan === "ALL" ? true : (s.team === F.chan || s.team === "ALL")) &&
    (FC.fteam === "ALL" || s.team === FC.fteam || (FC.fteam === F.chan && s.team === "ALL")));
}

// average daily calls for each (dow, hour) across the in-range dates
function fcHourlyByDow(rows){
  const sum = {}, cnt = {};
  for (const r of rows){
    const k = dowOf(r.d) + "|" + r.h;
    sum[k] = (sum[k] || 0) + r.n;
    cnt[k] = (cnt[k] || 0) + 1;
  }
  const out = {};
  for (const k in sum) out[k] = sum[k] / cnt[k];
  return out;
}
// average scheduled agents per (dow, hour)
function fcStaffByDow(sched){
  const sum = {}, cnt = {};
  for (const s of sched){
    const di = dowOf(s.d);
    for (const h of s.hours){
      const k = di + "|" + h;
      sum[k] = (sum[k] || 0) + 1;
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  const out = {};
  for (const k in sum) out[k] = sum[k] / cnt[k];
  return out;
}
// agents scheduled in hour h on a specific date (returns list of names)
function fcAgentsAt(sched, date, hour){
  const set = new Set();
  for (const s of sched) if (s.d === date && s.hours.includes(hour)) set.add(s.agent);
  return [...set].sort();
}

function fcStatus(load){
  if (load >= FC_UNDER) return "under";
  if (load <= FC_OVER)  return "over";
  return "ok";
}
const FC_ICON = { under: "🔴", over: "🟡", ok: "🟢" };
const FC_TXT  = { under: "Understaffed", over: "Overstaffed", ok: "Adequately Staffed" };

function renderForecast(){
  if (F.page !== "forecast") return;
  const root = $("forecastRoot");
  if (!root) return;
  // ---- build shell once ----
  if (!root.dataset.built){
    root.innerHTML =
      '<div class="sect"><h2>📊 Call Forecast &amp; Staffing</h2>'
      + '<span class="chip" id="fcScope"></span><div class="line"></div></div>'
      + '<div class="kpis" id="fcKpis"></div>'
      + '<div class="forecast-controls">'
      + '  <div class="fgroup"><span class="flabel">View</span><div class="pills" id="fcGranPills">'
      + '    <button class="pill" data-v="daily">Daily</button>'
      + '    <button class="pill" data-v="weekly">Weekly</button>'
      + '    <button class="pill" data-v="monthly">Monthly</button></div></div>'
      + '  <div class="fgroup"><span class="flabel">Hour</span><select id="fcHour" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">Team</span><select id="fcTeam" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">&nbsp;</span><button class="btn ghost" id="fcReset">Reset</button></div>'
      + '</div>'
      + '<div class="sect" style="margin-top:18px"><h2>Forecasted Call Volume by Day</h2><div class="line"></div></div>'
      + '<div class="card"><div class="scroll"><table id="fcDayTbl"></table></div></div>'
      + '<div class="sect" style="margin-top:18px"><h2>Forecasted Call Volume by Hour</h2>'
      + '<span class="chip" id="fcHourScope"></span><div class="line"></div></div>'
      + '<div class="card"><div class="scroll"><table id="fcHourTbl"></table></div></div>'
      + '<div class="sect" style="margin-top:18px"><h2>Staffing Heatmap (Day × Hour)</h2>'
      + '<span class="chip">click a cell to see scheduled agents</span><div class="line"></div></div>'
      + '<div class="card" id="fcHeatWrap"></div>'
      + '<div class="sect" style="margin-top:18px"><h2>Scheduled Agents — Selected Hour</h2><div class="line"></div></div>'
      + '<div class="card"><div id="fcAgents"></div></div>'
      + '<div class="sect" style="margin-top:18px"><h2>Recommended Schedule Adjustments</h2><div class="line"></div></div>'
      + '<div class="card"><div class="scroll"><table id="fcRecTbl"></table></div></div>'
      + '<p class="pagehint">Forecast = historical average call volume by day-of-week &amp; hour from your call data. '
      + 'Staffing = agents scheduled per hour from the team schedule sheet. '
      + 'Understaffed ≥ '+FC_UNDER+' calls/agent/hr · Overstaffed ≤ '+FC_OVER+' · healthy target '+FC_TARGET+'. '
      + 'Every figure is derived from the data — none are assumed.</p>';
    root.dataset.built = "1";

    $("fcGranPills").addEventListener("click", e => {
      const b = e.target.closest(".pill"); if (!b) return;
      [...$("fcGranPills").children].forEach(x => x.classList.remove("on"));
      b.classList.add("on"); FC.gran = b.dataset.v; renderForecast();
    });
    $("fcHour").onchange = e => { FC.fhour = e.target.value; renderForecast(); };
    $("fcTeam").onchange = e => { FC.fteam = e.target.value; renderForecast(); };
    $("fcReset").onclick = () => {
      FC.gran = "daily"; FC.fhour = "ALL"; FC.fteam = "ALL";
      [...$("fcGranPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
      $("fcHour").value = "ALL"; $("fcTeam").value = "ALL"; renderForecast();
    };
  }

  const rows = fcFilteredRows();
  const sched = fcSchedRows();
  const hasSched = sched.length > 0;
  const noSched = !hasSched
    ? ' · <span style="color:#D9455F">schedule sheet not loaded — set SCHED_SHEET secret</span>' : "";
  $("fcScope").innerHTML = (F.chan === "ALL" ? "All Channels" : F.chan)
    + " · " + fmtDY(F.from) + " → " + fmtDY(F.to) + noSched;

  // populate hour + team selectors
  const hourOpts = ['<option value="ALL">All hours</option>']
    .concat(HOURS.filter(h => rows.some(r => r.h === h))
      .map(h => '<option value="'+h+'"'+(+FC.fhour===h?' selected':'')+'>'+hourLbl(h)+'</option>')).join("");
  if ($("fcHour").innerHTML !== hourOpts) $("fcHour").innerHTML = hourOpts;
  const teams = ["ALL"].concat([...new Set(sched.map(s => s.team))].sort());
  const teamOpts = teams.map(t => '<option value="'+t+'"'+(FC.fteam===t?' selected':'')+'>'+(t==="ALL"?"All teams":t)+'</option>').join("");
  if ($("fcTeam").innerHTML !== teamOpts) $("fcTeam").innerHTML = teamOpts;

  const byDowHour = fcHourlyByDow(rows);
  const staffDow = fcStaffByDow(sched);

  // ---- Executive KPIs ----
  // forecasted total calls for the period = sum over in-range dates of that date's dow-hour forecast
  const dates = [...new Set(rows.map(r => r.d))].sort();
  let fcTotal = 0, underH = 0, overH = 0, okH = 0, worst = null;
  // per (dow,hour) status across the period
  const seenHH = new Set();
  for (const d of dates){
    const di = dowOf(d);
    for (let h = 0; h < 24; h++){
      const k = di + "|" + h;
      const calls = byDowHour[k] || 0;
      if (calls <= 0) continue;
      const staff = staffDow[k] || 0;
      const load = staff > 0 ? calls / staff : (calls > 0 ? Infinity : 0);
      fcTotal += calls;
      if (!hasSched){ continue; }
      const st = fcStatus(load);
      if (st === "under") underH++; else if (st === "over") overH++; else okH++;
      if (st === "under" && (!worst || load > worst.load)) worst = { d, h, calls, staff, load };
      seenHH.add(k);
    }
  }
  const avgStaff = dates.length ? sched.length / dates.length : 0; // agent-shifts/day ~ avg staffed
  $("fcKpis").innerHTML =
      kpi("📞 Forecasted Calls", nf(Math.round(fcTotal)), fmtDY(F.from)+" → "+fmtDY(F.to), "alt")
    + kpi("👥 Avg Staffed / Day", hasSched ? nf(Math.round(avgStaff)) : "—", hasSched ? "agents scheduled per day" : "no schedule", "agent")
    + kpi("🔴 Understaffed Hours", hasSched ? nf(underH) : "—", hasSched ? "forecast calls > capacity" : "no schedule", "bad")
    + kpi("🟡 Overstaffed Hours", hasSched ? nf(overH) : "—", hasSched ? "excess agents scheduled" : "no schedule", "warn")
    + kpi("🟢 Optimal Hours", hasSched ? nf(okH) : "—", hasSched ? "aligned with demand" : "no schedule", "good")
    + kpi("⚠️ Highest Risk Hour", worst ? hourLbl(worst.h) : "—",
         worst ? nf(Math.round(worst.calls))+" calls / "+(worst.staff?nf(Math.round(worst.staff)):"0")+" agents" : "none", "bad");

  // ---- Forecast by Day (day-of-week) ----
  const dayRows = [];
  for (let di = 0; di < 7; di++){
    // forecast = avg daily calls on this weekday across range
    const ddDates = dates.filter(d => dowOf(d) === di);
    let fcDay = 0;
    for (const d of ddDates){
      for (let h = 0; h < 24; h++) fcDay += (byDowHour[di + "|" + h] || 0);
    }
    fcDay = ddDates.length ? fcDay / ddDates.length : 0;
    // actual = most recent completed occurrence of this weekday in range
    const last = ddDates[ddDates.length - 1];
    let actual = null, acc = 0;
    if (last){
      for (const r of rows) if (r.d === last) acc += r.n;
      actual = acc;
    }
    const hist = fcDay; // historical average == forecast basis
    const variance = actual != null ? actual - Math.round(fcDay) : null;
    const acc_ = (actual != null && fcDay > 0) ? (100 - Math.abs(actual - fcDay) / fcDay * 100) : null;
    dayRows.push({ dow: DOW[di], fc: Math.round(fcDay), hist: Math.round(hist),
      actual: actual != null ? nf(actual) : "—",
      variance: variance == null ? "—" : (variance >= 0 ? "+" : "") + variance,
      acc: acc_ == null ? "—" : pf(Math.max(0, acc_)) });
  }
  tbl($("fcDayTbl"),
    [{t:"Day",k:"dow"},{t:"Forecast Calls",k:"fc",n:1},{t:"Historical Avg",k:"hist",n:1},
     {t:"Actual Calls",k:"actual"},{t:"Variance",k:"variance"},{t:"Forecast Accuracy",k:"acc"}],
    dayRows);

  // ---- Forecast by Hour ----
  const hourRows = [];
  for (let h = 0; h < 24; h++){
    if (!rows.some(r => r.h === h)) continue;
    // forecast for this hour = avg over in-range dates of calls in hour h
    let tot = 0, n = 0;
    const hd = new Set();
    for (const r of rows) if (r.h === h){ tot += r.n; hd.add(r.d); }
    const fcH = hd.size ? tot / hd.size : 0;
    // avg staffed agents this hour (across dates)
    let staff = 0;
    if (hasSched){
      const perDate = {};
      for (const d of hd){
        const ags = fcAgentsAt(sched, d, h);
        perDate[d] = ags.length;
      }
      const vals = Object.values(perDate);
      staff = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
    }
    const load = staff > 0 ? fcH / staff : (fcH > 0 ? Infinity : 0);
    const st = hasSched ? fcStatus(load) : "ok";
    const agentsList = hasSched ? fcAgentsAt(sched, dates[dates.length-1], h) : [];
    hourRows.push({
      h: hourLbl(h),
      fc: nf(Math.round(fcH)),
      hist: nf(Math.round(fcH)),
      staff: hasSched ? (staff ? nf(Math.round(staff*10)/10) : "0") : "—",
      load: hasSched ? (isFinite(load) ? nf(Math.round(load*10)/10) : "∞") : "—",
      status: hasSched ? (FC_ICON[st] + " " + FC_TXT[st]) : "—",
      _st: st,
      agents: agentsList
    });
  }
  $("fcHourScope").textContent = hasSched ? "calls/agent = forecast ÷ scheduled agents" : "schedule not loaded";
  const ht = $("fcHourTbl");
  ht.innerHTML = tblHtml(
    [{t:"Hour",k:"h"},{t:"Forecast Calls",k:"fc",n:1},{t:"Historical Avg",k:"hist",n:1},
     {t:"Scheduled Agents",k:"staff"},{t:"Calls/Agent",k:"load"},{t:"Staffing",k:"status"}],
    hourRows, r => r._st === "under" ? ' style="background:rgba(217,69,95,.12)"'
            : r._st === "over" ? ' style="background:rgba(217,160,184,.18)"' : "");

  // ---- Heatmap (dow rows x hour cols) ----
  buildHeatmap(root, byDowHour, staffDow, sched, hasSched, rows);

  // ---- Recommendations ----
  buildRecs(byDowHour, staffDow, hasSched);

  // auto-select hour if a filter hour chosen (show agents)
  if (FC.fhour !== "ALL") showAgentsForHour(+FC.fhour, sched, byDowHour, staffDow, hasSched);
  else $("fcAgents").innerHTML = '<p class="pagehint">Pick an hour above (or click a heatmap cell) to list the scheduled agents for that period.</p>';
}

// lightweight table helper that supports a row-attr callback
function tblHtml(cols, data, rowAttr){
  let h = "<tr>" + cols.map(c => "<th>"+c.t+"</th>").join("") + "</tr>";
  for (const r of data){
    const attr = rowAttr ? rowAttr(r) : "";
    h += "<tr" + attr + ">" + cols.map(c => {
      const v = r[c.k];
      if (c.n) return "<td class='n'>"+v+"</td>";
      return "<td>"+v+"</td>";
    }).join("") + "</tr>";
  }
  return h;
}

function buildHeatmap(root, byDowHour, staffDow, sched, hasSched, rows){
  const wrap = $("fcHeatWrap");
  if (!hasSched){ wrap.innerHTML = '<p class="pagehint">Schedule sheet not loaded — connect SCHED_SHEET to populate the heatmap.</p>'; return; }
  // only show hours that have any forecast volume
  const activeHours = HOURS.filter(h => rows.some(r => r.h === h));
  if (!activeHours.length){ wrap.innerHTML = "<p class='pagehint'>No call data in range.</p>"; return; }
  let html = '<div class="heatmap"><table><tr><th></th>'
    + activeHours.map(h => "<th>"+hourLbl(h).replace(" ", "").replace("AM","a").replace("PM","p")+"</th>").join("") + "</tr>";
  for (let di = 0; di < 7; di++){
    html += "<tr><th>"+DOW[di].slice(0,3)+"</th>";
    for (const h of activeHours){
      const k = di + "|" + h;
      const calls = byDowHour[k] || 0;
      const staff = staffDow[k] || 0;
      const load = staff > 0 ? calls / staff : (calls > 0 ? Infinity : 0);
      const st = calls <= 0 ? "none" : fcStatus(load);
      const cls = st === "under" ? "hm under" : st === "over" ? "hm over" : st === "ok" ? "hm ok" : "hm empty";
      const tip = calls <= 0 ? "no forecast volume" : (FC_ICON[st]+" "+fcCellTip(calls, staff, load));
      html += '<td class="'+cls+'" data-di="'+di+'" data-h="'+h+'" title="'+esc(DOW[di]+" "+hourLbl(h)+" — "+tip)+'">'
            + (calls <= 0 ? "" : FC_ICON[st]) + "</td>";
    }
    html += "</tr>";
  }
  html += "</table></div>";
  wrap.innerHTML = html;
  wrap.querySelectorAll(".hm").forEach(td => {
    td.onclick = () => {
      const di = +td.dataset.di, h = +td.dataset.h;
      const dateForDow = [...new Set(rows.map(r=>r.d))].filter(d => dowOf(d) === di).sort();
      const d = dateForDow[dateForDow.length - 1];
      showAgentsForHour(h, sched, byDowHour, staffDow, hasSched, d);
      // also sync the hour selector
      FC.fhour = String(h);
      if ($("fcHour")) $("fcHour").value = String(h);
    };
  });
}
function fcCellTip(calls, staff, load){
  const c = Math.round(calls), s = staff ? Math.round(staff*10)/10 : 0;
  const l = isFinite(load) ? (Math.round(load*10)/10) : "∞";
  return "forecast "+c+" calls · "+s+" agents · "+l+" calls/agent";
}

function showAgentsForHour(h, sched, byDowHour, staffDow, hasSched, date){
  const el = $("fcAgents");
  if (!hasSched){ el.innerHTML = "<p class='pagehint'>Schedule not loaded.</p>"; return; }
  const dates = date ? [date] : [...new Set(sched.map(s=>s.d))].sort();
  const d = dates[dates.length - 1];
  const ags = fcAgentsAt(sched, d, h);
  const di = dowOf(d);
  const calls = Math.round(byDowHour[di + "|" + h] || 0);
  const staff = staffDow[di + "|" + h] || 0;
  const load = staff > 0 ? calls / staff : (calls > 0 ? Infinity : 0);
  const st = calls <= 0 ? "ok" : fcStatus(load);
  el.innerHTML = '<div style="margin-bottom:8px"><b>'+DOW[di]+" "+hourLbl(h)+"</b> — "
    + (d ? "(showing "+fmtD(d)+")" : "") + "<br>"
    + "Forecasted calls: <b>"+nf(calls)+"</b> · Scheduled agents: <b>"+(staff?nf(Math.round(staff*10)/10):"0")+"</b> · "
    + "Calls/agent: <b>"+(isFinite(load)?nf(Math.round(load*10)/10):"∞")+"</b> "
    + FC_ICON[st] + " " + FC_TXT[st] + "</div>"
    + (ags.length ? '<div class="agchips">'+ags.map(a => '<span class="agchip">'+esc(a)+"</span>").join("")
                  : '<p class="pagehint">No agents scheduled this hour.</p>');
}

function buildRecs(byDowHour, staffDow, hasSched){
  const el = $("fcRecTbl");
  if (!hasSched){ el.innerHTML = "<p class='pagehint'>Schedule not loaded — connect SCHED_SHEET to generate recommendations.</p>"; return; }
  const recs = [];
  for (let h = 0; h < 24; h++){
    // use average across all dows for this hour (typical-day recommendation)
    let fcSum = 0, n = 0, stSum = 0, sn = 0;
    for (let di = 0; di < 7; di++){
      const k = di + "|" + h;
      if ((byDowHour[k]||0) > 0){ fcSum += byDowHour[k]; n++; }
      if ((staffDow[k]||0) > 0){ stSum += staffDow[k]; sn++; }
    }
    if (n === 0) continue;
    const fcH = fcSum / n;
    const staff = sn ? stSum / sn : 0;
    const ideal = Math.max(1, Math.ceil(fcH / FC_TARGET));
    const load = staff > 0 ? fcH / staff : (fcH > 0 ? Infinity : 0);
    const diff = ideal - Math.round(staff);
    let status, rec;
    if (load >= FC_UNDER){
      status = "under";
      if (diff > 0) rec = "Add " + diff + " agent" + (diff>1?"s":"") + " — high call demand vs staff";
      else rec = "Rebalance: demand exceeds healthy load";
    } else if (load <= FC_OVER){
      status = "over";
      if (diff < 0) rec = "Move " + Math.abs(diff) + " agent" + (Math.abs(diff)>1?"s":"") + " to a peak hour";
      else rec = "Healthy but light load — consider shifting if peaks exist";
    } else {
      status = "ok";
      rec = "Aligned with demand";
    }
    recs.push({ h: hourLbl(h), staff: staff ? nf(Math.round(staff*10)/10) : "0",
      fc: nf(Math.round(fcH)), status: FC_ICON[status] + " " + FC_TXT[status],
      ideal: nf(ideal), rec, _st: status });
  }
  // sort: understaffed first (biggest gaps), then overstaffed, then ok
  recs.sort((a,b) => (a._st==="under"?0:a._st==="over"?1:2) - (b._st==="under"?0:b._st==="over"?1:2));
  el.innerHTML = tblHtml(
    [{t:"Hour",k:"h"},{t:"Current Staffing",k:"staff"},{t:"Forecast Calls",k:"fc"},
     {t:"Status",k:"status"},{t:"Recommended Staffing",k:"ideal"},{t:"Recommendation",k:"rec"}],
    recs, r => r._st === "under" ? ' style="background:rgba(217,69,95,.12)"'
            : r._st === "over" ? ' style="background:rgba(217,160,184,.18)"' : "");
}
