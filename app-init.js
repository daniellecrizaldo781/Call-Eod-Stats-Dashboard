/* ---------- wiring + init ---------- */
function fillSelects(){
  $("fIvr").innerHTML = '<option value="ALL">All IVR Branches</option>'
    + IVRS.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
}

// Top-most WEEK / QUARTER navigator — quick weekly-data navigation.
function buildWeekNav(){
  const wk = listWeeks();
  const opts = ['<option value="ALL">All weeks</option>']
    .concat(wk.map(s => '<option value="'+s+'">'+fmtWeek(s)+(s===weekStart(MAX_D)?' (this week)':'')+'</option>'))
    .concat(['<option value="__this">This Week</option>','<option value="__last">Last Week</option>']);
  $("fWeek").innerHTML = opts.join("");
  const q = listQuarters();
  $("fQuarter").innerHTML = ['<option value="ALL">All quarters</option>']
    .concat(q.map(s => '<option value="'+s+'">'+s+'</option>')).join("");
  // default selection reflects current range: pick the week containing F.from if any
  const cur = weekStart(F.from);
  $("fWeek").value = wk.includes(cur) ? cur : "ALL";
  $("fQuarter").value = "ALL";
}

function applyPreset(){
  if (F.preset === "Custom Range"){ $("wrapFrom").classList.remove("hide"); $("wrapTo").classList.remove("hide"); return; }
  const [a,b] = presetRange(F.preset);
  F.from = a < MIN_D ? MIN_D : a;
  F.to   = b > MAX_D ? MAX_D : b;
  $("fFrom").value = F.from; $("fTo").value = F.to;
}
function renderDQ(){
  const i = D.issues || {};
  const map = {no_ivr_branch:"calls with no IVR branch (valid \u2014 tracked as \u201cNo IVR Branch / Unassigned\u201d)",
    invalid_aht:"answered calls with missing/zero duration (excluded from AHT sum, counted in volume)",
    duplicate_skipped:"duplicate call IDs skipped on import",
    missing_date:"rows dropped \u2014 no usable date", invalid_time:"rows with unparseable start time (hour = Unknown)",
    answered_without_agent:"answered calls with no agent name"};
  const parts = Object.keys(i).map(k=>"<b>"+nf(i[k])+"</b> "+(map[k]||k));
  $("dqNotice").innerHTML = "&#128203; <b>Data quality:</b> "+nf(ROWS.reduce((a,r)=>a+r.n,0))
    + " calls loaded across "+ALL_DATES.length+" days ("+fmtDY(MIN_D)+" \u2013 "+fmtDY(MAX_D)+"). "
    + (parts.length? parts.join(" &middot; ") : "No issues detected.");
}
function wire(){
  document.querySelectorAll(".topnav .navbtn").forEach(b=>b.onclick=()=>setPage(b.dataset.page));
  $("agGranPills").addEventListener("click", e=>{
    const b = e.target.closest(".pill"); if(!b) return;
    [...$("agGranPills").children].forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); F.agGran = b.dataset.v; F.agPeriod=null; render();
  });
  $("chanPills").addEventListener("click", e=>{
    const b = e.target.closest(".pill"); if(!b) return;
    [...$("chanPills").children].forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); F.chan = b.dataset.v;
    if (F.page === "break") bkFillSelects();   // rebuild brand dropdowns for the channel
    render();
  });
  $("fIvr").onchange  = e => { F.ivr = e.target.value; render(); };
  $("fPreset").onchange = e => { F.preset = e.target.value; applyPreset(); render(); };
  $("fGran").onchange = e => { F.gran = e.target.value; F.picks.clear(); buildPeriodOptions(); render(); };
  $("fFrom").onchange = e => { F.from = e.target.value; F.preset="Custom Range"; $("fPreset").value="Custom Range"; render(); };
  $("fTo").onchange   = e => { F.to   = e.target.value; F.preset="Custom Range"; $("fPreset").value="Custom Range"; render(); };
  // ---- Top-most WEEK / QUARTER navigator ----
  $("fWeek").onchange = e => {
    const v = e.target.value;
    if (v === "__this"){ const s = weekStart(MAX_D); applyWeek(s); }
    else if (v === "__last"){ const s = addD(weekStart(MAX_D), -7); applyWeek(s); }
    else { applyWeek(v); }
    buildPeriodOptions(); render();
  };
  $("fQuarter").onchange = e => { applyQuarter(e.target.value); buildPeriodOptions(); render(); };
  $("pickClear").onclick = () => { F.picks.clear(); render(); };
  $("pickLast2").onclick = () => pickRecent(2);
  $("pickLast4").onclick = () => pickRecent(4);
  $("fAgentSort").onchange = () => renderAgents();
  $("agPeriod").onchange = () => { F.agPeriod = $("agPeriod").value; render(); };
  $("cmpA").onchange = () => render();
  $("cmpB").onchange = () => render();

  // ---- Call Breakdown page wiring ----
  $("bkBrand").onchange = e => { BK.brand = e.target.value; bkRender(); };
  $("bkConcern").onchange = e => { BK.concern = e.target.value; bkRender(); };
  $("bkBranchPick").onchange = () => bkRender();
  $("bkDriversBrand").onchange = e => { BK.driversBrand = e.target.value; bkRender(); };
  $("bkReset").onclick = () => {
    BK.brand="ALL"; BK.concern="ALL"; BK.driversBrand="ALL";
    $("bkBrand").value="ALL"; $("bkConcern").value="ALL"; $("bkDriversBrand").value="ALL";
    bkRender();
  };
  // Refresh Data button: hard-reload to pull the latest synced data.js
  $("btnRefresh").onclick = () => {
    const b = $("btnRefresh"); b.disabled = true; b.textContent = "↻ Refreshing…";
    setTimeout(() => location.reload(true), 150);
  };
  $("btnReset").onclick = () => {
    F.chan="ALL"; F.ivr="ALL"; F.preset="Last Week"; F.gran="weekly"; F.picks.clear();
    F.agGran="weekly"; F.agPeriod=null;
    [...$("chanPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
    [...$("agGranPills").children].forEach((x,i)=>x.classList.toggle("on", i===1));
    $("fIvr").value="ALL"; $("fPreset").value="Last Week"; $("fGran").value="weekly";
    applyPreset(); buildPeriodOptions(); render();
  };
}
function setPage(p){
  F.page = p;
  document.querySelectorAll(".page").forEach(s => { s.hidden = (s.id !== "page"+p.charAt(0).toUpperCase()+p.slice(1)); });
  document.querySelectorAll(".topnav .navbtn").forEach(b => b.classList.toggle("on", b.dataset.page===p));
  // Call Breakdown page: default to the full date range so all ticket data shows
  // (the sheet only spans a few days, so a narrow preset like "Last Week" would hide most of it).
  if (p === "break"){ F.preset = "All Data"; applyPreset(); if ($("fPreset")) $("fPreset").value = "All Data"; }
  render();   // re-render so the now-visible page is populated
}
(function init(){
  fillSelects();
  buildWeekNav();
  $("fFrom").min=MIN_D; $("fFrom").max=MAX_D; $("fTo").min=MIN_D; $("fTo").max=MAX_D;
  applyPreset();
  buildPeriodOptions();
  wire();
  renderDQ();
  if (window.bkFillSelects) bkFillSelects();   // populate Call Breakdown dropdowns
  render();
  setPage("main");
})();
