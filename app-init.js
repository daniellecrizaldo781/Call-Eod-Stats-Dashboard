/* ---------- wiring + init ---------- */
// Top-most period quick-navigators: WEEK + MONTH (mutually exclusive). Both set F.from/F.to.
function buildPeriodNav(){
  const wk = listWeeks();
  $("fWeek").innerHTML = ['<option value="ALL">All weeks</option>']
    .concat(wk.map(s => '<option value="'+s+'">'+fmtWeek(s)+'</option>')).join("");
  $("fWeek").value = "ALL";
  const mo = listMonths();
  $("fMonth").innerHTML = ['<option value="ALL">All months</option>']
    .concat(mo.map(s => '<option value="'+s+'">'+fmtMonth(s)+'</option>')).join("");
  $("fMonth").value = "ALL";
  // weekly scope for the daily breakdown chart under "Volume & Mix"
  const dw = listWeeks();
  $("fDayWeek").innerHTML = ['<option value="ALL">All weeks (whole range)</option>']
    .concat(dw.map(s => '<option value="'+s+'">'+fmtWeek(s)+'</option>')).join("");
  $("fDayWeek").value = "ALL";
  // monthly scope for the daily breakdown chart
  const dm = listMonths();
  $("fDayMonth").innerHTML = ['<option value="ALL">All months (whole range)</option>']
    .concat(dm.map(s => '<option value="'+s+'">'+fmtMonth(s)+'</option>')).join("");
  $("fDayMonth").value = "ALL";
}
function deselectPeriod(id){
  // when one period navigator is used, reset the other to "All" so they don't fight
  const other = id === "fWeek" ? "fMonth" : "fWeek";
  const el = $(other); if (el && el.value !== "ALL"){ el.value = "ALL"; }
}
function applyGran(gran){
  // gran = "none" -> chart shows the whole range as one block; "daily" -> one bar per day
  F.gran = gran;
  const daily = (gran === "daily");
  $("fFrom").disabled = !daily; $("fTo").disabled = !daily;
  ["wrapFrom","wrapTo"].forEach(id => $(id).classList.toggle("off", !daily));
  F.picks.clear(); buildPeriodOptions(); render();
}
function renderDQ(){
  const i = D.issues || {};
  const map = {no_ivr_branch:"calls with no IVR branch (valid — tracked as “No IVR Branch / Unassigned”)",
    invalid_aht:"answered calls with missing/zero duration (excluded from AHT sum, counted in volume)",
    duplicate_skipped:"duplicate call IDs skipped on import",
    missing_date:"rows dropped — no usable date", invalid_time:"rows with unparseable start time (hour = Unknown)",
    answered_without_agent:"answered calls with no agent name"};
  const parts = Object.keys(i).map(k=>"<b>"+nf(i[k])+"</b> "+(map[k]||k));
  $("dqNotice").innerHTML = "&#128203; <b>Data quality:</b> "+nf(ROWS.reduce((a,r)=>a+r.n,0))
    + " calls loaded across "+ALL_DATES.length+" days ("+fmtDY(MIN_D)+" – "+fmtDY(MAX_D)+"). "
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
  $("granPills").addEventListener("click", e=>{
    const b = e.target.closest(".pill"); if(!b) return;
    [...$("granPills").children].forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); applyGran(b.dataset.v);
  });
  $("fFrom").onchange = e => { if (!$("fFrom").disabled){ F.from = e.target.value; F.picks.clear(); render(); } };
  $("fTo").onchange   = e => { if (!$("fTo").disabled){ F.to   = e.target.value; F.picks.clear(); render(); } };
  // ---- period quick-navigators (WEEK + MONTH, mutually exclusive) ----
  function syncDayScope(){ // mirror the global Week toggle into the daily-chart Week selector
    const wv = $("fWeek").value;
    if ($("fDayWeek").value !== wv) $("fDayWeek").value = wv;
    if (wv === "ALL" && $("fDayMonth").value !== "ALL") {} // leave month as-is
  }
  function clearDayScope(){ // reset the daily-chart period selectors
    $("fDayWeek").value = "ALL"; $("fDayMonth").value = "ALL"; F.dayScope = "ALL";
  }
  $("fWeek").onchange = e => {
    deselectPeriod("fWeek");
    const v = e.target.value;
    if (v === "ALL"){ F.from=MIN_D; F.to=MAX_D; } else applyWeek(v);
    F.dayScope = v; syncDayScope();
    render();
  };
  $("fMonth").onchange = e => {
    deselectPeriod("fMonth");
    const v = e.target.value;
    if (v === "ALL"){ F.from=MIN_D; F.to=MAX_D; } else applyMonth(v);
    render();
  };
  $("fDayWeek").onchange = e => {
    const v = e.target.value;
    if (v !== "ALL"){ // scope the daily breakdown to this week, force Daily view
      F.dayScope = v; $("fDayMonth").value = "ALL";
      F.from = v; F.to = addD(v,6) > MAX_D ? MAX_D : addD(v,6);
      if (F.gran !== "daily"){ F.gran = "daily";
        [...$("granPills").children].forEach(x=>x.classList.toggle("on", x.dataset.v==="daily"));
      }
    } else { F.dayScope = "ALL"; }
    render();
  };
  $("fDayMonth").onchange = e => {
    const v = e.target.value;
    if (v !== "ALL"){ // scope the daily breakdown to this month, force Daily view
      F.dayScope = v; $("fDayWeek").value = "ALL";
      F.from = v; F.to = monthEnd(v) > MAX_D ? MAX_D : monthEnd(v);
      if (F.gran !== "daily"){ F.gran = "daily";
        [...$("granPills").children].forEach(x=>x.classList.toggle("on", x.dataset.v==="daily"));
      }
    } else { F.dayScope = "ALL"; }
    render();
  };
  $("fAgentSort").onchange = () => renderAgents();
  $("agPeriod").onchange = () => { F.agPeriod = $("agPeriod").value; render(); };
  $("cmpA").onchange = () => render();
  $("cmpB").onchange = () => render();

  // ---- Call Breakdown page wiring ----
  // Brand multi-selects are checkbox lists with a "Select All" button — handle via delegation.
  function bkPickerHandler(e){
    const t = e.target;
    // toggle the dropdown open/closed when clicking the trigger pill
    if (t.classList.contains("bk-trigger")){
      const menu = t.parentNode.querySelector(".bk-menu");
      menu.classList.toggle("open");
      return;
    }
    if (t.classList.contains("bk-selall")){             // "Select All" inside the menu
      const id = t.dataset.set;
      const set = (id === "bkBrand") ? BK.brand : BK.driversBrand;
      const brands = bkBrandList();
      if (set.size === 0) brands.forEach(b => set.add(b));   // currently ALL -> select every brand
      else set.clear();                                   // otherwise -> clear to ALL
      bkFillSelects(); bkRender(); return;
    }
    if (t.matches && t.matches('input[type=checkbox]')){
      const id = t.dataset.set;
      const set = (id === "bkBrand") ? BK.brand : BK.driversBrand;
      if (t.checked) set.add(t.value); else set.delete(t.value);
      const trig = $(id + "Trig"); if (trig) trig.textContent = bkSelLabel(set, bkBrandList());
      bkRender(); return;
    }
  }
  $("bkBrand").addEventListener("click", bkPickerHandler);
  $("bkDriversBrand").addEventListener("click", bkPickerHandler);
  $("bkConcern").onchange = e => { BK.concern = e.target.value; bkRender(); };
  $("bkBranchPick").onchange = () => bkRender();
  $("bkReset").onclick = () => {
    BK.brand.clear(); BK.concern="ALL"; BK.driversBrand.clear();
    if ($("bkConcern")) $("bkConcern").value="ALL";
    bkFillSelects(); bkRender();
  };
  // Refresh Data button: hard-reload to pull the latest synced data.js
  $("btnRefresh").onclick = () => {
    const b = $("btnRefresh"); b.disabled = true; b.textContent = "↻ Refreshing…";
    setTimeout(() => location.reload(true), 150);
  };
  $("btnReset").onclick = () => {
    F.chan="ALL"; F.gran="daily"; F.picks.clear();
    F.agGran="weekly"; F.agPeriod=null;
    [...$("chanPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
    [...$("agGranPills").children].forEach((x,i)=>x.classList.toggle("on", i===1));
    [...$("granPills").children].forEach(x=>x.classList.toggle("on", x.dataset.v==="daily"));
    $("fWeek").value="ALL"; $("fMonth").value="ALL"; clearDayScope();
    applyGran("daily"); buildPeriodOptions(); render();
  };
}
function setPage(p){
  F.page = p;
  document.querySelectorAll(".page").forEach(s => { s.hidden = (s.id !== "page"+p.charAt(0).toUpperCase()+p.slice(1)); });
  document.querySelectorAll(".topnav .navbtn").forEach(b => b.classList.toggle("on", b.dataset.page===p));
  // Call Breakdown page: keep the full date range so all ticket data shows; View = None suits it.
  if (p === "break"){ F.gran = "none"; [...$("granPills").children].forEach(x=>x.classList.toggle("on", x.dataset.v==="none")); applyGran("none"); }
  render();   // re-render so the now-visible page is populated
}
(function init(){
  buildPeriodNav();
  $("fFrom").min=MIN_D; $("fFrom").max=MAX_D; $("fTo").min=MIN_D; $("fTo").max=MAX_D;
  applyGran("daily");
  buildPeriodOptions();
  wire();
  renderDQ();
  if (window.bkFillSelects) bkFillSelects();   // populate Call Breakdown dropdowns
  render();
  setPage("main");
})();
