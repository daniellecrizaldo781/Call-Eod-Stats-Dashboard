/* ---------- tiny SVG chart library (no dependencies) ---------- */
const TIP = document.getElementById("tip");
function tipOn(e,t){ TIP.textContent=t; TIP.style.opacity=1;
  TIP.style.left=Math.min(e.clientX+14, innerWidth-230)+"px"; TIP.style.top=(e.clientY-10)+"px"; }
function tipOff(){ TIP.style.opacity=0; }
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function svg(w,h,inner){ return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet">'+inner+'</svg>'; }
/* Mark any element that directly holds an <svg> so CSS can let it scroll
   sideways on narrow screens (works without :has() support). */
function markChartBox(el){ if (el && el.querySelector && el.querySelector(":scope > svg")) el.classList.add("chartbox"); }
function bindTips(el){
  markChartBox(el);
  el.querySelectorAll("[data-t]").forEach(n=>{
    n.addEventListener("mousemove",e=>tipOn(e,n.getAttribute("data-t")));
    n.addEventListener("mouseleave",tipOff);
  });
}
function nice(max){ if(max<=0) return 10; const p=Math.pow(10,Math.floor(Math.log10(max)));
  const r=max/p; return (r<=1?1:r<=2?2:r<=5?5:10)*p; }

/* stacked vertical bars: cats=[{label,vals:{status:n},total}] */
function stackedBars(elId, cats, opts){
  const el = document.getElementById(elId);
  if (!cats.length){ el.innerHTML='<div class="empty">No data for the current filters.</div>'; return; }
  const o = Object.assign({h:280, keys:ST, colors:COL, unit:"calls"}, opts||{});
  const W=760, H=o.h, L=46, R=8, T=14, B=42;
  const iw=W-L-R, ih=H-T-B;
  const max = nice(Math.max(...cats.map(c=>c.total), 1));
  const bw = Math.min(46, iw/cats.length*0.68), step = iw/cats.length;
  let s = "";
  for (let i=0;i<=4;i++){ const y=T+ih-ih*i/4, v=Math.round(max*i/4);
    s += '<line class="axis" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/>'
       + '<text class="atxt" x="'+(L-7)+'" y="'+(y+3.5)+'" text-anchor="end">'+nf(v)+'</text>'; }
  cats.forEach((c,i)=>{
    const cx = L + step*i + step/2; let yb = T+ih;
    o.keys.forEach(k=>{
      const v = c.vals[k]||0; if(!v) return;
      const hh = ih*v/max; yb -= hh;
      s += '<rect class="bar" data-t="'+esc(c.label)+'\n'+k+': '+nf(v)+'\ntotal: '+nf(c.total)+'" x="'+(cx-bw/2)+'" y="'+yb
         + '" width="'+bw+'" height="'+Math.max(hh,0.7)+'" fill="'+o.colors[k]+'" rx="3"/>';
    });
    s += '<text class="atxt" x="'+cx+'" y="'+(T+ih+16)+'" text-anchor="middle">'+esc(c.label)+'</text>';
    if (cats.length<=20)
      s += '<text class="vtxt" x="'+cx+'" y="'+(yb-6)+'" text-anchor="middle">'+nf(c.total)+'</text>';
  });
  el.innerHTML = svg(W,H,s); bindTips(el);
}

/* grouped horizontal bars: rows=[{label, vals:{k:n}}] */
function groupedHBars(elId, rows, keys, opts){
  const el = document.getElementById(elId);
  if (!rows.length){ el.innerHTML='<div class="empty">No data for the current filters.</div>'; return; }
  const o = Object.assign({colors:COL, labelW:165, barH:10, gap:13, pad:13}, opts||{});
  const W=760, L=o.labelW, R=58, T=7, B=26;
  const rowH = keys.length*o.gap + o.pad, H = T+B+rows.length*rowH;
  const max = nice(Math.max(1, ...rows.map(r=>Math.max(...keys.map(k=>r.vals[k]||0)))));
  const iw = W-L-R;
  let s = "";
  for (let i=0;i<=4;i++){ const x=L+iw*i/4;
    s += '<line class="axis" x1="'+x+'" y1="'+T+'" x2="'+x+'" y2="'+(H-B)+'"/>'
       + '<text class="atxt" x="'+x+'" y="'+(H-B+15)+'" text-anchor="middle">'+nf(Math.round(max*i/4))+'</text>'; }
  rows.forEach((r,i)=>{
    const y0 = T + i*rowH + 6;
    const lab = r.label.length>24 ? r.label.slice(0,23)+"\u2026" : r.label;
    s += '<text class="atxt" data-t="'+esc(r.label)+'" x="'+(L-11)+'" y="'+(y0+rowH/2-2)+'" text-anchor="end" font-weight="700">'+esc(lab)+'</text>';
    keys.forEach((k,j)=>{
      const v=r.vals[k]||0, bw=iw*v/max, yy=y0+j*o.gap;
      s += '<rect class="bar" data-t="'+esc(r.label)+'\n'+k+': '+nf(v)+'" x="'+L+'" y="'+yy+'" width="'+Math.max(bw,1)
         + '" height="'+o.barH+'" fill="'+o.colors[k]+'" rx="3"/>'
         + (v? '<text class="vtxt" x="'+(L+bw+6)+'" y="'+(yy+o.barH-1.5)+'">'+nf(v)+'</text>' : '');
    });
  });
  el.innerHTML = svg(W,H,s); bindTips(el);
}

/* single-series horizontal bars */
function hBars(elId, rows, opts){
  const o = Object.assign({color:"#B99BDD", labelW:165, unit:""}, opts||{});
  const el = document.getElementById(elId);
  if (!rows.length){ el.innerHTML='<div class="empty">No data for the current filters.</div>'; return; }
  const W=760, L=o.labelW, R=64, T=5, B=7, rowH=23, H=T+B+rows.length*rowH;
  const max = nice(Math.max(1, ...rows.map(r=>r.value)));
  const iw = W-L-R; let s="";
  rows.forEach((r,i)=>{
    const y=T+i*rowH, bw=iw*r.value/max;
    const lab = r.label.length>24 ? r.label.slice(0,23)+"\u2026" : r.label;
    s += '<text class="atxt" x="'+(L-10)+'" y="'+(y+15)+'" text-anchor="end" font-weight="700">'+esc(lab)+'</text>'
       + '<rect class="bar" data-t="'+esc(r.label)+'\n'+nf(r.value)+(o.unit?" "+o.unit:"")+(r.note?"\n"+r.note:"")
       + '" x="'+L+'" y="'+(y+4)+'" width="'+Math.max(bw,1)+'" height="13" fill="'+(r.color||o.color)+'" rx="3.5"/>'
       + '<text class="vtxt" x="'+(L+bw+6)+'" y="'+(y+15)+'">'+nf(r.value)+(r.suffix||"")+'</text>';
  });
  el.innerHTML = svg(W,H,s); bindTips(el);
}

/* line chart with % axis */
function lineChart(elId, pts, opts){
  const el = document.getElementById(elId);
  if (pts.length<1){ el.innerHTML='<div class="empty">No data for the current filters.</div>'; return; }
  const o = Object.assign({h:262, color:"#E8578E", pct:true, max:100}, opts||{});
  const W=760, H=o.h, L=46, R=14, T=14, B=40, iw=W-L-R, ih=H-T-B;
  const max = o.pct ? 100 : nice(Math.max(...pts.map(p=>p.v),1));
  let s="";
  for (let i=0;i<=4;i++){ const y=T+ih-ih*i/4, v=max*i/4;
    s += '<line class="axis" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/>'
       + '<text class="atxt" x="'+(L-7)+'" y="'+(y+3.5)+'" text-anchor="end">'+(o.pct?v.toFixed(0)+"%":nf(Math.round(v)))+'</text>'; }
  const X = i => pts.length===1 ? L+iw/2 : L + iw*i/(pts.length-1);
  const Y = v => T + ih - ih*Math.min(v,max)/max;
  const d = pts.map((p,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(p.v).toFixed(1)).join(" ");
  s += '<path d="'+d+' L '+X(pts.length-1)+' '+(T+ih)+' L '+X(0)+' '+(T+ih)+' Z" fill="'+o.color+'" opacity=".10"/>';
  s += '<path d="'+d+'" fill="none" stroke="'+o.color+'" stroke-width="2.5" stroke-linejoin="round"/>';
  pts.forEach((p,i)=>{
    s += '<circle class="bar" data-t="'+esc(p.label)+'\n'+(o.pct?p.v.toFixed(1)+"%":nf(p.v))+(p.note?"\n"+p.note:"")
       + '" cx="'+X(i)+'" cy="'+Y(p.v)+'" r="4.5" fill="#fff" stroke="'+o.color+'" stroke-width="2.5"/>';
    const showEvery = Math.ceil(pts.length/12);
    if (i%showEvery===0)
      s += '<text class="atxt" x="'+X(i)+'" y="'+(T+ih+18)+'" text-anchor="middle">'+esc(p.label)+'</text>';
  });
  el.innerHTML = svg(W,H,s); bindTips(el);
}

/* donut */
function donut(elId, parts){
  const el = document.getElementById(elId);
  const tot = parts.reduce((a,p)=>a+p.value,0);
  if (!tot){ el.innerHTML='<div class="empty">No data for the current filters.</div>'; return; }
  const W=380,H=300,cx=142,cy=148,r=104,ir=64;
  let a0=-Math.PI/2, s="";
  parts.forEach(p=>{
    if(!p.value) return;
    const a1 = a0 + Math.PI*2*p.value/tot, big = (a1-a0)>Math.PI?1:0;
    const P=(rr,a)=>[(cx+rr*Math.cos(a)).toFixed(2),(cy+rr*Math.sin(a)).toFixed(2)];
    const [x1,y1]=P(r,a0),[x2,y2]=P(r,a1),[x3,y3]=P(ir,a1),[x4,y4]=P(ir,a0);
    s += '<path class="bar" data-t="'+esc(p.label)+'\n'+nf(p.value)+' ('+(p.value/tot*100).toFixed(1)+'%)" d="M'+x1+' '+y1
       + 'A'+r+' '+r+' 0 '+big+' 1 '+x2+' '+y2+'L'+x3+' '+y3+'A'+ir+' '+ir+' 0 '+big+' 0 '+x4+' '+y4+'Z" fill="'+p.color+'"/>';
    a0=a1;
  });
  s += '<text x="'+cx+'" y="'+(cy-4)+'" text-anchor="middle" font-size="27" font-weight="800" fill="#3A2233">'+nf(tot)+'</text>'
     + '<text x="'+cx+'" y="'+(cy+16)+'" text-anchor="middle" font-size="11" fill="#6B4A5E">TOTAL CALLS</text>';
  parts.forEach((p,i)=>{
    const y = 52+i*30;
    s += '<rect x="272" y="'+y+'" width="12" height="12" rx="3" fill="'+p.color+'"/>'
       + '<text class="atxt" x="292" y="'+(y+10.5)+'" font-weight="600">'+esc(p.label)+'</text>'
       + '<text class="atxt" x="292" y="'+(y+23)+'">'+nf(p.value)+' \u00b7 '+(tot?(p.value/tot*100).toFixed(1):0)+'%</text>';
  });
  el.innerHTML = svg(W,H,s); bindTips(el);
}
