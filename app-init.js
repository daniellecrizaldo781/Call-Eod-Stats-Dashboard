/* ---------- wiring + init ---------- */
function fillSelects(){
  $("fIvr").innerHTML = '<option value="ALL">All IVR Branches</option>'
    + IVRS.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
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

  const rowsDQ = Object.keys(i).map(k=>({c:map[k]||k, n:nf(i[k]),
    s: k==="no_ivr_branch" ? '<span class="tag">Valid category</span>'
      : k==="duplicate_skipped" ? '<span class="tag lav">Prevented</span>'
      : '<span class="tag" style="background:#FBD9E1;color:#B32B47">Review</span>'}));
  tbl($("dqTable"), [{t:"Validation check",k:"c"},{t:"Records",k:"n",n:1},{t:"Status",k:"s"}], rowsDQ);
  const t=document.createElement("table"); // dqTable is a div -> wrap
  if ($("dqTable").tagName==="DIV"){ const inner=$("dqTable").innerHTML; $("dqTable").innerHTML="<table>"+inner+"</table>"; }
}
function wire(){
  $("chanPills").addEventListener("click", e=>{
    const b = e.target.closest(".pill"); if(!b) return;
    [...$("chanPills").children].forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); F.chan = b.dataset.v; render();
  });
  $("fIvr").onchange  = e => { F.ivr = e.target.value; render(); };
  $("fPreset").onchange = e => { F.preset = e.target.value; applyPreset(); render(); };
  $("fGran").onchange = e => { F.gran = e.target.value; F.picks.clear(); buildPeriodOptions(); render(); };
  $("fFrom").onchange = e => { F.from = e.target.value; F.preset="Custom Range"; $("fPreset").value="Custom Range"; render(); };
  $("fTo").onchange   = e => { F.to   = e.target.value; F.preset="Custom Range"; $("fPreset").value="Custom Range"; render(); };
  $("pickClear").onclick = () => { F.picks.clear(); render(); };
  $("pickLast2").onclick = () => pickRecent(2);
  $("pickLast4").onclick = () => pickRecent(4);
  $("fAgentSort").onchange = () => renderAgents();
  $("cmpA").onchange = () => render();
  $("cmpB").onchange = () => render();
  $("btnReset").onclick = () => {
    F.chan="ALL"; F.ivr="ALL"; F.preset="Last Week"; F.gran="weekly"; F.picks.clear();
    [...$("chanPills").children].forEach((x,i)=>x.classList.toggle("on", i===0));
    $("fIvr").value="ALL"; $("fPreset").value="Last Week"; $("fGran").value="weekly";
    applyPreset(); buildPeriodOptions(); render();
  };
}
(function init(){
  fillSelects();
  $("fFrom").min=MIN_D; $("fFrom").max=MAX_D; $("fTo").min=MIN_D; $("fTo").max=MAX_D;
  applyPreset();
  buildPeriodOptions();
  wire();
  renderDQ();
  render();
})();
