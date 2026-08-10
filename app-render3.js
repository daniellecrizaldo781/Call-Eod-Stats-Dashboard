/* ---------- comparisons ---------- */
function buildPeriodOptions(){
  const gran = "weekly";   // Period-over-Period comparison is always weekly (whole weeks)
  const keys = [...new Set(ROWS.map(r=>periodKey(r.d, gran)))].sort().reverse();
  const opts = keys.map(k=>'<option value="'+k+'">'+periodLabel(k,gran)+'</option>').join("");
  const a=$("cmpA"), b=$("cmpB"), pa=a.value, pb=b.value;
  a.innerHTML=opts; b.innerHTML=opts;
  a.value = keys.includes(pa)?pa : (keys[1]||keys[0]);   // previous period
  b.value = keys.includes(pb)?pb : keys[0];              // latest period
}
function periodBounds(k, gran){
  if (gran==="weekly") return [k, addD(k,6)];
  if (gran==="monthly"){ const d=dt(k); d.setMonth(d.getMonth()+1); return [k, addD(iso(d),-1)]; }
  return [k,k];
}
function renderCompare(rows, M){
  /* period over period — always compares whole weeks, regardless of the View toggle */
  const gran = "weekly";
  const ka=$("cmpA").value, kb=$("cmpB").value;
  if (!ka||!kb) return;
  const [a0,a1]=periodBounds(ka,gran), [b0,b1]=periodBounds(kb,gran);
  const A = agg(slice(Object.assign({},F,{from:a0,to:a1})));
  const B = agg(slice(Object.assign({},F,{from:b0,to:b1})));
  const chg = (a,b,inv,f)=>{ const d=b-a; const g=f||nf;
    if(Math.abs(d)<0.05) return '<span class="delta flat">&mdash;</span>';
    const good = inv? d<0 : d>0;
    return '<span class="delta '+(good?"up":"down")+'">'+(d>0?"\u25B2 +":"\u25BC \u2212")+g(Math.abs(d))+'</span>'; };
  const R=(l,av,bv,fmt,inv)=>({m:l, a:fmt(av), b:fmt(bv), c:chg(av,bv,inv,fmt===pf?(x=>x.toFixed(1)+"pp"):fmt)});
  tbl($("tWow"),
    [{t:"Metric",k:"m"},{t:periodLabel(ka,gran),k:"a",n:1},{t:periodLabel(kb,gran),k:"b",n:1},{t:"Change",k:"c",n:1}],
    [R("Total Calls",A.total,B.total,nf), R("Answered",A.answered,B.answered,nf),
     R("Missed",A.missed,B.missed,nf,true), R("Abandoned",A.abandoned,B.abandoned,nf,true),
     R("OOH",A.ooh,B.ooh,nf,true), R("Answer Rate",A.answerRate,B.answerRate,pf),
     R("Missed Rate",A.missRate,B.missRate,pf,true), R("Abandon Rate",A.abandRate,B.abandRate,pf,true),
     R("AHT",A.aht,B.aht,mmss,true), R("No-IVR Abandoned",A.noIvrAband,B.noIvrAband,nf,true)]);

  /* IVR week over week */
  $("wowIvrSub").textContent = periodLabel(ka,gran)+"  vs  "+periodLabel(kb,gran);
  const gA = groupBy(slice(Object.assign({},F,{from:a0,to:a1})), r=>r.ivr);
  const gB = groupBy(slice(Object.assign({},F,{from:b0,to:b1})), r=>r.ivr);
  const keys=[...new Set([...gA.keys(),...gB.keys()])];
  const z=blank(); finish(z);
  const rws = keys.map(k=>({k, a:gA.get(k)||z, b:gB.get(k)||z}))
    .sort((x,y)=>(y.a.total+y.b.total)-(x.a.total+x.b.total));
  tbl($("tWowIvr"),
    [{t:"IVR Branch",k:"b"},{t:"Total A",k:"ta",n:1},{t:"Total B",k:"tb",n:1},
     {t:"Abandoned A",k:"aa",n:1},{t:"Abandoned B",k:"ab",n:1},{t:"Aband. Change",k:"ac",n:1},
     {t:"Answer Rate A",k:"ra",n:1},{t:"Answer Rate B",k:"rb",n:1},{t:"Rate Change",k:"rc",n:1}],
    rws.map(r=>({b:(r.k===NO_IVR?'<span class="tag" style="background:#FBD9E1;color:#B32B47">'+esc(r.k)+'</span>':esc(r.k)),
      ta:nf(r.a.total), tb:nf(r.b.total), aa:nf(r.a.abandoned), ab:nf(r.b.abandoned),
      ac:chg(r.a.abandoned,r.b.abandoned,true,nf),
      ra:pf(r.a.answerRate), rb:pf(r.b.answerRate),
      rc:chg(r.a.answerRate,r.b.answerRate,false,x=>x.toFixed(1)+"pp")})));
}

/* ---------- executive summary ---------- */
function renderSummary(M, peakHour, gran){
  const rows = slice();
  const scope = F.chan==="ALL" ? "All Channels (OHA + Non-OHA)" : F.chan;
  if (!M.total){ $("execSummary").innerHTML = "<b>No calls</b> match the current filters ("+scope+", "
      +fmtDY(F.from)+" \u2013 "+fmtDY(F.to)+"). Widen the date range or reset the filters."; return; }
  const byI = groupBy(rows, r=>r.ivr);
  let bestAns=null, worstRate=null, mostAband=null;
  byI.forEach((m,k)=>{
    if(!bestAns||m.answered>byI.get(bestAns).answered) bestAns=k;
    if(!mostAband||m.abandoned>byI.get(mostAband).abandoned) mostAband=k;
    if(m.total>=25 && (!worstRate||m.abandRate>byI.get(worstRate).abandRate)) worstRate=k;
  });
  const agents = new Set(sliceAgents().filter(r=>r.st==="answered").map(r=>r.ag)).size;
  const verdict = M.answerRate>=75 ? "on target" : M.answerRate>=60 ? "below target &mdash; needs attention" : "critically low";
  $("execSummary").innerHTML =
    "<b>"+esc(scope)+" &mdash; "+fmtDY(F.from)+" to "+fmtDY(F.to)+"</b><br>"
    + "<b>"+nf(M.total)+"</b> inbound calls were received: <b>"+nf(M.answered)+"</b> answered, <b>"+nf(M.missed)
    + "</b> missed, <b>"+nf(M.abandoned)+"</b> abandoned and <b>"+nf(M.ooh)+"</b> outside business hours. "
    + "The answer rate was <b>"+pf(M.answerRate)+"</b> ("+verdict+"), missed rate <b>"+pf(M.missRate)
    + "</b> and abandonment rate <b>"+pf(M.abandRate)+"</b>. Average handle time was <b>"+mmss(M.aht)+"</b> across "
    + nf(agents)+" agents handling calls. "
    + (peakHour!==null && peakHour!==undefined ? "Highest call volume occurred at <b>"+hourLbl(peakHour)+"</b>. " : "")
    + (bestAns ? "IVR branch <b>"+esc(bestAns)+"</b> recorded the most answered calls ("+nf(byI.get(bestAns).answered)+"), " : "")
    + (mostAband ? "<b>"+esc(mostAband)+"</b> had the most abandoned calls ("+nf(byI.get(mostAband).abandoned)+")" : "")
    + (worstRate ? " and <b>"+esc(worstRate)+"</b> the highest abandonment rate ("+pf(byI.get(worstRate).abandRate)+")" : "")
    + ". <b>"+nf(M.noIvrAband)+"</b> abandoned calls had <b>no IVR branch selected</b> \u2014 that is <b>"
    + pf(M.noIvrPct)+"</b> of all abandoned calls in this period.";
}
