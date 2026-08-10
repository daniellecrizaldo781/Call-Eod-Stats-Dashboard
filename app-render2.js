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

  const ab = list.filter(x=>x[1].abandoned>0).sort((a,b)=>b[1].abandoned-a[1].abandoned).slice(0,12);
  hBars("chIvrAband", ab.map(([k,m])=>({label:k, value:m.abandoned,
    color: k===NO_IVR? "#D9455F":"#B99BDD", note:pf(m.abandRate)+" abandon rate \u00b7 "+nf(m.total)+" total"})), {unit:"abandoned"});

  /* IVR Branch by Day/Week/Month — spreadsheet-style pivot, respects channel filter */
  const pkey = r => periodKey(r.d, gran);
  const pkeys = [...new Set(rows.map(pkey))].sort();
  const BRANCHES = IVRS.filter(b=>b!==NO_IVR);   // named branches only, in data order
  const byPK = groupBy(rows, r=>pkey(r));         // period -> metrics (finish'd)
  const byPB = {};                                // period -> branch -> metrics
  BRANCHES.forEach(b=>byPB[b]=new Map());
  rows.forEach(r=>{ if (r.ivr===NO_IVR) return;
    const pk=pkey(r); if(!byPB[r.ivr].has(pk)) byPB[r.ivr].set(pk, blank());
    acc(byPB[r.ivr].get(pk), r); });
  Object.values(byPB).forEach(m=>m.forEach(v=>finish(v)));

  const totAll = agg(rows);
  const pLabel = pk => periodLabel(pk, gran);
  const pSort  = pk => pk;                        // ISO sorts correctly for day/week; month too
  const rowsSorted = pkeys.slice().sort((a,b)=>pSort(a)<pSort(b)?1:-1);   // newest first

  // header groups
  const gh = (txt,col,cls) => '<th class="ghead '+cls+'" colspan="'+col+'">'+txt+'</th>';
  const head = '<thead><tr>'
    + '<th class="vhead">'+ (gran==="daily"?"Date":gran==="weekly"?"Week":gran==="monthly"?"Month":"Range")
        + ' <span class="vsub">Total Inbound Calls</span></th>'
    + gh("Abandoned in IVR", BRANCHES.length*2, "gh-aband")
    + gh("Call Outcome", 9, "gh-out")
    + '</tr><tr>'
    + '<th class="vhead2">&nbsp;</th>'
    + BRANCHES.map(b=>'<th class="bc" colspan="2">'+esc(b)+'</th>').join("")
    + '<th class="sc">Total Abandoned in IVR</th>'
    + '<th class="sc">Abandoned &lt;10s<br>NO IVR</th>'
    + '<th class="sc">Outside Business Hrs</th>'
    + '<th class="sc">Agents Unavailable</th>'
    + '<th class="sc">Total Calls Received by CSR\'s</th>'
    + '<th class="sc">Total Answered Calls</th>'
    + '<th class="sc">Total Unanswered Call</th>'
    + '<th class="sc">Answer Rate</th>'
    + '<th class="sc">Missed Call Rate</th>'
    + '</tr></thead>';

  // sub-header row under each branch: Answered / Abandoned
  const branchSub = '<tr class="sub2"><th></th>'
    + BRANCHES.map(()=>'<th class="sc2 ans">Answered</th><th class="sc2 aba">Abandoned</th>').join("")
    + '<th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th></tr>';

  const body = rowsSorted.map(pk=>{ const m = byPK.get(pk);
    const cells = BRANCHES.map(b=>{ const bm = byPB[b].get(pk) || blank();
      return '<td class="num ans">'+nf(bm.answered)+'</td><td class="num aba">'+nf(bm.abandoned)+'</td>'; }).join("");
    return '<tr>'
      + '<td class="day">'+(gran==="none"?"Full Range":pLabel(pk))+'</td>'
      + cells
      + '<td class="num">'+nf(m.ivrAband)+'</td>'
      + '<td class="num">'+nf(m.noIvrAband)+'</td>'
      + '<td class="num">'+nf(m.ooh)+'</td>'
      + '<td class="num">'+nf(m.unanswered)+'</td>'
      + '<td class="num">'+nf(m.agentReceived)+'</td>'
      + '<td class="num ans">'+nf(m.answered)+'</td>'
      + '<td class="num aba">'+nf(m.unanswered)+'</td>'
      + '<td class="rate">'+pf(m.answerRate)+'</td>'
      + '<td class="rate">'+pf(m.missRate)+'</td>'
      + '</tr>'; }).join("");

  const tCells = BRANCHES.map(b=>{ const m = agg(rows.filter(r=>r.ivr===b));
    return '<td class="num ans tot">'+nf(m.answered)+'</td><td class="num aba tot">'+nf(m.abandoned)+'</td>'; }).join("");
  const foot = '<tr class="tot">'
    + '<td class="day">TOTAL</td>'
    + tCells
    + '<td class="num tot">'+nf(totAll.ivrAband)+'</td>'
    + '<td class="num tot">'+nf(totAll.noIvrAband)+'</td>'
    + '<td class="num tot">'+nf(totAll.ooh)+'</td>'
    + '<td class="num tot">'+nf(totAll.unanswered)+'</td>'
    + '<td class="num tot">'+nf(totAll.agentReceived)+'</td>'
    + '<td class="num ans tot">'+nf(totAll.answered)+'</td>'
    + '<td class="num aba tot">'+nf(totAll.unanswered)+'</td>'
    + '<td class="rate tot">'+pf(totAll.answerRate)+'</td>'
    + '<td class="rate tot">'+pf(totAll.missRate)+'</td>'
    + '</tr>';

  $("tIvrDay").innerHTML = head + branchSub + '<tbody>' + body + foot + '</tbody>';
  $("ivrDayTitle").textContent = "IVR Branch by " + (gran==="daily"?"Day":gran==="weekly"?"Week":gran==="monthly"?"Month":"Range");
  const scopeTxt = F.chan==="ALL" ? "OHA + Non-OHA" : F.chan;
  $("ivrDaySub").textContent = scopeTxt + " · " + (gran==="none"?"full range":pkeys.length+(gran==="daily"?" days":gran==="weekly"?" weeks":" months"));
}

/* ---------- Agents (shared) ---------- */
function agentRowsInScope(){
  // channel + date range only — agents carry no IVR/line dimension
  return AROWS.filter(r => r.d>=F.from && r.d<=F.to && (F.chan==="ALL"||r.ch===F.chan));
}

/* ---------- Agent page: dynamic Daily / Weekly / Monthly insights ---------- */
function renderAgentInsights(){
  const g = F.agGran;
  const scope = agentRowsInScope();
  const keys = [...new Set(scope.map(r=>periodKey(r.d, g)))].sort();
  if (!keys.length){
    $("agPeriod").innerHTML = '<option value="">No data</option>';
    $("agKpis").innerHTML = kpi("No Data", "\u2014", "no agent calls in the current filters", "warn");
    $("chAgentCalls").innerHTML = '<div class="empty">No agent data for the current filters.</div>';
    $("agRank").innerHTML = '<div class="empty">No agent data for the current filters.</div>';
    return;
  }
  if (!F.agPeriod || !keys.includes(F.agPeriod)) F.agPeriod = keys[keys.length-1];  // latest
  const sel = $("agPeriod");
  sel.innerHTML = keys.map(k=>'<option value="'+k+'">'+esc(periodLabel(k,g))+'</option>').join("");
  sel.value = F.agPeriod;

  const [a,b] = periodBounds(F.agPeriod, g);
  const rows = scope.filter(r=>r.d>=a && r.d<=b);
  const byA = new Map();
  rows.forEach(r=>{ if(!byA.has(r.ag)) byA.set(r.ag,{calls:0,total:0}); const o=byA.get(r.ag);
    o.total+=r.n; if(r.st==="answered") o.calls+=r.n; });
  const list = [...byA.entries()].map(([k,o])=>({ag:k, ...o})).sort((x,y)=>y.calls-x.calls);
  const totalCalls = list.reduce((s,x)=>s+x.calls,0);
  const active = list.filter(x=>x.calls>0).length;
  const busiest = list[0];
  const label = g==="daily"?"Day":g==="weekly"?"Week":"Month";

  $("agChartTitle").textContent = "Calls Handled by Agent \u2014 "+(g==="daily"?"Daily":g==="weekly"?"Weekly":"Monthly");
  hBars("chAgentCalls", list.map(x=>({label:x.ag, value:x.calls,
    note: nf(x.calls)+" calls handled"+(x.total!==x.calls? " of "+nf(x.total)+" total":"")})),
    {unit:"calls", labelW:150, color:"#E8578E"});

  $("agKpis").innerHTML =
      kpi("Total Calls Handled", nf(totalCalls), periodLabel(F.agPeriod,g), "good")
    + kpi("Active Agents", nf(active), "handling calls in period", "alt")
    + kpi("Busiest Agent", busiest?esc(busiest.ag):"\u2014", busiest? nf(busiest.calls)+" calls":"", "alt")
    + kpi("Avg per Agent", active? nf(Math.round(totalCalls/active)):"0", "calls handled, this period", "");

  const top = list.slice(0,6);
  $("agRank").innerHTML = '<div class="ranklist">' + top.map((x,i)=>{
      const w = totalCalls? x.calls/totalCalls*100 : 0;
      return '<div class="rankrow"><span class="rn">#'+(i+1)+'</span>'
        + '<span class="ra">'+esc(x.ag)+'</span>'
        + '<span class="rc">'+nf(x.calls)+'</span>'
        + '<span class="rp">'+w.toFixed(1)+'%</span></div>';
    }).join("") + '</div>'
    + '<p style="margin:12px 0 0;color:var(--ink2);font-size:11.5px">Top '+top.length+' of '+list.length
    + ' agents by calls handled for '+esc(periodLabel(F.agPeriod,g))+'. Switch the View toggle to compare '
    + 'daily, weekly or monthly performance.</p>';
}

/* ---------- Agents (table) ---------- */
function renderAgents(){
  const ar = sliceAgents();
  const byA = new Map();
  ar.forEach(r=>{
    if(!byA.has(r.ag)) byA.set(r.ag, {calls:0,answered:0,missed:0,abandoned:0,sec:0,oha:{n:0,s:0},non:{n:0,s:0}});
    const a=byA.get(r.ag); a.calls+=r.n;
    if (r.st==="answered"){ a.answered+=r.n; a.sec+=r.sec;
      const t = r.ch==="OHA"?a.oha:a.non; t.n+=r.n; t.s+=r.sec; }
    else if (r.st==="missed") a.missed+=r.n; else if (r.st==="abandoned") a.abandoned+=r.n;
  });
  let list = [...byA.entries()].map(([k,a])=>({ag:k, ...a, aht: a.answered? a.sec/a.answered : 0}));
  const s = $("fAgentSort").value;
  const cmp = {calls_desc:(a,b)=>b.answered-a.answered, calls_asc:(a,b)=>a.answered-b.answered,
    aht_asc:(a,b)=>(a.aht||1e9)-(b.aht||1e9), aht_desc:(a,b)=>b.aht-a.aht, name:(a,b)=>a.ag.localeCompare(b.ag)}[s];
  list.sort(cmp);

  // channel tag per agent
  const chOf = a => a.oha.n && a.non.n ? "Both" : a.oha.n ? "OHA" : a.non.n ? "Non-OHA" : "\u2014";
  const mx = Math.max(1,...list.map(x=>x.answered));
  tbl($("tAgent"),
    [{t:"#",k:"i",n:1},{t:"Agent",k:"a"},{t:"Branch",k:"c"},{t:"Calls Handled",k:"n",n:1},
     {t:"AHT",k:"aht",n:1},{t:"Answered",k:"an",n:1},{t:"Missed",k:"m",n:1},{t:"Talk Time",k:"tt",n:1}],
    list.map((r,i)=>({i:i+1, a:esc(r.ag), c:'<span class="tag'+(chOf(r)==="OHA"?"":" lav")+'">'+chOf(r)+'</span>',
      n:barCell(r.answered,mx), aht:mmss(r.aht), an:nf(r.answered), m:nf(r.missed), tt:mmss(r.sec)})));
}
