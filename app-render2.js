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
      kpi("Abandoned &mdash; No IVR Branch", nf(M.noIvrAband), pf(M.noIvrPct)+" of total abandoned", "bad")
    + kpi("No-IVR Total Calls", nf(noIvr?noIvr.total:0), noIvr? pf(noIvr.abandRate)+" abandon rate":"none in range", "alt")
    + kpi("Active IVR Branches", nf(list.filter(x=>x[0]!==NO_IVR).length), "in current filter")
    + kpi("Most Abandoned Branch", topCnt?esc(topCnt[0]):"\u2014", topCnt? nf(topCnt[1].abandoned)+" abandoned calls":"", "bad")
    + kpi("Highest Abandon Rate", topRate?esc(topRate[0]):"\u2014",
          topRate? pf(topRate[1].abandRate)+" of "+nf(topRate[1].total)+" calls":"min 25 calls", "warn")
    + kpi("Busiest Branch", list.length?esc(list[0][0]):"\u2014", list.length? nf(list[0][1].total)+" calls":"", "alt");

  groupedHBars("chIvrBar", list.slice(0,12).map(([k,m])=>({label:k,
    vals:{answered:m.answered, abandoned:m.abandoned, missed:m.missed}})), ["answered","abandoned","missed"]);

  const ab = list.filter(x=>x[1].abandoned>0).sort((a,b)=>b[1].abandoned-a[1].abandoned).slice(0,12);
  hBars("chIvrAband", ab.map(([k,m])=>({label:k, value:m.abandoned,
    color: k===NO_IVR? "#D9455F":"#B99BDD", note:pf(m.abandRate)+" abandon rate \u00b7 "+nf(m.total)+" total"})), {unit:"abandoned"});

  const imax = Math.max(1,...list.map(x=>x[1].total));
  tbl($("tIvr"),
    [{t:"IVR Branch",k:"b"},{t:"Total Calls",k:"t",n:1},{t:"Answered",k:"a",n:1},{t:"Missed",k:"m",n:1},
     {t:"Abandoned",k:"ab",n:1},{t:"OOH",k:"o",n:1},{t:"Answer Rate",k:"ar",n:1},{t:"Abandon Rate",k:"abr",n:1},{t:"AHT",k:"aht",n:1}],
    list.map(([k,m])=>({_click:k, _cls: k===NO_IVR?"tot":"",
      b:(k===NO_IVR? '<span class="tag" style="background:#FBD9E1;color:#B32B47">'+esc(k)+'</span>' : esc(k)),
      t:barCell(m.total,imax), a:nf(m.answered), m:nf(m.missed), ab:nf(m.abandoned), o:nf(m.ooh),
      ar:pf(m.answerRate), abr:pf(m.abandRate), aht:mmss(m.aht)}))
      .concat([{_cls:"tot", b:"TOTAL", t:nf(M.total), a:nf(M.answered), m:nf(M.missed), ab:nf(M.abandoned),
                o:nf(M.ooh), ar:pf(M.answerRate), abr:pf(M.abandRate), aht:mmss(M.aht)}]));
  $("tIvr").querySelectorAll("[data-click]").forEach(tr=>tr.onclick=()=>{
    $("fIvr").value = tr.getAttribute("data-click"); F.ivr = $("fIvr").value; render(); });

  /* IVR x channel */
  const cross = groupBy(rows, r=>r.ch+SEP+r.ivr);
  const rowsX = [...cross.entries()].map(([k,m])=>{ const p=k.split(SEP);
    return {ch:p[0], ivr:p[1], m:m}; }).sort((a,b)=> a.ch===b.ch ? b.m.total-a.m.total : a.ch.localeCompare(b.ch));
  tbl($("tIvrChan"),
    [{t:"Channel",k:"c"},{t:"IVR Branch",k:"b"},{t:"Total",k:"t",n:1},{t:"Answered",k:"a",n:1},
     {t:"Abandoned",k:"ab",n:1},{t:"Answer Rate",k:"ar",n:1},{t:"Abandon Rate",k:"abr",n:1}],
    rowsX.map(r=>({c:'<span class="tag'+(r.ch==="OHA"?"":" lav")+'">'+esc(r.ch)+'</span>', b:esc(r.ivr),
      t:nf(r.m.total), a:nf(r.m.answered), ab:nf(r.m.abandoned), ar:pf(r.m.answerRate), abr:pf(r.m.abandRate)})));

  /* IVR by period */
  const pf2 = r => periodKey(r.d, gran);
  const byPI = groupBy(rows, r=>pf2(r)+SEP+r.ivr);
  const rowsP = [...byPI.entries()].map(([k,m])=>{ const p=k.split(SEP); return {p:p[0], ivr:p[1], m:m}; })
    .sort((a,b)=> a.p===b.p ? b.m.total-a.m.total : b.p.localeCompare(a.p));
  $("ivrPeriodTitle").textContent = "IVR Branch by "+(gran==="daily"?"Day":gran==="weekly"?"Week":"Month");
  tbl($("tIvrDaily"),
    [{t:gran==="daily"?"Date":gran==="weekly"?"Week":"Month",k:"d"},{t:"IVR Branch",k:"b"},
     {t:"Answered",k:"a",n:1},{t:"Abandoned",k:"ab",n:1},{t:"Total",k:"t",n:1},{t:"Abandon Rate",k:"abr",n:1}],
    rowsP.slice(0,400).map(r=>({d:periodLabel(r.p,gran), b:esc(r.ivr), a:nf(r.m.answered),
      ab:nf(r.m.abandoned), t:nf(r.m.total), abr:pf(r.m.abandRate)})));
}

/* ---------- Agents ---------- */
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

  const tot = list.reduce((a,r)=>({n:a.n+r.answered, s:a.s+r.sec, on:a.on+r.oha.n, os:a.os+r.oha.s,
    nn:a.nn+r.non.n, ns:a.ns+r.non.s}), {n:0,s:0,on:0,os:0,nn:0,ns:0});
  tbl($("tAht"),
    [{t:"Agent",k:"a"},{t:"OHA Calls",k:"oc",n:1},{t:"OHA AHT",k:"oa",n:1},{t:"Non-OHA Calls",k:"nc",n:1},
     {t:"Non-OHA AHT",k:"na",n:1},{t:"Overall Calls",k:"tc",n:1},{t:"Overall AHT",k:"ta",n:1}],
    list.slice().sort((a,b)=>b.answered-a.answered).map(r=>({a:esc(r.ag),
      oc:nf(r.oha.n), oa:r.oha.n?mmss(r.oha.s/r.oha.n):"\u2014", nc:nf(r.non.n),
      na:r.non.n?mmss(r.non.s/r.non.n):"\u2014", tc:nf(r.answered), ta:mmss(r.aht)}))
      .concat([{_cls:"tot", a:"TEAM", oc:nf(tot.on), oa:tot.on?mmss(tot.os/tot.on):"\u2014", nc:nf(tot.nn),
        na:tot.nn?mmss(tot.ns/tot.nn):"\u2014", tc:nf(tot.n), ta:tot.n?mmss(tot.s/tot.n):"\u2014"}]));
}
