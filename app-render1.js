/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
function kpi(l,v,s,cls){ return '<div class="kpi '+(cls||"")+'"><div class="k-l">'+l+'</div><div class="k-v">'+v
  +'</div><div class="k-s">'+(s||"&nbsp;")+'</div></div>'; }
function tbl(el, cols, rows, opts){
  const o = opts||{};
  let h = "<thead><tr>"+cols.map(c=>'<th class="'+(c.n?"n":"")+(c.sort?" sortable":"")+'"'
      +(c.sort?' data-sort="'+c.sort+'"':'')+'>'+c.t+"</th>").join("")+"</tr></thead><tbody>";
  if (!rows.length) h += '<tr><td colspan="'+cols.length+'"><div class="empty">No data for the current filters.</div></td></tr>';
  rows.forEach(r=>{ h += '<tr'+(r._cls?' class="'+r._cls+'"':'')+(r._click?' style="cursor:pointer" data-click="'+esc(r._click)+'"':'')+'>'
      + cols.map(c=>'<td class="'+(c.n?"n":"")+'">'+r[c.k]+"</td>").join("")+"</tr>"; });
  el.innerHTML = h+"</tbody>";
  makeTableResponsive(el);
}
/* Ensure every table sits in a horizontally scrollable box so it can never
   overflow its card on a narrow screen. Idempotent — safe on every re-render. */
function makeTableResponsive(el){
  const p = el.parentNode;
  if (!p || p.classList.contains("tscroll") || p.classList.contains("scroll")) return;
  const box = document.createElement("div");
  box.className = "tscroll";
  p.insertBefore(box, el);
  box.appendChild(el);
}
function barCell(v, max, txt){
  const w = max? Math.max(2, v/max*100) : 0;
  return '<div class="bar-cell"><i style="width:'+w+'%"></i><span>'+(txt!==undefined?txt:nf(v))+'</span></div>';
}

/* ---------- main render ---------- */
function render(){
  const rows = slice(), M = agg(rows);
  const gran = F.gran;
  // when a specific week or month is picked for the daily breakdown, scope the volume + answer-rate charts to it
  const dw = F.dayScope && F.dayScope !== "ALL" ? F.dayScope : null;
  const dwRows = dw ? (dw.length === 10 ? rows.filter(r => r.d >= dw && r.d <= (addD(dw,6) > MAX_D ? MAX_D : addD(dw,6)))
                                        : rows.filter(r => r.d >= dw && r.d <= monthEnd(dw))) : rows;
  const dwM = dw ? agg(dwRows) : M;

  $("metaRange").textContent = fmtDY(F.from)+"  \u2192  "+fmtDY(F.to);
  $("metaGen").textContent = "data refreshed "+D.generated.replace("T"," ");
  $("kpiScope").textContent = (F.chan==="ALL"?"All Channels":F.chan)
    + (F.ivr!=="ALL"? " \u00b7 "+F.ivr : "");

  /* ---- KPIs (exact set requested) ---- */
  $("kpiRow").innerHTML =
      kpi("Total Calls", nf(M.total), fmtD(F.from)+" \u2013 "+fmtD(F.to))
    + kpi("Total Calls Received by Agents", nf(M.agentReceived), "total \u2212 IVR-abandoned \u2212 OOH", "agent")
    + kpi("Total Unanswered", nf(M.unanswered), pf(M.missRate)+" of agent calls", "bad")
    + kpi("Answered", nf(M.answered), pf(M.answerRate)+" answer rate", "good")
    + kpi("Missed", nf(M.missed), pf(M.missed/M.agentReceived*100)+" of agent calls", "bad");
  $("kpiRow2").innerHTML =
      kpi("Abandoned \u2014 No IVR Branch", nf(M.noIvrAband), pf(M.noIvrPct)+" of all abandoned", "bad")
    + kpi("Total Abandoned in IVR", nf(M.ivrAband), M.abandoned? pf(M.ivrAband/M.abandoned*100)+" of all abandoned":"", "alt")
    + kpi("Out of Business Hours", nf(M.ooh), M.total? pf(M.ooh/M.total*100)+" of volume":"", "warn")
    + kpi("Answer Rate", pf(M.answerRate), nf(M.answered)+" / "+nf(M.agentReceived)+" agent calls", M.answerRate>=70?"good":M.answerRate>=50?"warn":"bad")
    + kpi("Missed Call Rate", pf(M.missRate), nf(M.unanswered)+" / "+nf(M.agentReceived)+" agent calls", "bad")
    + kpi("AHT", mmss(M.aht), "avg over "+nf(M.answered)+" answered calls");

  /* ---- trend / volume ---- */
  const volRows = dwRows;
  const byP = groupBy(volRows, r=>periodKey(r.d, gran));
  const pk = [...byP.keys()].sort();
  const noneView = (gran === "none");
  const scopeLabel = dw ? (dw.length === 10 ? fmtWeek(dw) : fmtMonth(dw)) : "";
  const wkLabel = dw ? " &middot; "+scopeLabel : "";
  $("trendTitle").textContent = noneView ? "Call Volume (Full Range)" : "Call Volume by Day"+(dw?" for "+scopeLabel:"");
  // daily & weekly both plot per-day; monthly plots per-month; none plots the full range as one block
  const volKey = (gran==="monthly"||noneView) ? r=>monthStart(r.d) : r=>r.d;
  const byV = groupBy(volRows, volKey); const vk=[...byV.keys()].sort();
  $("trendSub").textContent = (noneView ? "1 period (full range)" : vk.length+" periods")+wkLabel;
  stackedBars("chTrend", vk.map(k=>{ const m=byV.get(k);
    return {label: noneView ? "Full Range" : (gran==="monthly"?fmtMonth(k):fmtD(k)), total:m.total,
            vals:{answered:m.answered,missed:m.missed,abandoned:m.abandoned,ooh:m.ooh}}; }));

  donut("chDonut", [
    {label:"Answered", value:M.answered, color:COL.answered},
    {label:"Missed", value:M.missed, color:COL.missed},
    {label:"Abandoned", value:M.abandoned, color:COL.abandoned},
    {label:"Out of Business Hours", value:M.ooh, color:COL.ooh}]);

  /* ---- hourly ---- */
  const byH = groupBy(rows, r=>r.h);
  const hk = [...byH.keys()].sort((a,b)=>a-b);
  stackedBars("chHour", hk.map(h=>{ const m=byH.get(h);
    return {label:hourLbl(h), total:m.total, vals:{answered:m.answered,missed:m.missed,abandoned:m.abandoned,ooh:m.ooh}}; }), {h:300});
  const peak = k => { let b=null; byH.forEach((m,h)=>{ if(!b||m[k]>byH.get(b)[k]) b=h; }); return b; };
  const pv=peak("total"), pm=peak("missed"), pa=peak("abandoned");
  let noIvrByHour = new Map();
  rows.filter(r=>r.st==="abandoned"&&r.ivr===NO_IVR).forEach(r=>noIvrByHour.set(r.h,(noIvrByHour.get(r.h)||0)+r.n));
  let pn=null; noIvrByHour.forEach((v,h)=>{ if(pn===null||v>noIvrByHour.get(pn)) pn=h; });
  $("peakSub").innerHTML = pv===null? "" :
      "Peak volume <b>"+hourLbl(pv)+"</b> \u00b7 peak missed <b>"+hourLbl(pm)+"</b> \u00b7 peak abandoned <b>"+hourLbl(pa)
      +"</b> \u00b7 peak no-IVR abandoned <b>"+(pn===null?"\u2014":hourLbl(pn))+"</b>";

  tbl($("tHour"),
    [{t:"Hour",k:"h"},{t:"Total",k:"t",n:1},{t:"Answered",k:"a",n:1},{t:"Missed",k:"m",n:1},
     {t:"Abandoned",k:"ab",n:1},{t:"No-IVR Aband.",k:"ni",n:1},{t:"OOH",k:"o",n:1},
     {t:"Answer Rate",k:"ar",n:1},{t:"Abandon Rate",k:"abr",n:1}],
    hk.map(h=>{ const m=byH.get(h); const mx=Math.max(...hk.map(x=>byH.get(x).total));
      return {h:hourLbl(h)+(h===pv?' <span class="tag">peak</span>':''), t:barCell(m.total,mx), a:nf(m.answered),
              m:nf(m.missed), ab:nf(m.abandoned), ni:nf(noIvrByHour.get(h)||0), o:nf(m.ooh),
              ar:pf(m.answerRate), abr:pf(m.abandRate)}; })
      .concat([{_cls:"tot", h:"TOTAL", t:nf(M.total), a:nf(M.answered), m:nf(M.missed), ab:nf(M.abandoned),
               ni:nf(M.noIvrAband), o:nf(M.ooh), ar:pf(M.answerRate), abr:pf(M.abandRate)}]));

  /* ---- answer rate trend ---- */
  lineChart("chRate", vk.map(k=>{ const m=byV.get(k);
    return {label: noneView ? "Full Range" : (gran==="monthly"?fmtMonth(k):fmtD(k)), v:m.answerRate,
            note:nf(m.answered)+" of "+nf(m.total)+" answered"}; }));

  /* ---- period table (with multi-period picker) ---- */
  renderPeriodPicker();
  const picks = [...F.picks].sort();
  let prows, ptot;
  if (picks.length){
    // ignore date range; show exactly the picked periods, each fully aggregated
    prows = picks.map(k=>{ const [a,b] = periodBounds(k, gran);
      return {k, m: agg(slice(Object.assign({}, F, {from:a, to:b})))}; });
    ptot = blank();
    prows.forEach(r=>{ ["total","answered","missed","abandoned","ooh","sec","noIvrAband","ivrAband"]
      .forEach(f=> ptot[f] += r.m[f]); });
    finish(ptot);
    $("periodSub").textContent = picks.length+" periods selected \u00b7 date range ignored";
  } else {
    prows = pk.map(k=>({k, m: byP.get(k)}));
    ptot = M;
    $("periodSub").textContent = "following the date range above";
  }
  const pmax = Math.max(1, ...prows.map(r=>r.m.total));
  tbl($("tPeriod"),
    [{t:gran==="daily"?"Day":gran==="weekly"?"Week":gran==="none"?"Range":"Month",k:"p"},{t:"Total",k:"t",n:1},{t:"Answered",k:"a",n:1},
     {t:"Missed",k:"m",n:1},{t:"Abandoned",k:"ab",n:1},{t:"No-IVR Aband.",k:"ni",n:1},{t:"OOH",k:"o",n:1},
     {t:"Answer Rate",k:"ar",n:1},{t:"Missed Rate",k:"mr",n:1},{t:"Abandon Rate",k:"abr",n:1},{t:"AHT",k:"aht",n:1}],
    prows.map(r=>{ const m=r.m;
      return {p:periodLabel(r.k,gran), t:barCell(m.total,pmax), a:nf(m.answered), m:nf(m.missed), ab:nf(m.abandoned),
              ni:nf(m.noIvrAband), o:nf(m.ooh), ar:pf(m.answerRate), mr:pf(m.missRate), abr:pf(m.abandRate), aht:mmss(m.aht)}; })
      .concat([{_cls:"tot", p:picks.length?"COMBINED":"TOTAL", t:nf(ptot.total), a:nf(ptot.answered), m:nf(ptot.missed),
               ab:nf(ptot.abandoned), ni:nf(ptot.noIvrAband), o:nf(ptot.ooh), ar:pf(ptot.answerRate),
               mr:pf(ptot.missRate), abr:pf(ptot.abandRate), aht:mmss(ptot.aht)}]));
  renderPeriodDelta(prows, gran);

  renderIvr(rows, M, gran);
  renderAgents();
  renderAgentInsights();
  renderCompare(rows, M);
  renderSummary(M, pv, gran);
  bkRender();   // Call Breakdown page (no-op unless that page is active)
}
