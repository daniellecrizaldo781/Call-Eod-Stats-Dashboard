/* ---------- IVR section ---------- */
function renderIvr(rows, M, gran){
  // The IVR breakdown must always show ALL branches within the current
  // channel/date scope — independent of the selected IVR filter. Otherwise
  // clicking a row (which sets F.ivr) collapses this table to one row.
  const ivrRows = sliceAllIvr();
  const byI = groupBy(ivrRows, r=>r.ivr);
  const list = [...byI.entries()].sort((a,b)=>b[1].total-a[1].total);

  // highest abandonment (count) and highest abandonment RATE (min volume guard)
  let topCnt=null, topRate=null;
  list.forEach(([k,m])=>{
    if (!topCnt || m.abandoned > topCnt[1].abandoned) topCnt=[k,m];
    if (m.total>=25 && (!topRate || m.abandRate > topRate[1].abandRate)) topRate=[k,m];
  });
  const noIvr = byI.get(NO_IVR);
  $("ivrKpis").innerHTML =
      kpi("Abandoned &mdash; No IVR Branch", nf(M.noIvrAband), pf(M.noIvrPct)+" of total abandoned", "bad big")
    + kpi("No-IVR Total Calls", nf(noIvr?noIvr.total:0), noIvr? pf(noIvr.abandRate)+" abandon rate":"none in range", "alt big")
    + kpi("Active IVR Branches", nf(list.filter(x=>x[0]!==NO_IVR).length), "in current filter", "big")
    + kpi("Most Abandoned Branch", topCnt?esc(topCnt[0]):"&mdash;", topCnt? nf(topCnt[1].abandoned)+" abandoned calls":"", "bad big")
    + kpi("Highest Abandon Rate", topRate?esc(topRate[0]):"&mdash;",
          topRate? pf(topRate[1].abandRate)+" of "+nf(topRate[1].total)+" calls":"min 25 calls", "warn big")
    + kpi("Busiest Branch", list.length?esc(list[0][0]):"&mdash;", list.length? nf(list[0][1].total)+" calls":"", "alt big");

  groupedHBars("chIvrBar", list.slice(0,12).map(([k,m])=>({label:k,
      vals:{answered:m.answered, abandoned:m.abandoned, missed:m.missed}})), ["answered","abandoned","missed"]);

    // click a branch label in the Answered-vs-Abandoned chart -> lightbox with a
    // daily x hourly call-count table for that branch (within the current scope).
    const ivrBarEl = $("chIvrBar");
    if (ivrBarEl){
      ivrBarEl.querySelectorAll("text[data-t]").forEach(tx => {
              tx.classList.add("ivr-branch-link");
              tx.addEventListener("click", function(){
                openIvrLightbox(tx.getAttribute("data-t"));
              });
            });
    }

  const ab = list.filter(x=>x[1].abandoned>0).sort((a,b)=>b[1].abandoned-a[1].abandoned).slice(0,12);
  hBars("chIvrAband", ab.map(([k,m])=>({label:k, value:m.abandoned,
    color: k===NO_IVR? "#D9455F":"#B99BDD", note:pf(m.abandRate)+" abandon rate · "+nf(m.total)+" total"})), {unit:"abandoned"});

  /* IVR Branch by Day/Week/Month — spreadsheet-style pivot, respects channel filter */
  const EXCLUDE_BRANCHES = new Set(["Repeat Option","Repeat Message","Tier 1","Tier 2"]);
  const pkey = r => periodKey(r.d, gran);
  const pkeys = [...new Set(rows.map(pkey))].sort();
  const BRANCHES = IVRS.filter(b=>b!==NO_IVR && !EXCLUDE_BRANCHES.has(b));   // named branches, data order, exclusions removed
  const byPK = groupBy(rows, r=>pkey(r));         // period -> metrics (finish'd)
  const byPB = {};                                // period -> branch -> metrics
  BRANCHES.forEach(b=>byPB[b]=new Map());
  rows.forEach(r=>{ if (r.ivr===NO_IVR || EXCLUDE_BRANCHES.has(r.ivr)) return;
    const pk=pkey(r); if(!byPB[r.ivr].has(pk)) byPB[r.ivr].set(pk, blank());
    acc(byPB[r.ivr].get(pk), r); });
  Object.values(byPB).forEach(m=>m.forEach(v=>finish(v)));

  const totAll = agg(rows);
  const scopeTxt = F.chan==="ALL" ? "OHA + Non-OHA" : F.chan;

  const pLabel = pk => gran==="weekly" ? fmtWeek(pk, true) : periodLabel(pk, gran);
  const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dayLabel = iso => WD[new Date(iso+"T00:00:00").getDay()] + " " + fmtD(iso);   // "Mon Aug 10"
  // rows: newest period first; within a week, Monday at the top through Sunday at the bottom
  const wk = pk => gran==="daily" ? weekStart(pk) : (gran==="weekly" ? pk : monthStart(pk));
  const rowsSorted = pkeys.slice().sort((a,b)=>{
    const wa=wk(a), wb=wk(b);
    if (wa !== wb) return wb < wa ? -1 : 1;          // newest week/month first
    if (gran!=="daily") return 0;
    const da=new Date(a+"T00:00:00"), db=new Date(b+"T00:00:00");
    return ((da.getDay()+6)%7) - ((db.getDay()+6)%7);   // Mon..Sun inside the week
  });

  // header groups
  const gh = (txt,col,cls) => '<th class="ghead '+cls+'" colspan="'+col+'">'+txt+'</th>';
  const head = '<thead><tr>'
    + '<th class="vhead">'+ (gran==="daily"?"Date":gran==="weekly"?"Week":gran==="monthly"?"Month":"Range")
        + ' <span class="vsub">Total Inbound Calls</span></th>'
    + gh("Abandoned in IVR", BRANCHES.length*2, "gh-aband")
    + '</tr><tr>'
    + '<th class="vhead2">&nbsp;</th>'
    + BRANCHES.map(b=>'<th class="bc" colspan="2">'+esc(b)+'</th>').join("")
    + '</tr></thead>';

  // sub-header row under each branch: Answered / Abandoned
  const branchSub = '<tr class="sub2"><th></th>'
    + BRANCHES.map(()=>'<th class="sc2 ans">Answered</th><th class="sc2 aba">Abandoned</th>').join("")
    + '</tr>';

  const body = rowsSorted.map(pk=>{ const m = byPK.get(pk);
    const cells = BRANCHES.map(b=>{ const bm = byPB[b].get(pk) || blank();
      return '<td class="num ans">'+nf(bm.answered)+'</td><td class="num aba">'+nf(bm.abandoned)+'</td>'; }).join("");
    return '<tr>'
      + '<td class="day">'+(gran==="none"?"Full Range":gran==="daily"?dayLabel(pk):pLabel(pk))+'</td>'
      + cells
      + '</tr>'; }).join("");

  // Call Outcome rows (stacked below the branch grid, one row per metric)
  const outcomes = [
    ["Total Abandoned in IVR", "ivr"],
    ["Abandoned <10s / NO IVR", "noivr"],
    ["Outside Business Hrs", "ooh"],
    ["Agents Unavailable", "una"],
    ["Total Calls Received by CSR's", "recv"],
    ["Total Answered Calls", "ans"],
    ["Total Unanswered Call", "aba"],
    ["Answer Rate", "rate good"],
    ["Missed Call Rate", "rate bad"]
  ];
  const outVals = {};
  rowsSorted.forEach(pk=>{ const m = byPK.get(pk);
    outVals[pk] = [m.ivrAband, m.noIvrAband, m.ooh, m.unanswered, m.csrBase, m.answered, m.unanswered, m.answerRate, m.missRate]; });
  const outCls = o => o.includes("rate") ? "rate" : o.includes("ans") ? "ans" : o.includes("aba") ? "aba" : "ivr";
  const outRows = outcomes.map((o,i)=>{
    const vals = rowsSorted.map(pk=>{ const v = outVals[pk][i];
      return '<td class="num '+outCls(o[1])+'">'+((i>=7)?pf(v):nf(v))+'</td>'; }).join("");
    return '<tr class="outrow"><td class="day out-lbl">'+o[0]+'</td>'+vals+'</tr>';
  }).join("");

  // TOTAL of branch answered/abandoned (the branches shown)
  const tCells = BRANCHES.map(b=>{ const m = agg(rows.filter(r=>r.ivr===b));
    return '<td class="num ans tot">'+nf(m.answered)+'</td><td class="num aba tot">'+nf(m.abandoned)+'</td>'; }).join("");
  const foot = '<tr class="tot">'
    + '<td class="day">TOTAL Branch Calls</td>'
    + tCells
    + '</tr>';

  // ---- IVR Branch Outcome: separate table, per period (day/week/month) ----
  const ocHead = '<thead><tr>'
    + '<th class="vhead">'+(gran==="daily"?"Date":gran==="weekly"?"Week":gran==="monthly"?"Month":"Range")
        +' <span class="vsub">'+scopeTxt+'</span></th>'
    + outcomes.map(o=>'<th class="oc">'+o[0]+'</th>').join("")
    + '</tr></thead>';
  const ocBody = rowsSorted.map(pk=>{ const v=outVals[pk];
    const cells = outcomes.map((o,i)=>'<td class="num '+outCls(o[1])+'">'+((i>=7)?pf(v[i]):nf(v[i]))+'</td>').join("");
    return '<tr><td class="day">'+(gran==="none"?"Full Range":gran==="daily"?dayLabel(pk):pLabel(pk))+'</td>'+cells+'</tr>';
  }).join("");
  const ocTotal = [totAll.ivrAband, totAll.noIvrAband, totAll.ooh, totAll.unanswered, totAll.csrBase, totAll.answered, totAll.unanswered, totAll.answerRate, totAll.missRate];
  const ocFoot = '<tr class="tot"><td class="day">TOTAL ('+scopeTxt+')</td>'
    + outcomes.map((o,i)=>'<td class="num '+outCls(o[1])+' tot">'+((i>=7)?pf(ocTotal[i]):nf(ocTotal[i]))+'</td>').join("")
    + '</tr>';
  const ocCols = outcomes.length;
  const ocDatePct = 16, ocMetricPct = (100 - ocDatePct) / ocCols;
  const ocColgroup = '<colgroup><col style="width:'+ocDatePct+'%">'
    + outcomes.map(()=>'<col style="width:'+ocMetricPct.toFixed(3)+'%">').join("")
    + '</colgroup>';
  $("tIvrOut").innerHTML = ocColgroup + ocHead + '<tbody>' + ocBody + ocFoot + '</tbody>';
  $("ivrOutTitle").textContent = "IVR Branch Outcome";
  $("ivrOutSub").textContent = scopeTxt + " · " + (gran==="none"?"full range":pkeys.length+(gran==="daily"?" days":gran==="weekly"?" weeks":" months"));

  // column widths: first col = date/header (~7%), remaining 24 branch sub-cols share the rest
  const branchCols = BRANCHES.length * 2;
  const datePct = 7, subPct = (100 - datePct) / branchCols;
  const colgroup = '<colgroup><col style="width:'+datePct+'%">'
    + BRANCHES.map(()=>'<col style="width:'+subPct.toFixed(3)+'%"><col style="width:'+subPct.toFixed(3)+'%">').join("")
    + '</colgroup>';

  $("tIvrDay").innerHTML = colgroup + head + branchSub + '<tbody>' + body + foot + '</tbody>';
  $("ivrDayTitle").textContent = "IVR Branch by " + (gran==="daily"?"Day":gran==="weekly"?"Week":gran==="monthly"?"Month":"Range");
  $("ivrDaySub").textContent = scopeTxt + " · " + (gran==="none"?"full range":pkeys.length+(gran==="daily"?" days":gran==="weekly"?" weeks":" months"));
}


/* ---------- Agent page: weekly daily answered/missed/AHT pivot ---------- */
// agent -> team_key map, built from the status rows (the agent call cube has no team dim)
const AGENT_TEAM = (function(){ const m={};
  const sr = (D.status && D.status.rows) || [];
  sr.forEach(r => { if (r.agent && r.team_key && !(r.agent in m)) m[r.agent] = r.team_key; });
  return m; })();

function renderAgents(){
  const kmgr = $("agKpis");
  if (!kmgr || F.page !== "agent") return;
  // use the week selected in the top-of-page Week toggle (F.from is that week's Monday)
  const wk  = (F.from && F.from !== MIN_D) ? weekStart(F.from) : weekStart(MAX_D);
  const from = wk;
  const to = addD(from, 6) > MAX_D ? MAX_D : addD(from, 6);
  // week label at top of page
  const lbl = $("agWeekLabel");
  if (lbl) lbl.textContent = fmtWeek(from);

  // agents in this week's range + channel, optionally filtered by team
  const ar = AROWS.filter(r => r.d>=from && r.d<=to && (F.chan==="ALL"||r.ch===F.chan)
    && (F.agTeam==="all" || AGENT_TEAM[r.ag]===F.agTeam));

  // per agent per day: answered, missed, aht-secs (sum of seconds / answered count)
  const byAD = {};   // "agent|date" -> {d, answered, missed, sec}
  const dates = new Set();
  ar.forEach(r => {
    dates.add(r.d);
    const k = r.ag + "|" + r.d;
    const o = byAD[k] || (byAD[k] = {d:r.d, answered:0, missed:0, sec:0});
    o.sec += r.sec || 0;
    if (r.st === "answered") o.answered += r.n;
    else if (r.st === "missed") o.missed += r.n;
  });
  const dateCols = [...dates].sort();

  // aggregate per agent
  const byA = {};
  Object.keys(byAD).forEach(k => {
    const o = byAD[k], ag = k.split("|")[0];
    const a = byA[ag] || (byA[ag] = {answered:0, missed:0, sec:0, byDate:{}});
    a.answered += o.answered; a.missed += o.missed; a.sec += o.sec;
    a.byDate[o.d] = (a.byDate[o.d] || {answered:0, missed:0, sec:0});
    const b = a.byDate[o.d]; b.answered = (b.answered||0)+o.answered; b.missed=(b.missed||0)+o.missed; b.sec+=o.sec;
  });

  const rows = Object.keys(byA).map(ag => {
    const a = byA[ag];
    return {ag, team: AGENT_TEAM[ag]||"", answered:a.answered, missed:a.missed,
            aht: a.answered? a.sec/a.answered : 0, byDate:a.byDate};
  }).sort((x,y) => y.answered - x.answered || y.missed - x.missed);

  const totAns = rows.reduce((s,r)=>s+r.answered,0);
  const totMis = rows.reduce((s,r)=>s+r.missed,0);
  const totSec = rows.reduce((s,r)=>s+r.sec,0);
  const active = rows.filter(r=>r.answered>0).length;

  kmgr.innerHTML =
      kpi("Total Answered", nf(totAns), active+" active agents", "good")
    + kpi("Total Missed", nf(totMis), active? pf(totMis/(totAns+totMis))+" of agent calls":"", "bad")
    + kpi("Avg AHT", totAns? mmss(totSec/totAns) : "—", "across "+nf(totAns)+" answered calls", "alt")
    + kpi("Answered / Missed", nf(totAns)+" / "+nf(totMis), "dead rate", "");

  // columns: Agent | Team | Ans | Miss | AHT | <each date: Ans/Miss + AHT>
  const cols = [{t:"Agent",k:"ag"},{t:"Team",k:"team"}];
  const flatRows = rows.map(r => {
    const out = {ag:esc(r.ag),
                 team:'<span class="tag'+(r.team?" lav":"")+'">'+esc(r.team||"—")+'</span>',
                 ans:nf(r.answered), mis:nf(r.missed), aht:mmss(r.aht), _ans:r.answered, _mis:r.missed};
    dateCols.forEach(d => {
      const b = r.byDate[d];
      out["_"+d] = b && (b.answered||b.missed)
        ? '<div class="a-cell"><b>'+nf(b.answered)+'</b> / '+nf(b.missed)
          + (b.answered? '<span class="small"> · '+mmss(b.sec/b.answered)+'</span>':'')+'</div>'
        : "";
    });
    return out;
  });
  // header: first row agent/team/ans/mis/aht with titles
  cols.push({t:"Answered",k:"ans",n:1},{t:"Missed",k:"mis",n:1},{t:"Avg AHT",k:"aht",n:1});
  dateCols.forEach(d => cols.push({t:fmtDY(d),k:"_"+d}));

  tbl($("tAgent"), cols, flatRows.length ? flatRows :
    [{ag:'<div class="empty" style="padding:14px">No agent calls in this week/team.</div>', team:"", ans:"", mis:"", aht:""}]);

  // totals row
  const tEl = $("tAgent");
  const tr = document.createElement("tr"); tr.className="tot";
  let html = '<td><b>Total</b></td><td></td><td class="n"><b>'+nf(totAns)+'</b></td><td class="n"><b>'+nf(totMis)+'</b></td><td class="n"><b>'+mmss(totSec/(totAns||1))+'</b></td>';
  dateCols.forEach(d => {
    const t = rows.reduce((s,r)=> s + ((r.byDate[d]||{}).answered||0), 0);
    const tm = rows.reduce((s,r)=> s + ((r.byDate[d]||{}).missed||0), 0);
    html += '<td class="n"><b>'+nf(t)+'</b> / '+nf(tm)+'</td>';
  });
  html += '</tr>';
  tEl.insertAdjacentHTML("beforeend", html);
}

    /* Lightbox: daily x hourly call-count table for one IVR branch, within the
       current channel/date scope. The IVR cube has no agent dimension, so seated
       agents per branch are not available in the data. */
    function openIvrLightbox(branch){
      const scope = sliceAllIvr().filter(r => r.ivr === branch);
      const days = [...new Set(scope.map(r=>r.d))].sort();
      const hours = [...new Set(scope.map(r=>r.h))].sort((a,b)=>a-b);
      // per day x hour -> {total, answered, abandoned, missed}
      const cell = {};
      scope.forEach(r => {
        const k = r.d + "|" + r.h;
        const c = cell[k] || (cell[k] = {total:0, answered:0, abandoned:0, missed:0});
        c.total += r.n;
        c[r.st] = (c[r.st]||0) + r.n;
      });
      const totalCalls = scope.reduce((s,r)=>s+r.n,0);
            const dayTotals = days.map(d => scope.filter(r=>r.d===d).reduce((s,r)=>s+r.n,0));
            // per-hour totals, to find the busiest hour (highest total)
            const hourTotals = hours.map(h => days.reduce((s,d)=>s+((cell[d+"|"+h]||{}).total||0),0));
            const maxHourTot = Math.max(0, ...hourTotals);
            const busiestHour = maxHourTot>0 ? hours[hourTotals.indexOf(maxHourTot)] : null;

            // header: Hour | <date>... | Total
                  let head = '<tr><th>Hour</th>' + days.map(d=>'<th>'+esc(fmtDY(d))+'</th>').join("") + '<th>Total</th></tr>';
                  let body = hours.map((h,hi) => {
                    const isBusy = (h === busiestHour);
                    let row = '<tr class="'+(isBusy?'lb-busy':'')+'"><td>'+esc(hourLbl(h))+(isBusy?' <span class="lb-busy-tag">peak</span>':'')+'</td>';
                    days.forEach(d => {
                      const c = cell[d+"|"+h];
                      row += '<td class="n">'+(c?nf(c.total):"&middot;")+'</td>';
                    });
                    row += '<td class="n"><b>'+nf(hourTotals[hi])+'</b></td></tr>';
                                        return row;
                                      }).join("");
            // totals row
            let totRow = '<tr><td><b>Total</b></td>' + days.map((d,i) =>
              '<td class="n"><b>'+nf(dayTotals[i])+'</b></td>').join("") + '<td class="n"><b>'+nf(totalCalls)+'</b></td></tr>';

      const ov = document.createElement("div");
      ov.className = "lb-overlay";
      ov.innerHTML =
        '<div class="lb-box"><div class="lb-hd"><div><h3>'+esc(branch)+' &mdash; Calls by Day &amp; Hour</h3>'+
        '<div class="lb-sub">'+nf(totalCalls)+' calls &middot; '+esc(F.chan==="ALL"?"OHA + Non-OHA":F.chan)+' &middot; '+esc(fmtDY(F.from))+' &rarr; '+esc(fmtDY(F.to))+'</div></div>'+
        '<button class="lb-close" aria-label="Close">&times;</button></div>'+
        '<div class="lb-body"><div class="tscroll"><table><thead>'+head+'</thead><tbody>'+body+totRow+'</tbody></table></div>'+
        '<p style="margin:10px 0 0;color:var(--ink2);font-size:11.5px">Hourly call volume received under this IVR branch. '+
        'Seated agents per branch are not available in the source data (the IVR cube has no agent dimension).</p></div></div>';
      function close(){ ov.remove(); document.removeEventListener("keydown", onKey); }
      function onKey(e){ if(e.key === "Escape") close(); }
      ov.querySelector(".lb-close").onclick = close;
      ov.addEventListener("click", function(e){ if(e.target === ov) close(); });
      document.addEventListener("keydown", onKey);
            document.body.appendChild(ov);
          }
