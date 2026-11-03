/* ---------- Call Breakdown page: branches, call drivers, refunds ---------- */
/* Reads window.CALL_DATA.breakdown (array of ticket dicts from the 3rd sheet).
   Filtering: date range (F.from/F.to), Brand (BK.brand, page-wide), Concern (BK.concern).
   The Top Call Drivers chart has its OWN brand filter (BK.driversBrand) so you can
   look at one brand's drivers independently of the page-wide filter. */

const BK = { brand: new Set(), concern: "ALL", driversBrand: new Set() };
const BK_ALL = "__ALL__";

// pink palette for refund / branch charts
const BK_COL = ["#E8578E","#D9455F","#B99BDD","#D9A0B8","#C76BA0","#9B6BB0","#F0A6C4","#E082A8",
               "#7E5BA6","#B56B94","#D98FB8","#A86BB0","#E8578E","#C76BA0","#9B6BB0","#F0A6C4"];

function bkAll(){ return (D.breakdown || []); }
// A brand belongs to OHA if its name starts with "Oricle" (the Oricle Hearing Aid line).
function isOricle(b){ return typeof b === "string" && b.toLowerCase().indexOf("oricle") === 0; }
// Main Channel = OHA -> only Oricle brands; = NON-OHA -> everything else; = ALL -> no restriction.
function bkChannelMatch(r){
  if (F.chan === "OHA") return isOricle(r.brand);
  if (F.chan === "NON-OHA") return !isOricle(r.brand);
  return true;
}
// Is a brand currently selected? Empty set = ALL.
function bkBrandOn(set, b){ return set.size === 0 || set.has(b); }
// The channel-narrowed universe of brands currently selectable.
function bkBrandList(){
  const all = [...new Set(bkAll().map(r=>r.brand))].sort((a,b)=>a.localeCompare(b));
  if (F.chan === "ALL") return all;
  return all.filter(b => F.chan === "OHA" ? isOricle(b) : !isOricle(b));
}
// A short human label for the current selection (e.g. "3 brands", "Oricle Hearing Aid Pro", "All Brands").
function bkSelLabel(set, universe){
  if (set.size === 0) return "All Brands";
  if (set.size === 1) return [...set][0];
  return set.size + " brands";
}
function bkFiltered(){
  return bkAll().filter(r =>
    r.d >= F.from && r.d <= F.to &&
    bkChannelMatch(r) &&
    bkBrandOn(BK.brand, r.brand) &&
    (BK.concern === "ALL" || r.concern === BK.concern));
}
// rows used by the Top Call Drivers chart (respects its own brand multi-select)
function bkDriversRows(){
  const base = bkFiltered();
  return bkBrandOn(BK.driversBrand, null) ? base
    : base.filter(r => BK.driversBrand.has(r.brand));
}
function bkCount(rows){ return rows.length; }
function bkRefundRows(rows){ return rows.filter(r => r.refund > 0); }
function bkRefundSum(rows){ return bkRefundRows(rows).reduce((a,r)=>a+r.refund,0); }

// Previous-week (Mon-Sun) bounds for the refunded-amount comparison chips.
function bkPrevWeekBounds(){
  if (F.from === MIN_D && F.to === MAX_D) return null;          // "All weeks" -> no single prev week
  if (F.to !== addD(F.from, 6) && F.to !== MAX_D) return null;  // not a whole week
  const pw = addD(F.from, -7);
  // require the previous week to exist in the data; otherwise compare to nothing
  if (!ALL_DATES.includes(pw) && !bkAll().some(r => r.d >= pw && r.d <= addD(pw,6))) return null;
  const e = addD(pw, 6) > MAX_D ? MAX_D : addD(pw, 6);
  return [pw, e];
}
// Build a "▲ +12.3% vs prev wk" chip (or &mdash; when no prior week).
function bkPrevChip(cur, prev){
  if (prev == null || prev === 0 && cur === 0) return "&mdash; vs prev wk";
  if (prev === 0) return "new vs prev wk";
  const pct = (cur - prev) / prev * 100;
  const up = pct >= 0;
  const arrow = up ? "▲ +" : "▼ −";
  return arrow + Math.abs(pct).toFixed(1) + "% vs prev wk";
}
// Aggregate refund metrics for an arbitrary [from,to] range (respects channel/brand/concern).
function bkRangeRefund(from, to){
  const rows = bkAll().filter(r =>
    r.d >= from && r.d <= to &&
    bkChannelMatch(r) && bkBrandOn(BK.brand, r.brand) &&
    (BK.concern === "ALL" || r.concern === BK.concern));
  const rr = bkRefundRows(rows);
  return { tickets: rr.length, amount: bkRefundSum(rows), total: rows.length };
}
// Refund Rate = refund tickets / total tickets for that week (a true per-week %).
// When both weeks carry refunded $ we blend in the dollar signal so the rate also
// reflects magnitude: rate = 0.5*(ticket%) + 0.5*(dollar-share%). Falls back to
// the plain ticket% when refund $ is unavailable.
function bkRefundRatePct(cur, other){
  const ticketPct = cur.total ? cur.tickets / cur.total * 100 : 0;
  if (cur && other && (cur.amount + other.amount) > 0){
    const dollarShare = cur.amount / (cur.amount + other.amount) * 100;
    return (ticketPct + dollarShare) / 2;
  }
  return ticketPct;
}

function bkFillSelects(){
  // Brand multi-selects (page-wide + drivers) are narrowed by the Main Channel selection.
  const brands = bkBrandList();
  // prune any selected brands that are no longer in the channel-narrowed universe
  ["brand","driversBrand"].forEach(k => {
    [...BK[k]].forEach(b => { if (!brands.includes(b)) BK[k].delete(b); });
  });
  buildBrandPicker("bkBrand", BK.brand, brands);
  buildBrandPicker("bkDriversBrand", BK.driversBrand, brands);   // same list, independent selection
  bkFillWeekCmp();
  const concerns = [...new Set(bkAll().map(r=>r.concern))].sort((a,b)=>a.localeCompare(b));
  $("bkConcern").innerHTML = '<option value="ALL">All Concerns</option>' +
    concerns.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
  // category dropdowns (drivers + refund) — same category list, independent selection
  const cats = [...new Set(bkAll().map(r=>r.cat))].sort((a,b)=>a.localeCompare(b));
  fillCatSelect("bkCatPick", cats, BK.catDrill || "ALL");
  // refund picker: only categories that actually have refunded tickets
  const refundCats = [...new Set(bkAll().filter(r=>(r.refund||0)>0).map(r=>r.cat))].sort((a,b)=>a.localeCompare(b));
  fillCatSelect("bkRefCatPick", refundCats, BK.refCat && refundCats.includes(BK.refCat) ? BK.refCat : "ALL");
}
// Populate a native <select> with the categories (value = raw cat key).
function fillCatSelect(id, cats, cur){
  const el = $(id); if (!el) return;
  const label = c => c === "ALL" ? "All Categories" : c.replace(/_/g, " ");
  el.innerHTML = '<option value="ALL">All Categories</option>' +
    cats.map(c=>'<option value="'+esc(c)+'"'+(c===cur?" selected":"")+'>'+esc(label(c))+'</option>').join("");
  el.value = cur;   // ensure selection sticks even if not in fresh list
  el.onchange = id === "bkCatPick"
    ? function(){ BK.catDrill = el.value; renderBkCatDrill(el.value); }
    : function(){ BK.refCat  = el.value; renderBkRefDetail(el.value); };
}
// Build a compact brand picker: a single trigger pill + a dropdown (checkbox list + Select All).
function buildBrandPicker(id, set, brands){
  const el = $(id);
  const cur = bkSelLabel(set, brands);
  let html = '<button type="button" class="bk-trigger" id="'+id+'Trig" data-set="'+id+'">'+esc(cur)+'</button>' +
             '<div class="bk-menu">' +
               '<div class="bk-selall'+(set.size===0?" on":"")+'" data-set="'+id+'">✓ Select All</div>' +
               '<div class="chklist">';
  brands.forEach(b => {
    const on = set.size === 0 || set.has(b);
    html += '<label class="chk"><input type="checkbox" data-set="'+id+'" value="'+esc(b)+'"'+(on?" checked":"")+'> '+esc(b)+'</label>';
  });
  html += '</div></div>';
  el.innerHTML = html;
}

function bkRender(){
  if (F.page !== "break") return;
  const rows = bkFiltered();
  const scope = bkSelLabel(BK.brand, bkBrandList()) + (BK.concern==="ALL"?"":" · "+BK.concern)
             + " · " + fmtDY(F.from) + " → " + fmtDY(F.to);
  const driversRows = bkDriversRows();
  const driversScope = bkSelLabel(BK.driversBrand, bkBrandList());

  // ---- KPIs ----
  const refundRows = bkRefundRows(rows);
  const refundSum = bkRefundSum(rows);
  const byCat = new Map(); rows.forEach(r=>byCat.set(r.cat,(byCat.get(r.cat)||0)+1));
  const byBrand = new Map(); rows.forEach(r=>byBrand.set(r.brand,(byBrand.get(r.brand)||0)+1));
  const topCat = [...byCat.entries()].sort((a,b)=>b[1]-a[1])[0];
  const topBrand = [...byBrand.entries()].sort((a,b)=>b[1]-a[1])[0];
  const refundTicketsPct = rows.length ? refundRows.length/rows.length*100 : 0;

  // previous-week comparison chips (only when a single whole week is selected)
  const pw = bkPrevWeekBounds();
  let prevTicketsChip = "", prevAmountChip = "";
  if (pw){
    const prev = bkRangeRefund(pw[0], pw[1]);
    prevTicketsChip = bkPrevChip(refundRows.length, prev.tickets);
    prevAmountChip  = bkPrevChip(Math.round(refundSum), Math.round(prev.amount));
  } else {
    prevTicketsChip = "&mdash; vs prev wk";
    prevAmountChip  = "&mdash; vs prev wk";
  }

  $("bkKpis").innerHTML =
      kpi("Total Tickets", nf(rows.length), scope, "agent")
    + kpi("Refund Tickets", nf(refundRows.length), pf(refundTicketsPct)+" of tickets · "+prevTicketsChip, "bad")
    + kpi("Total Refunded", "$"+nf(Math.round(refundSum)), "across "+nf(refundRows.length)+" tickets · "+prevAmountChip, "warn")
    + kpi("Top Branch", esc(topCat?topCat[0]:"—"), nf(topCat?topCat[1]:0)+" tickets", "alt")
    + kpi("Top Brand", esc(topBrand?topBrand[0]:"—"), nf(topBrand?topBrand[1]:0)+" tickets", "good");

  // ---- Top call drivers (all branches) = top subcategories, with own brand filter ----
  const sub = new Map(); driversRows.forEach(r=>sub.set(r.sub,(sub.get(r.sub)||0)+1));
  const topSubs = [...sub.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v])=>({label:k, value:v}));
  hBars("chBkDrivers", topSubs, {color:"#E8578E", labelW:210,
    note: driversScope==="All Brands" ? "all brands" : driversScope});
  // click a driver name -> daily-count lightbox for that subcategory
  const drvEl = $("chBkDrivers");
  if (drvEl){
    drvEl.querySelectorAll("text[data-t]").forEach(tx => {
      tx.classList.add("bk-sub-link");
      tx.style.cursor = "pointer";
      tx.addEventListener("click", function(){
        bkDailyLightbox(tx.getAttribute("data-t"), driversRows);
      });
    });
  }
  // ALSO: clicking a category label in the per-branch chart is handled elsewhere

  // ---- Per-branch / per-category drill ---- pick by category pills
  const pick = (BK.catDrill || "ALL");
  $("bkBranchScope").textContent = scope;
  renderBkCatDrill(pick);

  // ---- Per-category refund detail ---- pick by refund category pills
  renderBkRefDetail(BK.refCat || "ALL");

  // ---- Top refund reasons (subcategory among refunded) ----
  const rsub = new Map();
  refundRows.forEach(r=>rsub.set(r.sub,(rsub.get(r.sub)||0)+1));
  const topRSub = [...rsub.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v])=>({label:k, value:v}));
  hBars("chBkRefundSub", topRSub, {color:"#D9455F", labelW:210});

  // ---- Refunded amount by brand ----
  const rbrand = new Map();
  refundRows.forEach(r=>rbrand.set(r.brand,(rbrand.get(r.brand)||0)+r.refund));
  const topRBrand = [...rbrand.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v])=>({label:k, value:Math.round(v), suffix:"", note:"$"+nf(Math.round(v))}));
  hBars("chBkRefundBrand", topRBrand, {color:"#D9A0B8", labelW:210, unit:"$"});

  bkRenderWeekCmp();
}

// Populate the two week-comparison dropdowns (all weeks present in the breakdown data).
function bkFillWeekCmp(){
  const weeks = [...new Set(bkAll().map(r=>weekStart(r.d)))].sort().reverse();
  const opts = weeks.map(w => '<option value="'+w+'">'+fmtWeek(w)+'</option>').join("");
  const a = $("bkCmpA"), b = $("bkCmpB"), pa = a ? a.value : null, pb = b ? b.value : null;
  if (a){ a.innerHTML = opts; a.value = weeks.includes(pa) ? pa : (weeks[1] || weeks[0]); }
  if (b){ b.innerHTML = opts; b.value = weeks.includes(pb) ? pb : (weeks[0] || weeks[0]); }
}
function bkRenderWeekCmp(){
  if (F.page !== "break") return;
  const a = $("bkCmpA"), b = $("bkCmpB");
  if (!a || !b) return;
  const wa = a.value, wb = b.value;
  if (!wa || !wb) return;
  const A = bkRangeRefund(wa, addD(wa,6) > MAX_D ? MAX_D : addD(wa,6));
  const B = bkRangeRefund(wb, addD(wb,6) > MAX_D ? MAX_D : addD(wb,6));
  const chg = (av, bv) => {
    if (bv === 0 && av === 0) return '<span class="delta flat">&mdash;</span>';
    if (bv === 0) return '<span class="delta up">new</span>';
    const d = (av - bv) / bv * 100;
    const up = d >= 0;
    return '<span class="delta '+(up?"up":"down")+'">'+(up?"▲ +":"▼ −")+Math.abs(d).toFixed(1)+'%</span>';
  };
  tbl($("tBkWeekCmp"),
    [{t:"Metric",k:"m"},
     {t:fmtWeek(wa),k:"a",n:1},
     {t:fmtWeek(wb),k:"b",n:1},
     {t:"Change",k:"c",n:1}],
    [{m:"Refund Tickets", a:nf(A.tickets), b:nf(B.tickets), c:chg(A.tickets, B.tickets)},
     {m:"Total Refunded", a:"$"+nf(Math.round(A.amount)), b:"$"+nf(Math.round(B.amount)),
      c:chg(Math.round(A.amount), Math.round(B.amount))},
     {m:"Total Tickets", a:nf(A.total), b:nf(B.total), c:chg(A.total, B.total)},
     {m:"Refund Rate", a:pf(bkRefundRatePct(A,B)), b:pf(bkRefundRatePct(B,A)),
      c:chg(bkRefundRatePct(A,B), bkRefundRatePct(B,A))}]);
     }

     /* ================= Per-category drill (interactive) ================= */
     function bkResBucket(r){
       const res = (r.res||"").toLowerCase();
       if ((r.refund||0) > 0 || /refund|refunded|full-refund|cancelled|discounts/.test(res)) return "Refunded";
       if (/reshipp/.test(res)) return "Reshipped";
       return "NonRefund";   // displayed as "Resolved / Non-Refund"
     }
     // generic small lightbox (reuses the shared .lb-* CSS)
     function bkLightbox(title, sub, headHtml, bodyRows, footHtml){
     const ov = document.createElement("div");
     ov.className = "lb-overlay";
     ov.innerHTML = '<div class="lb-box"><div class="lb-hd"><div><h3>'+esc(title)+'</h3>'+
     '<div class="lb-sub">'+esc(sub)+'</div></div><button class="lb-close">&times;</button></div>'+
     '<div class="lb-body"><div class="tscroll"><table><thead>'+headHtml+'</thead><tbody>'+bodyRows.join("")+(footHtml||"")+'</tbody></table></div></div>';
     function close(){ ov.remove(); document.removeEventListener("keydown", onKey); }
     function onKey(e){ if(e.key==="Escape") close(); }
     ov.querySelector(".lb-close").onclick = close;
     ov.addEventListener("click", e=>{ if(e.target===ov) close(); });
     document.addEventListener("keydown", onKey);
     document.body.appendChild(ov);
     }
     // daily count table for one subcategory (clicking a driver name).
     // Each day row shows tickets + a standout Refunded / Reshipped / Resolved+Non-Refund split.
     function bkDailyLightbox(sub, rows){
     const scope = rows.filter(r=>r.sub === sub);
     const days = [...new Set(scope.map(r=>r.d))].sort();
     // per day x tier
     const cell = {};
     scope.forEach(r=>{ const k=r.d+"|"+bkResBucket(r); cell[k]=(cell[k]||0)+1; });
     const totals = {Refunded:0,Reshipped:0,NonRefund:0};
     scope.forEach(r=>{ totals[bkResBucket(r)]++; });
     const total = scope.length;
     const tierHead = (lbl,cls)=>'<th class="lb-tier '+cls+'">'+lbl+'</th>';
     const dayRows = days.map(d=>{
       const R=cell[d+"|Refunded"]||0, H=cell[d+"|Reshipped"]||0, N=cell[d+"|NonRefund"]||0;
       const dayTot = R+H+N;
       return '<tr><td>'+esc(fmtDY(d))+'</td><td class="n"><b>'+nf(dayTot)+'</b></td>'
         + '<td class="n lb-tier lb-refunded">'+nf(R)+'</td>'
         + '<td class="n lb-tier lb-reshipped">'+nf(H)+'</td>'
         + '<td class="n lb-tier lb-nonrefund">'+nf(N)+'</td></tr>';
     }).join("");
     bkLightbox(sub, total+" tickets · "+nf(totals.Refunded)+" refunded, "+nf(totals.Reshipped)+" reshipped, "+nf(totals.NonRefund)+" resolved/non-refund",
       '<tr><th>Date</th>'+tierHead("Tickets","")+tierHead("Refunded","lb-refunded")+tierHead("Reshipped","lb-reshipped")+tierHead("Resolved / Non-Refund","lb-nonrefund")+'</tr>',
       [dayRows],
       '<tr class="tot"><td><b>Total</b></td><td class="n"><b>'+nf(total)+'</b></td>'
         + '<td class="n lb-tier lb-refunded"><b>'+nf(totals.Refunded)+'</b></td>'
         + '<td class="n lb-tier lb-reshipped"><b>'+nf(totals.Reshipped)+'</b></td>'
         + '<td class="n lb-tier lb-nonrefund"><b>'+nf(totals.NonRefund)+'</b></td></tr>');
     }

     function renderBkCatDrill(cat){
     const rows = bkFiltered();
     const d = $("bkCatDetail");
     // rows to show: all when "ALL", else just the chosen category
     const catRows = (cat === "ALL") ? rows : rows.filter(r=>r.cat===cat);
     const showCat = (cat === "ALL");   // add a Category column only in the all view
     const subs = [...new Set(catRows.map(r=>r.sub))];
     const days = [...new Set(catRows.map(r=>r.d))].sort();
     const cell = {};
     catRows.forEach(r=>{ const k=r.sub+"|"+r.d; cell[k]=(cell[k]||0)+1; });
     const resMap = {};
     catRows.forEach(r=>{
     const b = bkResBucket(r);
     resMap[r.sub] = resMap[r.sub] || {cat:r.cat, Refunded:0,Reshipped:0,NonRefund:0,Tickets:0};
     resMap[r.sub][b]=(resMap[r.sub][b]||0)+1; resMap[r.sub].Tickets++;
     });
     const head = '<tr><th>Subcategory</th>'+(showCat?'<th>Category</th>':'') + days.map(dd=>'<th>'+esc(fmtD(dd))+'</th>').join("") +
     '<th>Total</th><th class="lb-tier lb-nonrefund">Resolved / Non-Refund</th><th class="lb-tier lb-reshipped">Reshipped</th><th class="lb-tier lb-refunded">Refunded</th></tr>';
     const body = subs.map(sub=>{
     const r = resMap[sub]||{cat:"",Refunded:0,Reshipped:0,NonRefund:0,Tickets:0};
     let td = '<td><a class="bk-sub-link" data-sub="'+esc(sub)+'">'+esc(sub)+'</a></td>';
     if (showCat) td += '<td><span class="tag lav">'+esc(r.cat.replace(/_/g," "))+'</span></td>';
     let tot = 0;
     days.forEach(dd=>{ const v=cell[sub+"|"+dd]||0; tot+=v; td += '<td class="n">'+(v?'<a class="bk-day-link" data-sub="'+esc(sub)+'" data-day="'+esc(dd)+'">'+nf(v)+'</a>':"&middot;")+'</td>'; });
     td += '<td class="n"><b>'+nf(tot)+'</b></td>';
     td += '<td class="n lb-tier lb-nonrefund">'+nf(r.NonRefund)+'</td><td class="n lb-tier lb-reshipped">'+nf(r.Reshipped)+'</td><td class="n lb-tier lb-refunded">'+nf(r.Refunded)+'</td>';
     return '<tr>'+td+'</tr>';
     }).join("");
     // totals row
     const dayTot = days.map(dd => catRows.filter(r=>r.d===dd).length);
     const totRef = catRows.filter(r=>bkResBucket(r)==="Refunded").length;
     const totRes = catRows.filter(r=>bkResBucket(r)==="Reshipped").length;
     const totNon = catRows.filter(r=>bkResBucket(r)==="NonRefund").length;
     let foot = '<tr class="tot"><td><b>Total</b></td>';
     if (showCat) foot += '<td></td>';
     dayTot.forEach(t => foot += '<td class="n"><b>'+nf(t)+'</b></td>');
     foot += '<td class="n"><b>'+nf(catRows.length)+'</b></td>';
     foot += '<td class="n lb-tier lb-nonrefund"><b>'+nf(totNon)+'</b></td><td class="n lb-tier lb-reshipped"><b>'+nf(totRes)+'</b></td><td class="n lb-tier lb-refunded"><b>'+nf(totRef)+'</b></td></tr>';
     if (d){
     d.innerHTML = '<div class="scroll"><table class="bk-drill">'+head+'<tbody>'+body+foot+'</tbody></table></div>';
     d.querySelectorAll(".bk-sub-link").forEach(a=>{
       a.onclick = e=>{ e.preventDefault(); bkDailyLightbox(a.dataset.sub, catRows); };
     });
     d.querySelectorAll(".bk-day-link").forEach(a=>{
       a.onclick = e=>{ e.preventDefault(); bkDayLightbox(a.dataset.sub, a.dataset.day, catRows); };
     });
     }
     }

     // lightbox listing that day's tickets for one subcategory
     function bkDayLightbox(sub, day, rows){
     const scope = rows.filter(r=>r.sub===sub && r.d===day);
     const buckets = {Refunded:0,Reshipped:0,NonRefund:0};
     scope.forEach(r=>{ buckets[bkResBucket(r)]++; });
     const total = scope.length;
     const urlCell = u => {
       u = (u||"").trim();
       if (!u) return "&middot;";
       if (/^https?:\/\//i.test(u)) return '<a href="'+esc(u)+'" target="_blank" rel="noopener" class="bk-url">'+esc(u)+'</a>';
       return '<span class="bk-url">'+esc(u)+'</span>';   // ticket number / email, not a link
     };
     bkLightbox(sub+" — "+fmtDY(day), total+" tickets · "+nf(buckets.Refunded)+" refunded, "+nf(buckets.Reshipped)+" reshipped, "+nf(buckets.NonRefund)+" resolved/non-refund",
     '<tr><th>Ticket</th><th>Brand</th><th>Category</th><th>Resolution</th><th>Refunded $</th></tr>',
     scope.map(r=>'<tr><td>'+urlCell(r.url)+'</td><td>'+esc(r.brand)+'</td><td>'+esc(r.cat.replace(/_/g," "))+'</td><td>'+esc(r.res||"—")+'</td><td class="n">'+(r.refund>0?'$'+nf(Math.round(r.refund)):"&middot;")+'</td></tr>'),
     '<tr class="tot"><td colspan="4"><b>Total</b></td><td class="n"><b>'+nf(scope.filter(r=>r.refund>0).length)+' refunded</b></td></tr>');
     }

     function renderBkRefDetail(cat){
     const el = $("bkRefDetail"); if (!el) return;
     const rows = bkFiltered().filter(r=>(r.refund||0)>0);
     const catRows = (!cat || cat === "ALL") ? rows : rows.filter(r=>r.cat===cat);
     const showCat = (!cat || cat === "ALL");
     if (!catRows.length){
     el.innerHTML = '<div class="sub" style="padding:12px">No refunded tickets in this category for the current scope.</div>';
     return;
     }
     const subs = [...new Set(catRows.map(r=>r.sub))];
     const days = [...new Set(catRows.map(r=>r.d))].sort();
     const cnt = {}, amt = {};
     catRows.forEach(r=>{ const k=r.sub+"|"+r.d; cnt[k]=(cnt[k]||0)+1; amt[k]=(amt[k]||0)+(r.refund||0); });
     const subRefund = {}; catRows.forEach(r=>{ subRefund[r.sub]=(subRefund[r.sub]||0)+(r.refund||0); });
     const subCount = {}; catRows.forEach(r=>{ subCount[r.sub]=(subCount[r.sub]||0)+1; });
     const subCat = {}; catRows.forEach(r=>{ subCat[r.sub]=r.cat; });

     const head = '<tr><th>Subcategory</th>'+(showCat?'<th>Category</th>':'')+days.map(d=>'<th>'+esc(fmtD(d))+'</th>').join("")+
     '<th>Tickets</th><th>Refunded $</th></tr>';
     const body = subs.map(sub=>{
     let td = '<td>'+esc(sub)+'</td>';
     if (showCat) td += '<td><span class="tag lav">'+esc(subCat[sub].replace(/_/g," "))+'</span></td>';
     days.forEach(d=>{ const v=cnt[sub+"|"+d]||0; td += '<td class="n">'+(v?nf(v):"&middot;")+'</td>'; });
     td += '<td class="n"><b>'+nf(subCount[sub])+'</b></td><td class="n"><b>$'+nf(Math.round(subRefund[sub]))+'</b></td>';
     return '<tr>'+td+'</tr>';
     }).join("");
     const totCount = catRows.length, totAmt = catRows.reduce((s,r)=>s+r.refund,0);
     // per-day ticket totals for the footer
     const dayTot = days.map(d => catRows.filter(r=>r.d===d).length);
     let foot = '<tr class="tot"><td><b>Total</b></td>';
     if (showCat) foot += '<td></td>';
     dayTot.forEach(t => foot += '<td class="n"><b>'+nf(t)+'</b></td>');
     foot += '<td class="n"><b>'+nf(totCount)+'</b></td><td class="n"><b>$'+nf(Math.round(totAmt))+'</b></td></tr>';
     el.innerHTML = '<div class="scroll"><table class="bk-drill">'+head+'<tbody>'+body+foot+'</tbody></table></div>';
     }
