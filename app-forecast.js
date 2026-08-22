/* ---------- Call Forecast & Staffing page ----------
   Source of truth (all from data, nothing fabricated):
     • Inbound call volume per interval  -> ROWS (the inbound calls sheet)
     • Seated (scheduled) agents/hour    -> D.schedule (Call Schedule sheet)
     • Break / lunch / back-office mins  -> D.breaks  (Break sheet, Aug 3-9)
   For each interval we show: Calls, Seated, On Break/Lunch/BO, Net Available,
   Calls per Available Agent, and an Under/Over/Adequate flag.
   NOTE: the break sheet is per-DAY (no interval timestamps), so "on break" is the
   day's real break minutes spread as an unavailable fraction of seated agents —
   we cannot say who was on break at a specific hour.
*/

// Day-of-week selector options. Value = dowOf() index (0=Mon .. 6=Sun).
const FC_WD = [["ALL","All days"],["0","Mon"],["1","Tue"],["2","Wed"],["3","Thu"],["4","Fri"],["5","Sat"],["6","Sun"]];

const FC = { gran: "daily", fhour: "ALL", fteam: "ALL", from: "2026-08-03", to: "2026-08-09",
             date: "ALL", block: null, wday: "ALL" };
// Break sheet covers Aug 3-9 -> forecast defaults there (global date range untouched).
// date:    "ALL" or a single date -> filters the Agents-Available-per-Interval table (and heatmap).
// heatGran: "daily" (one row per date) or "weekly" (one row per week) for the heatmap.

// staffing thresholds: calls per available agent per hour
const FC_UNDER = 6.0;   // >= this -> Understaffed (red)
const FC_OVER  = 2.5;   // <= this -> Overstaffed (yellow)
const FC_TARGET = 4.0;  // healthy target

const DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const HOURS = [...Array(24).keys()];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function hourLbl(h){ const am = h < 12; const hr = h % 12 === 0 ? 12 : h % 12; return hr + (am ? " AM" : " PM"); }
function fmtMD(d){ return MON3[+d.slice(5,7)-1] + " " + (+d.slice(8,10)) + ", " + d.slice(0,4); }  // "Aug 3, 2026"
function dowOf(d){ return (new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)).getDay() + 6) % 7; }

function fcRange(){
  // When "All weeks" is selected, span the whole dataset so the 4-week block
  // selector can show any window (e.g. Jul 6 – Aug 2). A specific global week/month
  // still narrows the page to that range.
  const whole = (F.from === MIN_D && F.to === MAX_D);
  return whole ? { from: MIN_D, to: MAX_D } : { from: F.from, to: F.to };
}

// distinct dates present in the current filtered rows (for the date toggle)
function fcDates(){
  return [...new Set(fcFilteredRows().map(r => r.d))].sort();
}
// 4-week blocks for the heatmap: each option starts on a Monday and spans 28 days
// (4 weeks, Mon–Sun ×4). Blocks step by FOUR weeks (28 days) so they are
// contiguous and non-overlapping: Jun 1→28, Jun 29→Jul 26, Jul 27→Aug 17, etc.
function fcBlockOpts(){
  const all = [...new Set(ROWS.map(r => r.d))].sort();
  if (!all.length) return [];
  let s = all[0]; const w = dowOf(s); if (w > 0) s = addD(s, -w);   // back to Monday
  const last = all[all.length - 1];
  const out = [];
  let cur = s;
  while (cur <= last){
    const end = addD(cur, 27);
    out.push({ start: cur, end: end > last ? last : end });
    cur = addD(cur, 28);   // step 4 weeks -> contiguous, non-overlapping blocks
  }
  return out;
}
function fcDefaultBlock(){
  const opts = fcBlockOpts();
  if (!opts.length) return (F.from === MIN_D ? FC.from : F.from);
  const full = opts.filter(o => o.end === addD(o.start, 27));   // prefer a fully-covered block
  const pick = full.length ? full : opts;
  return pick[pick.length - 1].start;
}
// weekly group key for the heatmap (Monday-based week start)
function fcWeekKey(d){
  const dt = new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10));
  const w = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - w);
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,"0"), day = String(dt.getDate()).padStart(2,"0");
  return y + "-" + m + "-" + day;
}

function fcFilteredRows(){
  const R = fcRange();
  return ROWS.filter(r =>
    r.d >= R.from && r.d <= R.to &&
    (F.chan === "ALL" || r.ch === F.chan) &&
    r.h >= 0);
}
function fcSchedRows(R){
  R = R || fcRange();
  const sched = (D.schedule && D.schedule.rows) ? D.schedule.rows : (Array.isArray(D.schedule) ? D.schedule : []);
  if (!sched.length) return [];
  return sched.filter(s =>
    s.d >= R.from && s.d <= R.to &&
    (F.chan === "ALL" ? true : (s.team === F.chan || s.team === "ALL")));
}
function fcAgentsAt(sched, date, hour){
  const set = new Set();
  for (const s of sched) if (s.d === date && s.hours.includes(hour)) set.add(s.agent);
  return [...set].sort();
}
// unavailable fraction for an agent on a date, from the break sheet (real minutes)
function fcUnavailFrac(agent, date){
  const B = D.breaks;
  if (!B || !B.byMember) return 0;
  const m = B.byMember[agent + "|" + date];
  if (!m) return 0;
  const reg = m.regular || 0;
  const unav = m.total || 0;            // break + restroom + lunch + backoffice
  if (reg <= 0) return 0;
  let f = unav / reg;
  if (f > 0.6) f = 0.6;                 // cap: never assume >60% of the day is break
  return f;
}

function fcStatus(load){
  if (load >= FC_UNDER) return "under";
  if (load <= FC_OVER)  return "over";
  return "ok";
}
const FC_ICON = { under: "🔴", over: "🟡", ok: "🟢" };
const FC_TXT  = { under: "Understaffed", over: "Overstaffed", ok: "Adequately Staffed" };

// Build the per (date, hour) staffing model for the selected range.
function fcModel(){
  const rows = fcFilteredRows();
  const R = fcRange();
  const sched = fcSchedRows(R);
  const hasSched = sched.length > 0;
  const hasBreak = !!(D.breaks && D.breaks.byMember);
  // 4-week block start (honor the dropdown; default to the latest fully-covered block)
  if (FC.block == null) FC.block = fcDefaultBlock();
  // model the whole block (every date in range), regardless of the single-date toggle
  const allDates = [...new Set(rows.map(r => r.d))].sort()
    .filter(d => d >= FC.block && d <= addD(FC.block, 27));
  let activeDates = allDates.length ? allDates
    : [...new Set(rows.map(r => r.d))].sort().filter(d => d >= R.from && d <= R.to);
  // Day-of-week toggle: keep only the selected weekday across the 4-week block
  // (e.g. Monday -> all 4 Mondays, one row each).
  if (FC.wday !== "ALL"){
    activeDates = activeDates.filter(d => dowOf(d) === (+FC.wday));
  }
  const cells = {};   // date|hour -> {calls, seated[], unav[]}
  for (const d of activeDates){
    for (let h = 0; h < 24; h++){
      const calls = rows.filter(r => r.d === d && r.h === h).reduce((a,r)=>a+r.n, 0);
      const seated = hasSched ? fcAgentsAt(sched, d, h) : [];
      const unav = seated.map(a => fcUnavailFrac(a, d));
      cells[d + "|" + h] = { calls, seated, unav, seatedN: seated.length,
        unavN: seated.length ? seated.reduce((a,_,i)=>a+unav[i],0) : 0 };
    }
  }
  let heatRows;
  if (FC.wday !== "ALL"){
    // one row per matching weekday (all Mondays, etc.), labeled by date
    heatRows = activeDates.slice().sort().map(d => ({ label: d, dates: [d], key: d }));
  } else {
    // heatmap rows: one per Monday-of-week (each row = that week's 7 days), within the block
    const wkMap = {};
    for (const d of activeDates){ const wk = fcWeekKey(d); (wkMap[wk] = wkMap[wk] || []).push(d); }
    heatRows = Object.keys(wkMap).sort().map(wk => ({ label: wk, dates: wkMap[wk].slice().sort(), key: wk }));
  }
  return { rows, sched, hasSched, hasBreak, dates: activeDates, heatRows, cells, block: FC.block };
}

function renderForecast(){
  if (F.page !== "forecast") return;
  const root = $("forecastRoot");
  if (!root) return;
  if (!root.dataset.built){
    root.innerHTML =
      '<div class="sect"><h2>📊 Call Forecast &amp; Staffing</h2>'
      + '<span class="chip" id="fcScope"></span><div class="line"></div></div>'
      + '<div class="kpis" id="fcKpis"></div>'
      + '<div class="forecast-controls">'
      + '  <div class="fgroup"><span class="flabel">4-Week Block</span><select id="fcBlock" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">Day of Week</span><select id="fcWday" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">Interval Date</span><select id="fcDate" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">Hour</span><select id="fcHour" class="pillsel"></select></div>'
      + '  <div class="fgroup"><span class="flabel">&nbsp;</span><button class="btn ghost" id="fcReset">Reset</button></div>'
      + '</div>'
      + '<div class="sect" style="margin-top:18px"><h2>Staffing Heatmap (Week × Hour)</h2>'
      + '<span class="chip">each row = one week (Mon–Sun) · green = adequately staffed · red = understaffed · yellow = overstaffed'
      + (FC.wday !== "ALL" ? ' · showing only ' + FC_WD.find(w=>w[0]===FC.wday)[1] + 's across the 4-week block' : '') + '</span><div class="line"></div></div>'
      + '<div class="card" id="fcHeatWrap"></div>'
      + '<div class="fc-legend"><span><i class="k"></i> Adequately staffed</span>'
      + '<span><i class="u"></i> Understaffed (≥ '+FC_UNDER+' calls/agent)</span>'
      + '<span><i class="o"></i> Overstaffed (≤ '+FC_OVER+' calls/agent)</span></div>'
      + '<div class="sect" style="margin-top:18px"><h2>Agents Available per Interval</h2>'
      + '<span class="chip" id="fcIntScope"></span><div class="line"></div></div>'
      + '<div class="card"><div class="scroll"><table id="fcIntTbl"></table></div></div>'
      + '<p class="pagehint">Calls come from your inbound calls sheet; seated agents from the Call Schedule sheet; '
      + 'break / lunch / back-office minutes from the Break sheet (Aug 3–9). Net Available = Seated − (real break minutes that day). '
      + 'Understaffed ≥ '+FC_UNDER+' calls/available agent · Overstaffed ≤ '+FC_OVER+'. '
      + 'The break sheet is per-day (no hourly timestamps), so "on break" is the day\'s real break time spread across seated agents.</p>';
    root.dataset.built = "1";
    $("fcBlock").onchange = e => { FC.block = e.target.value; renderForecast(); };
    $("fcWday").onchange = e => { FC.wday = e.target.value; renderForecast(); };
    $("fcDate").onchange = e => { FC.date = e.target.value; renderForecast(); };
    $("fcHour").onchange = e => { FC.fhour = e.target.value; renderForecast(); };
    $("fcReset").onclick = () => { FC.date = "ALL"; FC.fhour = "ALL"; FC.wday = "ALL";
      $("fcDate").value = "ALL"; $("fcHour").value = "ALL"; $("fcWday").value = "ALL"; renderForecast(); };
  }

  const M = fcModel();
  const hasSched = M.hasSched, hasBreak = M.hasBreak;
  const miss = [];
  if (!hasSched) miss.push("schedule sheet not loaded — set SCHED_SHEET");
  if (!hasBreak) miss.push("break sheet not loaded — set BREAK_SHEET");
  const missHtml = miss.length ? ' · <span style="color:#D9455F">'+miss.join(" · ")+'</span>' : "";
  const R = fcRange();
  const blkEnd = addD(FC.block, 27);
  $("fcScope").innerHTML = (F.chan === "ALL" ? "All Channels" : F.chan)
    + " · " + fmtDY(FC.block) + " → " + fmtDY(blkEnd > R.to ? R.to : blkEnd) + missHtml;

  // 4-week block selector (every Monday becomes a block start)
  const blockOpts = fcBlockOpts().map(o => '<option value="'+o.start+'"'+(o.start===FC.block?' selected':'')+'>'
    + fmtMD(o.start) + ' → ' + fmtMD(o.end > R.to ? R.to : o.end) + '</option>').join("");
  if ($("fcBlock").innerHTML !== blockOpts) $("fcBlock").innerHTML = blockOpts;

  // day-of-week selector (ALL + Mon..Sun, where 0=Mon..6=Sun via dowOf)
  const wdayOpts = FC_WD.map(w => '<option value="'+w[0]+'"'+(w[0]===FC.wday?' selected':'')+'>'+w[1]+'</option>').join("");
  if ($("fcWday").innerHTML !== wdayOpts) $("fcWday").innerHTML = wdayOpts;

  // hour selector
  const hourOpts = ['<option value="ALL">All hours</option>']
    .concat(HOURS.filter(h => M.rows.some(r => r.h === h))
      .map(h => '<option value="'+h+'"'+(+FC.fhour===h?' selected':'')+'>'+hourLbl(h)+'</option>')).join("");
  if ($("fcHour").innerHTML !== hourOpts) $("fcHour").innerHTML = hourOpts;

  // date selector (filters the interval table to one date; heatmap stays on the whole block)
  const dateOpts = ['<option value="ALL">All dates</option>']
    .concat(fcDates().map(d => '<option value="'+d+'"'+(FC.date===d?' selected':'')+'>'+fmtMD(d)+' · '+DOW[dowOf(d)].slice(0,3)+'</option>')).join("");
  if ($("fcDate").innerHTML !== dateOpts) $("fcDate").innerHTML = dateOpts;

  // ---- KPIs ----
  let totCalls=0, totSeated=0, totUnav=0, underH=0, overH=0, okH=0, worst=null, numCells=0;
  for (const d of M.dates){
    for (let h=0; h<24; h++){
      if (FC.fhour !== "ALL" && +FC.fhour !== h) continue;
      const c = M.cells[d+"|"+h];
      if (!c || c.calls <= 0) continue;
      numCells++;
      totCalls += c.calls;
      const avail = Math.max(0, c.seatedN - c.unavN);
      totSeated += c.seatedN; totUnav += c.unavN;
      if (!hasSched){ continue; }
      const load = avail > 0 ? c.calls / avail : (c.calls > 0 ? Infinity : 0);
      const st = fcStatus(load);
      if (st==="under") underH++; else if (st==="over") overH++; else okH++;
      if (st==="under" && (!worst || load>worst.load)) worst={d,h,calls:c.calls,avail,load};
    }
  }
  const avgAvail = numCells ? (totSeated - totUnav)/numCells : 0;
  $("fcKpis").innerHTML =
      kpi("📞 Total Calls", nf(totCalls), fmtDY(FC.block) + " → " + fmtDY(blkEnd > R.to ? R.to : blkEnd), "alt")
    + kpi("👥 Avg Seated", hasSched ? nf(Math.round(totSeated/Math.max(1,numCells))) : "—", "scheduled agents (avg/hour)", "agent")
    + kpi("✅ Net Available", hasSched ? nf(Math.round(avgAvail)) : "—", "seated − break (avg/hour)", "good")
    + kpi("🔴 Understaffed Hrs", hasSched ? nf(underH) : "—", "calls > capacity", "bad")
    + kpi("🟡 Overstaffed Hrs", hasSched ? nf(overH) : "—", "excess seated", "warn")
    + kpi("⚠️ Highest Risk", worst ? hourLbl(worst.h) : "—",
         worst ? nf(worst.calls)+" calls / "+nf(Math.round(worst.avail))+" avail" : "none", "bad");

  // ---- Interval table (one row per date×hour with calls) ----
  const intRows = [];
  for (const d of M.dates){
    for (let h=0; h<24; h++){
      if (FC.fhour !== "ALL" && +FC.fhour !== h) continue;
      const c = M.cells[d+"|"+h];
      if (!c || c.calls <= 0) continue;
      const avail = Math.max(0, c.seatedN - c.unavN);
      const load = avail > 0 ? c.calls / avail : (c.calls > 0 ? Infinity : 0);
      const st = hasSched ? fcStatus(load) : "ok";
      intRows.push({
        when: fmtMD(d) + " · " + DOW[dowOf(d)].slice(0,3) + " " + hourLbl(h),
        _date: d, _hour: h,                       // real sort keys (chronological)
        calls: nf(c.calls),
        seated: hasSched ? nf(c.seatedN) : "—",
        seatedN: c.seatedN,
        avail: hasSched ? nf(Math.round(avail*10)/10) : "—",
        load: hasSched ? (isFinite(load) ? nf(Math.round(load*10)/10) : "∞") : "—",
        status: hasSched ? (FC_ICON[st] + " " + FC_TXT[st]) : "—",
        _st: st, _avail: avail, _calls: c.calls,
        _cls: st === "under" ? "row-under" : st === "over" ? "row-over" : ""
      });
    }
  }
  // chronological: date ascending, then hour ascending (12 AM -> 11 PM)
  intRows.sort((a,b)=> a._date<b._date ? -1 : a._date>b._date ? 1 : a._hour-b._hour);
  $("fcIntScope").textContent = hasSched ? "Net Available = Seated − break/lunch/back-office" : "schedule not loaded";
  const it = $("fcIntTbl");
  tbl(it,
    [{t:"Interval",k:"when"},{t:"Calls",k:"calls",n:1},{t:"Seated",k:"seated",n:1},
     {t:"Net Available",k:"avail",n:1},{t:"Calls/Avail",k:"load",n:1},{t:"Staffing",k:"status"}],
    intRows);

  // ---- Heatmap: date rows × hour cols, colored by status ----
  buildHeatmap(M);
}

function buildHeatmap(M){
  const wrap = $("fcHeatWrap");
  if (!wrap) return;
  const hasSched = M.hasSched;
  let h = '<table class="schedgrid" style="min-width:680px"><thead><tr><th class="sticky-col">Week (Mon–Sun)</th>';
  for (let hh=0; hh<24; hh++) h += '<th>'+hourLbl(hh).replace(" ","")+'</th>';
  h += '</tr></thead><tbody>';
  for (let ri = 0; ri < M.heatRows.length; ri++){
    const row = M.heatRows[ri];
    let labelTxt;
    if (FC.wday !== "ALL" && row.dates.length === 1){
      const d = row.dates[0];
      labelTxt = (DOW[dowOf(d)].slice(0,3)) + " " + fmtMD(d);   // e.g. "Mon Jun 29"
    } else {
      const sunday = addD(row.key, 6);
      labelTxt = fmtMD(row.key) + ' → ' + fmtMD(sunday)   // Monday → Sunday of that week
        + ' <span class="wd">wk'+(ri+1)+'</span>';
    }
    h += '<tr><td class="sticky-col">'+labelTxt+'</td>';
    for (let hh=0; hh<24; hh++){
      let calls=0, seatedN=0, unavN=0, any=false;
      for (const d of row.dates){
        const c = M.cells[d+"|"+hh];
        if (c){ calls += c.calls; seatedN += c.seatedN; unavN += c.unavN; if (c.calls>0) any=true; }
      }
      if (!any){ h += '<td class="blank"></td>'; continue; }
      const avail = Math.max(0, seatedN - unavN);
      const load = avail > 0 ? calls/avail : (calls>0?Infinity:0);
      const st = hasSched ? fcStatus(load) : "ok";
      const bg = st==="under" ? "background:#f8d2da;color:#8a1f33"
              : st==="over" ? "background:#fff3c4;color:#7a5a00"
              : "background:#dcf3e3;color:#1f7a46";
      h += '<td class="'+st+'" style="'+bg+'" title="'+nf(calls)+' calls / '+nf(Math.round(avail))+' avail">'+nf(calls)+'</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  wrap.innerHTML = h;
}
