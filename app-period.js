/* ---------- period picker (multi-select week/day/month comparison) ---------- */
function availablePeriods(gran){
  // periods that actually contain data under the current channel/ivr/line filters
  const o = Object.assign({}, F, {from:MIN_D, to:MAX_D});
  const keys = new Set();
  ROWS.forEach(r=>{ if (pass(r,o)) keys.add(periodKey(r.d, gran)); });
  return [...keys].sort();
}
function renderPeriodPicker(){
  const gran = F.gran;
  const keys = availablePeriods(gran).reverse();   // newest first
  const box = $("periodPick");
  box.innerHTML = keys.map(k=>'<button class="pchip'+(F.picks.has(k)?" on":"")+'" data-k="'+k+'">'
      + esc(periodLabel(k,gran)) + '</button>').join("");
  box.querySelectorAll(".pchip").forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if (F.picks.has(k)) F.picks.delete(k); else F.picks.add(k);
    render();
  });
  $("periodTitle").textContent = (gran==="daily"?"Daily":gran==="weekly"?"Weekly":"Monthly")+" Performance";
}
function pickRecent(n){
  const gran = F.gran, keys = availablePeriods(gran);
  F.picks = new Set(keys.slice(-n));
  render();
}

/* comparison strip shown under the period table when 2+ periods are picked */
function renderPeriodDelta(prows, gran){
  const el = $("periodDelta");
  if (prows.length < 2 || !F.picks.size){ el.innerHTML = ""; return; }
  const a = prows[0], b = prows[prows.length-1];   // oldest -> newest
  const row = (label, av, bv, fmt, invert)=>{
    const d = bv-av, f=fmt||nf;
    const same = Math.abs(d) < 0.05;
    const good = invert ? d<0 : d>0;
    const cls = same ? "flat" : good ? "up" : "down";
    const arrow = same ? "\u2014" : (d>0 ? "\u25B2 +" : "\u25BC \u2212");
    const pct = (!same && av) ? " ("+(Math.abs(d/av*100)).toFixed(1)+"%)" : "";
    return '<tr><td>'+label+'</td><td class="n">'+f(av)+'</td><td class="n">'+f(bv)
      + '</td><td class="n"><span class="delta '+cls+'">'+arrow+(same?"":f(Math.abs(d))+pct)+'</span></td></tr>';
  };
  const pp = x => x.toFixed(1)+"pp";
  el.innerHTML =
    '<div class="cmpnote"><b>Comparing first vs last selected period.</b> '
    + esc(periodLabel(a.k,gran))+'  \u2192  '+esc(periodLabel(b.k,gran))
    + (prows.length>2 ? '  \u00b7 '+(prows.length-2)+' period(s) in between shown in the table above.' : '')
    + '</div>'
    + '<table style="margin-top:12px"><thead><tr><th>Metric</th><th class="n">'
    + esc(periodLabel(a.k,gran))+'</th><th class="n">'+esc(periodLabel(b.k,gran))
    + '</th><th class="n">Change</th></tr></thead><tbody>'
    + row("Total Calls", a.m.total, b.m.total, nf)
    + row("Answered", a.m.answered, b.m.answered, nf)
    + row("Missed", a.m.missed, b.m.missed, nf, true)
    + row("Abandoned", a.m.abandoned, b.m.abandoned, nf, true)
    + row("Out of Business Hours", a.m.ooh, b.m.ooh, nf, true)
    + row("Answer Rate", a.m.answerRate, b.m.answerRate, pp)
    + row("Missed Rate", a.m.missRate, b.m.missRate, pp, true)
    + row("Abandon Rate", a.m.abandRate, b.m.abandRate, pp, true)
    + row("AHT", a.m.aht, b.m.aht, mmss, true)
    + row("No-IVR Abandoned", a.m.noIvrAband, b.m.noIvrAband, nf, true)
    + '</tbody></table>';
}
