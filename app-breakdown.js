/* ---------- Call Breakdown page: branches, call drivers, refunds ---------- */
/* Reads window.CALL_DATA.breakdown (array of ticket dicts from the 3rd sheet).
   Filtering: date range (F.from/F.to), Brand (bkBrand), Concern (bkConcern).
   Granularity (bkGran) drives the date bucketing shown in the KPI scope only;
   the charts aggregate over the selected date range regardless of granularity
   (the sheet is ticket-level, not hourly). */

const BK = { brand: "ALL", concern: "ALL" };

// pink palette for refund / branch charts
const BK_COL = ["#E8578E","#D9455F","#B99BDD","#D9A0B8","#C76BA0","#9B6BB0","#F0A6C4","#E082A8",
                "#7E5BA6","#B56B94","#D98FB8","#A86BB0","#E8578E","#C76BA0","#9B6BB0","#F0A6C4"];

function bkAll(){ return (D.breakdown || []); }
function bkFiltered(){
  return bkAll().filter(r =>
    r.d >= F.from && r.d <= F.to &&
    (BK.brand === "ALL" || r.brand === BK.brand) &&
    (BK.concern === "ALL" || r.concern === BK.concern));
}
function bkCount(rows){ return rows.length; }
function bkRefundRows(rows){ return rows.filter(r => r.refund > 0); }
function bkRefundSum(rows){ return bkRefundRows(rows).reduce((a,r)=>a+r.refund,0); }

function bkFillSelects(){
  const brands = [...new Set(bkAll().map(r=>r.brand))].sort((a,b)=>a.localeCompare(b));
  $("bkBrand").innerHTML = '<option value="ALL">All Brands</option>' +
    brands.map(b=>'<option value="'+esc(b)+'">'+esc(b)+'</option>').join("");
  const concerns = [...new Set(bkAll().map(r=>r.concern))].sort((a,b)=>a.localeCompare(b));
  $("bkConcern").innerHTML = '<option value="ALL">All Concerns</option>' +
    concerns.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
  // branch picker for drill-in
  const cats = [...new Set(bkAll().map(r=>r.cat))].sort((a,b)=>a.localeCompare(b));
  $("bkBranchPick").innerHTML = '<option value="ALL">All Branches</option>' +
    cats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join("");
}

function bkRender(){
  if (F.page !== "break") return;
  const rows = bkFiltered();
  const scope = (BK.brand==="ALL"?"All Brands":BK.brand) + (BK.concern==="ALL"?"":" · "+BK.concern)
             + " · " + fmtDY(F.from) + " → " + fmtDY(F.to);

  // ---- KPIs ----
  const refundRows = bkRefundRows(rows);
  const refundSum = bkRefundSum(rows);
  // top branch + top brand
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

  // ---- Top call drivers (all branches) = top subcategories ----
  const sub = new Map(); rows.forEach(r=>sub.set(r.sub,(sub.get(r.sub)||0)+1));
  const topSubs = [...sub.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v])=>({label:k, value:v}));
  hBars("chBkDrivers", topSubs, {color:"#E8578E", labelW:210});

  // ---- Branch volume ----
  const branchRows = [...byCat.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14)
    .map(([k,v])=>({label:k, value:v}));
  hBars("chBkBranch", branchRows, {color:"#B99BDD", labelW:170});

  // ---- Per-branch drill ----
  const pick = $("bkBranchPick").value || "ALL";
  $("bkBranchScope").textContent = scope;
  if (pick === "ALL"){
    // show combined top drivers per top branch as stacked? keep simple: top branches list
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

  // ---- Refund reasons (by Resolution bucket) ----
  // A ticket is a refund iff it has a refund amount > 0 (the Resolution text is
  // often "Non-Refund/General Inquiry" even when a refund was issued, so we trust
  // the dollar amount, not the label).
  function refundType(row){
    const r = (" "+row.res+" ").toLowerCase();
    const has = s => r.indexOf(s) >= 0;
    if (has("partial")) return "Partial Refund";
    if (has("50%")) return "50% Refund";
    if (has("pushback")) return "Refund Pushback";
    if (has("full refund")) return "Full Refund";
    if (has("refund")) return "Other Refund";
    return "Refund (unspecified)";
  }
  const rtMap = new Map();
  refundRows.forEach(r=>{ const t=refundType(r); rtMap.set(t,(rtMap.get(t)||0)+1); });
  const rtParts = [...rtMap.entries()].sort((a,b)=>b[1]-a[1])
    .map(([k,v],i)=>({label:k, value:v, color:BK_COL[i%BK_COL.length]}));
  donut("chBkRefundDonut", rtParts.length?rtParts:[{label:"No refunds",value:1,color:"#B99BDD"}],
        {center:"REFUND TICKETS"});

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
