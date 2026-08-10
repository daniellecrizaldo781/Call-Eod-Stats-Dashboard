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

function bkFillSelects(){
  // Brand multi-selects (page-wide + drivers) are narrowed by the Main Channel selection.
  const brands = bkBrandList();
  // prune any selected brands that are no longer in the channel-narrowed universe
  ["brand","driversBrand"].forEach(k => {
    [...BK[k]].forEach(b => { if (!brands.includes(b)) BK[k].delete(b); });
  });
  buildBrandPicker("bkBrand", BK.brand, brands);
  buildBrandPicker("bkDriversBrand", BK.driversBrand, brands);   // same list, independent selection
  const concerns = [...new Set(bkAll().map(r=>r.concern))].sort((a,b)=>a.localeCompare(b));
  $("bkConcern").innerHTML = '<option value="ALL">All Concerns</option>' +
    concerns.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
  // branch picker for drill-in
  const cats = [...new Set(bkAll().map(r=>r.cat))].sort((a,b)=>a.localeCompare(b));
  $("bkBranchPick").innerHTML = '<option value="ALL">All Branches</option>' +
    cats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
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

  $("bkKpis").innerHTML =
      kpi("Total Tickets", nf(rows.length), scope, "agent")
    + kpi("Refund Tickets", nf(refundRows.length), pf(refundTicketsPct)+" of tickets", "bad")
    + kpi("Total Refunded", "$"+nf(Math.round(refundSum)), "across "+nf(refundRows.length)+" tickets", "warn")
    + kpi("Top Branch", esc(topCat?topCat[0]:"—"), nf(topCat?topCat[1]:0)+" tickets", "alt")
    + kpi("Top Brand", esc(topBrand?topBrand[0]:"—"), nf(topBrand?topBrand[1]:0)+" tickets", "good");

  // ---- Top call drivers (all branches) = top subcategories, with own brand filter ----
  const sub = new Map(); driversRows.forEach(r=>sub.set(r.sub,(sub.get(r.sub)||0)+1));
  const topSubs = [...sub.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v])=>({label:k, value:v}));
  hBars("chBkDrivers", topSubs, {color:"#E8578E", labelW:210,
    note: driversScope==="All Brands" ? "all brands" : driversScope});

  // ---- Per-branch drill ----
  const pick = $("bkBranchPick").value || "ALL";
  $("bkBranchScope").textContent = scope;
  if (pick === "ALL"){
    const drill = [...byCat.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8)
      .map(([k,v])=>({label:k, value:v}));
    hBars("chBkBranchDrill", drill, {color:"#C76BA0", labelW:170,
      suffix:"", note:"select a branch above to see its drivers"});
  } else {
    const subMap = new Map();
    rows.filter(r=>r.cat===pick).forEach(r=>subMap.set(r.sub,(subMap.get(r.sub)||0)+1));
    const drill = [...subMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15)
      .map(([k,v])=>({label:k, value:v}));
    hBars("chBkBranchDrill", drill, {color:"#E8578E", labelW:210,
      note:pick+" — top call drivers"});
  }

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
}
