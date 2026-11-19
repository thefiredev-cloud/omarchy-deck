// Money > Markets: market board, portfolio, trending tickers, catalysts and headlines. Loaded after app.js and deck.js.
// Feeds: GET /api/markets (public quotes, movers, catalysts), GET /api/portfolio (symbols, prices and day percent only),
// GET /api/today (market news), GET /api/trends (trending tickers), GET /api/portfolio-values (quantities, values, dollar changes, cash: requested only on Show amounts).
// Rows carry values only. Source names, quote ages, the movers basis and the delay note live in the Data sheet; the page shows one
// freshness mark, and a status only when something is out of date or old (the holdings date). Unknown is never 0.
// Direction is a shape and a sign (.delta), never a colour. Takes DeckUI (fmt, empty, fresh) as a free variable.
// ==== DECK INVEST UI BEGIN (pure: no DOM, no fetch, no globals; tests/money_markets*.test.js load this block) ====
const DeckInvest=(()=>{
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||120):'';
 const HIDE_MS=30000,MINUS='\u2212';
 const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const toEpoch=v=>{if(num(v)!=null)return v>1e12?v/1000:v;if(typeof v==='string'&&v){const p=Date.parse(v);return isFinite(p)?p/1000:null}return null};
 const safeUrl=u=>typeof u==='string'&&/^https?:\/\/[^\s"'<>\\@]+$/i.test(u)?u:'';
 const groupSep=s=>s.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 const ok=f=>isObj(f)&&!f.error;
 const feedStale=f=>ok(f)&&f.stale===true;
 // a price of exactly 0 is a feed hiccup, not a quote: it reads as no quote, with no orphan change beside it
 const live=v=>{const n=num(v);return n===0?null:n};
 // price text by instrument group: yields in percent, FX keeps its usual decimals, big prices drop cents
 function px(v,group,id){const n=num(v);if(n==null)return '';
  if(group==='rates')return n.toFixed(3)+'%';
  if(group==='fx')return n.toFixed(id==='usdjpy'||id==='dxy'?2:4);
  if(n>=10000)return groupSep(String(Math.round(n)));
  if(n>=1000)return groupSep(n.toFixed(group==='crypto'?0:2));
  if(group==='crypto'&&n<10)return n.toFixed(4);
  return n.toFixed(2)}
 // the instrument unit never shares the figure's cell: in a row it opens the second line on the left ("Per barrel"), in a tile it joins
 // the label ("Crude oil, per barrel"); points stay beside a tile figure at label size. So a long unit can never push a price out of its column.
 const UNIT={dxy:'pts',eurusd:'dollars per euro',usdjpy:'yen per dollar',wti:'per barrel',gold:'per ounce'};
 const unitOf=(r,g)=>g==='futures'||g==='vol'?'pts':UNIT[r.id]||'';
 const unitLine=u=>u==='pts'?'Points':u?u.charAt(0).toUpperCase()+u.slice(1):'';
 const priceText=(r,g)=>{const p=live(r.price);if(p==null)return '';return (['us','crypto','commodity'].includes(g)?'$':'')+px(p,g,r.id)};
 // changes: sign and true minus, two places for quotes (a change that rounds to zero prints no sign); a yield moves in basis points
 const pctTxt=v=>{const n=num(v);if(n==null)return '';const a=Math.abs(n).toFixed(2);return (+a===0?'':n>0?'+':MINUS)+a+'%'};
 const bpTxt=v=>{const n=num(v);if(n==null)return '';const x=Math.round(n*1000)/10;return (x>0?'+':x<0?MINUS:'')+Math.abs(x).toFixed(1)+' bp'};
 // direction follows the printed text, so a change that rounds to zero is flat, never a down arrow beside 0.00%
 const delta=(v,txt)=>txt?'<span class="delta '+(txt.charAt(0)==='+'?'up':txt.charAt(0)===MINUS?'dn':'flat')+'">'+esc(txt)+'</span>':'';
 // money for revealed amounts only. Whole dollars with separators; a negative reads with a true minus.
 const usd=v=>{const n=num(v);if(n==null)return '';return (n<0?MINUS:'')+'$'+groupSep(Math.abs(n).toFixed(0))};
 const sgnUsd=v=>{const n=num(v);if(n==null)return '';return (n>0?'+':n<0?MINUS:'')+'$'+groupSep(Math.abs(n).toFixed(0))};
 const MASK='$\u2022\u2022\u2022';
 function etDate(epoch,opt){try{return new Date(epoch*1000).toLocaleDateString(opt&&opt.iso?'en-CA':'en-US',Object.assign({timeZone:'America/New_York'},opt&&opt.iso?{}:{month:'short',day:'numeric'}))}catch(e){return ''}}
 const etToday=now=>etDate(now/1000,{iso:true})||new Date(now).toISOString().slice(0,10);
 // a day label never breaks inside itself ("Reports Tue Nov" / "17" at phone landscape): its spaces are no-break spaces
 function dayLabel(iso,now){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');if(!m)return '';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3])),t=etToday(now).split('-').map(Number),
   diff=Math.round((d-Date.UTC(t[0],t[1]-1,t[2]))/864e5),base=DOW[d.getUTCDay()]+'\u00A0'+MON[d.getUTCMonth()]+'\u00A0'+d.getUTCDate();
  return diff===0?'Today':diff===1?'Tomorrow':diff===-1?'Yesterday':base}
 function clockET(hhmm){const m=/^(\d{2}):(\d{2})$/.exec(hhmm||'');if(!m)return '';const h=+m[1];return ((h+11)%12+1)+':'+m[2]+' '+(h<12?'am':'pm')+' ET'}
 // ---- markup ----
 // o.open: the list is open past its first page (data-bal-open: the shared balancer plans it at its closed height, so it opens in place)
 const sect=(title,body,o)=>{o=o||{};return '<section class="sect'+(o.cls?' '+o.cls:'')+'"'+(o.id?' id="'+o.id+'"':'')+(o.open?' data-bal-open':'')+'><h2 class="secttl"><span>'+esc(title)+'</span>'+(o.act?'<span class="act">'+o.act+'</span>':'')+'</h2>'+body+'</section>'};
 // one quote row: label, then a second line (unit, name or report date; never a source or an age), price over the change. q.usdTxt is a
 // revealed day change in dollars (portfolio rows after Show amounts only): a third line under the percent, off the TV board (tv-hide).
 // c.sel (a symbol) makes the row the button that charts it (c.on: it is in the chart now); c.spk is its 1-month line, between the two sides.
 const qrow=(q,sub,pill,c)=>{c=c||{};const line=[unitLine(q.unit),sub].filter(Boolean).join(' \u00B7 '),tag=c.sel?'button':'div';
  return '<'+tag+(c.sel?' type="button"':'')+' class="frow'+(c.sel?' iv-sel':'')+'"'+(c.sel?' data-ivsel="'+esc(c.sel)+'" aria-pressed="'+(c.on?'true':'false')+'"':'')+'><span class="fl"><b>'+esc(q.label)+(pill?' <span class="pill">'+esc(pill)+'</span>':'')+'</b>'+(line?'<small>'+esc(line)+'</small>':'')+'</span>'+
  (c.spk||'')+
  '<span class="fr"><b>'+(q.price?esc(q.price):'<span class="na">No quote</span>')+'</b>'+(q.chgTxt?'<small>'+delta(q.chg,q.chgTxt)+'</small>':'')+
  (q.usdTxt?'<small class="iv-usd tv-hide"><span class="vh">Day change in dollars </span>'+delta(q.usd,q.usdTxt)+'</small>':'')+'</span></'+tag+'>'};
 const notReporting=(title,f)=>DeckUI.empty({k:'bad',title:title+' '+(/[^s]s$/.test(title)?'are':'is')+' not reporting',line:isObj(f)?'The source is not reporting. Try again in a moment.':'The deck did not answer.'});
 // ---- the quote model: what a row prints. Label, price, its unit and the change; a source name or an age never gets a field. ----
 function quote(r){const g=str(r&&r.group,12),p=live(r&&r.price),rates=g==='rates',c=p==null?null:num(rates?r.chg:r.pct);
  return {id:str(r&&r.id,16),label:str(r&&r.label,28)||str(r&&r.symbol,12),group:g,price:priceText(r||{},g),unit:unitOf(r||{},g),chg:c,chgTxt:p==null?'':rates?bpTxt(c):pctTxt(c)}}

 // ---- charts (the 2026-11-04 Markets charts, rebuilt in design v3). Points are the feed's own [epoch s, value], oldest first: hist is about
 // three months of daily closes, intra the latest session in 5-minute steps (crypto: hourly over 24 h). Nothing is filled or guessed: a range
 // without two points is off, a symbol without a series gets no line and is not a chart control. Direction is a sign and a shape, never a hue.
 const DAY=86400,RANGES=[['1d','1D','today'],['1m','1M','1 month'],['3m','3M','3 months']],RNG=RANGES.map(r=>r[0]);
// an exact zero close is a feed hiccup, the same rule as a zero price (live): it is no point; a negative close is a real price
const okPt=p=>Array.isArray(p)&&num(p[0])!=null&&num(p[1])!=null&&num(p[1])!==0;
 const intraOf=r=>isObj(r)&&isObj(r.intra)?r.intra:null;
 // one range's points: 1D the latest session, 1M the last 31 days of closes, 3M all of them (only when they reach back past 45 days)
 function pointsFor(r,rng){
  if(rng==='1d'){const i=intraOf(r);return i?arr(i.pts).filter(okPt):[]}
  const h=arr(isObj(r)&&r.hist).filter(okPt);if(h.length<2)return [];const end=h[h.length-1][0];
  if(rng==='3m')return end-h[0][0]>45*DAY?h:[];
  return h.filter(p=>p[0]>=end-31*DAY)}
 // the close the day's change is measured from: the price less the change (a yield in points), else from the percent, else the feed's own
 function prevClose(r){if(!isObj(r))return null;const p=live(r.price),c=num(r.chg),pc=num(r.pct);
  if(p!=null&&c!=null&&p-c>0)return p-c;
  if(p!=null&&pc!=null&&pc>-100)return p/(1+pc/100);
  const i=intraOf(r),v=i?num(i.prev):null;return v!=null&&v>0?v:null}
 const isRate=r=>isObj(r)&&r.group==='rates';
 // a value as its row prints it: yields in percent, FX in its decimals, dollars for stocks, funds, crypto and oil
 const valText=(r,v)=>{const g=str(r&&r.group,12);return (!g||['us','crypto','commodity'].includes(g)?'$':'')+px(v,g,str(r&&r.id,16))};
 const chgText=(r,from,to)=>from==null||to==null||!from?'':isRate(r)?bpTxt(to-from):pctTxt((to/from-1)*100);
 // the change over a range: 1D is the day's change as the row prints it; 1M and 3M run from the window's first close to the last price
 function rangeChange(r,rng){const pts=pointsFor(r,rng);if(pts.length<2)return '';
  if(rng==='1d')return quote(r).chgTxt;
  const last=live(r.price);return chgText(r,pts[0][1],last!=null?last:pts[pts.length-1][1])}
 // a line covers the span of the change beside it. A tile shows the day's change, so it draws today's path over a hairline at the last
 // close (no intraday path in the feed: no line). A row carries the last month of closes with its own "1M" change under it, the line's
 // hairline at the window's first close. Each line is on its own scale; the change is the number to compare.
 function daySpark(r){const md=chartModel(r,'1d');if(!md)return '';
  return DeckUI.spark(md.v,{w:120,h:24,base:md.base,label:'Today, '+(md.base!=null?'from '+valText(r,md.base)+' ':'')+'to '+valText(r,md.last.v)})}
 function monthSpark(r){const pts=pointsFor(r,'1m');if(pts.length<2)return '';const v=pts.map(p=>p[1]),c=rangeChange(r,'1m');
  return '<span class="iv-sp">'+DeckUI.spark(v,{w:120,h:24,base:v[0],label:'1 month, '+valText(r,v[0])+' to '+valText(r,v[v.length-1])})+
   (c?'<small><span aria-hidden="true">1M</span><span class="vh">1 month</span> '+delta(null,c)+'</small>':'')+'</span>'}
 const canChart=r=>RNG.some(k=>pointsFor(r,k).length>=2);
 // every instrument the page can chart, by symbol: the board first, then the watchlist (a held name is charted from its watchlist row)
 function chartIndex(m){const ix=Object.create(null);if(!ok(m))return ix;
  for(const r of arr(m.board).concat(arr(m.watchlist)).filter(isObj))if(typeof r.symbol==='string'&&!ix[r.symbol]&&canChart(r))ix[r.symbol]=r;
  return ix}
 // the symbol in the chart: the one last chosen (view.sel), else the S&P 500, else the first that has points
 function chartPick(m,view){const ix=chartIndex(m),w=str(view&&view.sel,16);return ix[w]?w:ix.SPY?'SPY':(Object.keys(ix)[0]||'')}
 // times read on the device's own clock, as the deck's clock does; a daily close is named by its bar's day (UTC: stocks open at 14:30 UTC,
 // crypto days start at 00:00 UTC), so a crypto close never slips to the day before on a Pacific clock
 const clock=t=>{const d=new Date(t*1000),h=d.getHours();return ((h+11)%12+1)+':'+String(d.getMinutes()).padStart(2,'0')+' '+(h<12?'am':'pm')};
 const barDay=t=>{const d=new Date(t*1000);return MON[d.getUTCMonth()]+'\u00A0'+d.getUTCDate()};
 // the chart model for one symbol and range: slots (values, null where the session has not reached yet), the real points, the base the
 // change runs from (1D: the previous close, drawn dashed; else the window's first close), the high, the low and the y domain
 function chartModel(r,rng){if(!isObj(r))return null;const pts=pointsFor(r,rng);if(pts.length<2)return null;
  const i=intraOf(r);let t=pts.map(p=>p[0]),v=pts.map(p=>p[1]);
  // a regular session (a working day, stocks) runs on its own grid from the open to the close, so a half-done day shows the hours to come
  if(rng==='1d'&&i&&num(i.open)!=null&&num(i.close)!=null&&i.close>i.open&&i.close-i.open<=8*3600){
   let step=Infinity;for(let k=1;k<pts.length;k++){const d=pts[k][0]-pts[k-1][0];if(d>0&&d<step)step=d}
   const n=isFinite(step)?Math.round((i.close-i.open)/step)+1:0;
   if(n>=2&&n<=600){const gv=new Array(n).fill(null),gt=Array.from({length:n},(x,k)=>i.open+k*step);let put=0;
    for(const p of pts){const k=Math.round((p[0]-i.open)/step);if(k>=0&&k<n){gv[k]=p[1];put++}}
    if(put>=2){t=gt;v=gv}}}
  const real=[];v.forEach((x,k)=>{if(x!=null)real.push({i:k,t:t[k],v:x})});
  const base=rng==='1d'?prevClose(r):real[0].v;
  let hi=real[0],lo=real[0];for(const p of real){if(p.v>hi.v)hi=p;if(p.v<lo.v)lo=p}
  // room above the high and under the low for their names (about a fifth of the span each side), so neither is cut by the edge
  const all=real.map(p=>p.v).concat(rng==='1d'&&base!=null?[base]:[]);let a=Math.min(...all),b=Math.max(...all);
  if(b===a){const d=Math.abs(a)*.001||1;a-=d;b+=d}const pad=(b-a)*.22;
  const days=new Set(real.map(p=>new Date(p.t*1000).toDateString())).size;
  return {sym:str(r.symbol,16),rng,n:v.length,t,v,real,base,hi,lo,last:real[real.length-1],dom:[a-pad,b+pad],multiDay:days>1}}
 const pctX=(md,i)=>md.n>1?100*i/(md.n-1):100;
 const pctY=(md,v)=>100*(1-(v-md.dom[0])/(md.dom[1]-md.dom[0]));
 const whenText=(md,t)=>md.rng==='1d'?(md.multiDay?DOW[new Date(t*1000).getDay()]+'\u00A0':'')+clock(t):barDay(t);
 // the readout for one real point (k: its place in md.real): when, value, and its change from the range's base
 function readout(r,md,k){if(!md||!md.real.length)return null;const p=md.real[Math.max(0,Math.min(md.real.length-1,Math.round(num(k)||0)))];
  const c=chgText(r,md.base,p.v);return {i:p.i,x:pctX(md,p.i),y:pctY(md,p.v),text:[whenText(md,p.t),valText(r,p.v),c].filter(Boolean).join(' \u00B7 ')}}
 // the nearest real point to a place across the chart (0 to 1)
 function nearest(md,frac){if(!md||!md.real.length)return 0;const x=Math.max(0,Math.min(1,num(frac)||0))*(md.n-1);let best=0;
  md.real.forEach((p,k)=>{if(Math.abs(p.i-x)<Math.abs(md.real[best].i-x))best=k});return best}
 const chartName=r=>{const l=str(r.label,28);if(l)return l;const n=nameOf(r.name),s=str(r.symbol,12);return n?n+' ('+s+')':s};
 // the chart block. view = {sel, rng}. It keeps one height for every symbol and range (a one-line name, one row of range chips, the plot
 // at its ratio, a one-line readout), so a tap moves nothing but the chart's own content. The price is not repeated: the tile or row that
 // was tapped holds it. Each range chip says its own change. The scrub is a range input over the plot: arrows, a finger, the pointer and a
 // TV remote's Left and Right read a point (tv.js leaves Left and Right to a field). Prices only: never an amount.
 function chart(m,view){const ix=chartIndex(m),sym=chartPick(m,view),r=ix[sym];if(!r)return '';
  const avail=RNG.filter(k=>pointsFor(r,k).length>=2),want=str(view&&view.rng,4),rng=avail.includes(want)?want:avail.includes('1d')?'1d':avail[0];
  const md=chartModel(r,rng),word=RANGES.find(x=>x[0]===rng)[2],ch=rangeChange(r,rng),name=chartName(r),last=live(r.price)!=null?live(r.price):md.last.v;
  const seg='<div class="seg iv-rng" role="group" aria-label="Chart range">'+RANGES.map(([k,w,lw])=>{const on=k===rng,can=avail.includes(k),c=can?rangeChange(r,k):'';
   return '<button type="button" data-ivrng="'+k+'"'+(on?' class="on"':'')+' aria-pressed="'+on+'"'+(can?'':' disabled')+'><span aria-hidden="true">'+w+'</span><span class="vh">'+lw.charAt(0).toUpperCase()+lw.slice(1)+'</span>'+(c?delta(null,c):'')+'</button>'}).join('')+'</div>';
  const P=md.real.map(p=>pctX(md,p.i).toFixed(2)+','+pctY(md,p.v).toFixed(2)).join(' ');
  // one line from the first point to the last; slots the session has not reached yet are simply not drawn. No fill under it: the value
  // axis does not start at zero (a day runs 748 to 758), and an area would make a fall look many times its size (SeeViz V15)
  const ln='<polyline class="ln" points="'+P+'"/>';
  const dash=rng==='1d'&&md.base!=null?'<line class="ref" x1="0" x2="100" y1="'+pctY(md,md.base).toFixed(2)+'" y2="'+pctY(md,md.base).toFixed(2)+'"/>':'';
  const lbl=(p,cls,w)=>{const x=pctX(md,p.i),edge=x<12?' iv-el':x>88?' iv-er':'';
   return '<span class="lbl '+cls+edge+'" style="--x:'+x.toFixed(2)+'%;--y:'+pctY(md,p.v).toFixed(2)+'%">'+w+' <b>'+esc(valText(r,p.v))+'</b></span>'};
  const marks=lbl(md.hi,'iv-hi','High')+(md.lo.v<md.hi.v?lbl(md.lo,'iv-lo lo','Low'):'');
  const dot='<span class="pt" style="--x:'+pctX(md,md.last.i).toFixed(2)+'%;--y:'+pctY(md,md.last.v).toFixed(2)+'%"></span>';
  const x0=whenText(md,md.t[0]),x1=whenText(md,md.t[md.n-1]);
  const baseWord=r.group==='crypto'?'24 h ago':'last close';
  const at=p=>(rng==='1d'?'at ':'on ')+whenText(md,p.t);
  const alt=[name+', '+word,'last '+valText(r,last)+(ch?', '+ch:''),'high '+valText(r,md.hi.v)+' '+at(md.hi),'low '+valText(r,md.lo.v)+' '+at(md.lo)].concat(dash?[baseWord+' '+valText(r,md.base)+', dashed']:[]).join('; ');
  const hint=dash?'Dashed line: '+baseWord+' '+valText(r,md.base):'Move along the chart to read a point';
  const k=md.real.length-1,ro=readout(r,md,k);
  // the plot's marks sit in a frame inside a clip: on a tall plot (a laptop's chart beside the side column) css/money.css grows the frame
  // past the plot's edges, so the room kept for the high and low names stays about 28 px instead of a fifth of the height
  return '<div class="iv-chart" id="iv-chart" data-ivchart="'+esc(sym)+'" data-rng="'+rng+'"><h3 class="iv-ch-n">'+esc(name)+'</h3>'+seg+
   '<div class="iv-plot"><div class="chart" role="img" aria-label="'+esc(alt)+'"><div class="iv-clip"><div class="iv-frame"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+dash+ln+'</svg>'+
   dot+marks+'<i class="iv-cur" hidden></i></div></div><span class="xt l">'+esc(x0)+'</span><span class="xt r">'+esc(x1)+'</span></div>'+
   '<input type="range" class="iv-scrub" min="0" max="'+k+'" step="1" value="'+k+'" aria-label="Read a point on the chart" aria-valuetext="'+esc(ro?ro.text:'')+'"></div>'+
   '<p class="iv-ro" data-hint="'+esc(hint)+'">'+esc(hint)+'</p></div>'}

 const GROUPS=[['futures','Futures'],['vol','Volatility'],['rates','Rates'],['fx','Dollar and currencies'],['commodity','Oil and gold'],['crypto','Crypto, 24 h']];
 const LEAD=['spy','qqq','dia','iwm','vix','us10y','wti','btc'];
 const SESSION={open:'US market open',pre:'Pre-market',after:'After hours',closed:'US market closed'};
 // the lead strip: 8, 6 or 4 tiles so its rows stay full; the rest of the board reads as rows by group
 function leadRows(b){const by=Object.create(null);for(const r of b)if(r.id)by[r.id]=r;
  let pick=LEAD.map(i=>by[i]).filter(Boolean);if(pick.length<4)pick=b.slice(0,8);
  const n=pick.length>=8?8:pick.length>=6?6:pick.length>=4?4:pick.length;return pick.slice(0,n)}
 // in a tile a word unit joins the label ("Crude oil, per barrel"); points stay beside the figure at label size. The day's change and
 // today's path share the tile's last line (css/money.css: beside the change on a phone, under it from a tablet up). The figure keeps its
 // size; only the change line rises a step. c.sel makes the tile the button that charts it.
 const tile=(q,c)=>{c=c||{};const tag=c.sel?'button':'div',t=(q.chgTxt?delta(q.chg,q.chgTxt):'')+(c.note?'<span class="sd warn"></span> '+esc(c.note):'')+(c.spk||'');
  return '<'+tag+(c.sel?' type="button"':'')+' class="tile'+(c.sel?' iv-sel':'')+'"'+(c.sel?' data-ivsel="'+esc(c.sel)+'" aria-pressed="'+(c.on?'true':'false')+'"':'')+'><span class="h">'+esc(q.label+(q.unit&&q.unit!=='pts'?', '+q.unit:''))+'</span><b class="v">'+(q.price?esc(q.price)+(q.unit==='pts'?'<span class="u">pts</span>':''):'<span class="na">No quote</span>')+'</b>'+(t?'<span class="t">'+t+'</span>':'')+'</'+tag+'>'};
 // what makes a tile or a row a chart control: its symbol (when it has points), its line, and whether it is in the chart now
 const ctlOf=(r,pick,day)=>{const s=canChart(r)&&typeof r.symbol==='string'?str(r.symbol,16):'';return {sel:s,on:!!s&&s===pick,spk:day?daySpark(r):monthSpark(r)}};
 // part 'lead': the Markets section (the chart, o.chart, then the strip; on the TV board css/money.css sets the two side by side); 'groups': the rest of the
 // instruments as rows by group; no part: both
 function board(m,part,view,o){
  if(!ok(m)||!Array.isArray(m.board))return part==='groups'?'':sect('Markets',notReporting('Markets',m),{cls:'span-all'});
  const b=arr(m.board).filter(isObj),s=isObj(m.session)?m.session:{},lead=leadRows(b),ids=new Set(lead.map(r=>r)),pick=chartPick(m,view),act=esc(SESSION[s.state]||'');
  // a fresh quote prints no age; an old, untimed or future-dated one says so on its own tile or row (the clock comes with o.now)
  const at=o&&num(o.now)!=null?o.now:null,note=r=>at==null?'':quoteNote(r,at,openOf(m));
  if(!b.length)return part==='groups'?'':sect('Markets',DeckUI.empty({k:'idle',title:'No quotes yet',line:'Quotes fill in after the next market read.'}),{cls:'span-all',act});
  // a chart that cannot be drawn leaves the strip standing (the strip is the page's answer; the chart is a reading of one of its tiles)
  const ch=()=>{try{return o&&o.chart?chart(m,view):''}catch(e){return ''}};
  let h=part==='groups'?'':sect('Markets',ch()+DeckUI.strip(lead.map(r=>tile(quote(r),Object.assign(ctlOf(r,pick,true),{note:note(r)}))),{label:'Markets'}),{cls:'span-all iv-mk',act});
  if(part==='lead')return h;
  for(const [g,label] of GROUPS){const rows=b.filter(r=>r.group===g&&!ids.has(r));if(!rows.length)continue;
   h+=sect(label,'<div class="flist">'+rows.map(r=>qrow(quote(r),note(r),'',ctlOf(r,pick))).join('')+'</div>')}
  return h}
 // movers: the biggest gainers and losers by symbol, name under it; the basis line is a Data sheet method note. A row whose price is old,
 // untimed or future-dated says so on its second line (the clock comes with now); a list that failed to read says it is not reporting
 function movers(m,now){if(!ok(m))return '';const mv=isObj(m.movers)?m.movers:{},at=num(now)!=null?now:null,
  open=openOf(m),failed=k=>arr(m.errors).some(e=>isObj(e)&&str(e.source,40).toLowerCase()==='movers '+k);
 const list=rows=>arr(rows).filter(isObj).slice(0,MOVERS_N).map(x=>{const p=live(x.price);
   return qrow({label:str(x.symbol,8)||'?',price:p==null?'':'$'+px(p,''),chg:p==null?null:num(x.pct),chgTxt:p==null?'':pctTxt(x.pct)},
    [nameOf(x.name),at==null?'':quoteNote(x,at,open)].filter(Boolean).join(' \u00B7 '))}).join('');
 const one=(title,k,rows)=>{const h=list(rows);return h?sect(title,'<div class="flist">'+h+'</div>'):failed(k)?sect(title,notReporting(title,m)):''};
 return one('Gainers','gainers',mv.gainers)+one('Losers','losers',mv.losers)}
 const MOVERS_N=3;
 // a company name is shown whole and wraps in the row's second line ("State Street Health Care Select Sector SPDR ETF"); only a name past
 // 120 characters, which no listing carries, is cut, and then at a word with an ellipsis. Never a silent cut mid-word.
 // the same rule for headline and event titles (a stored title runs to about 200 characters): whole and wrapping up to 300
 const whole=(v,n)=>{const s=str(v,n*4);if(s.length<=n)return s;const c=s.slice(0,n-1),sp=c.lastIndexOf(' ');return (sp>n/2?c.slice(0,sp):c).replace(/[\s,;:.\-]+$/,'')+'\u2026'};
 const nameOf=v=>whole(v,120),TITLE_MAX=300;

 // ---- portfolio. rev = ctl.view() or null; amounts are drawn only from rev.vals, the public feed never carries one ----
// how old the holdings snapshot is, in whole days from its own stamp. A stamp in the future is a bad clock: unknown, never "0 days".
// A stamp of zero or below is no time (a collector hiccup, the same rule as a zero quote time): unknown, never "Holdings as of Dec 31" (1969).
const stampOf=v=>{const t=toEpoch(v);return t!=null&&t>0?t:null};
function holdings(p,now){const bs=isObj(p.basis)?p.basis:{},a=isObj(p.as_of)?stampOf(p.as_of.positions):null,q=a!=null?a:stampOf(bs.equity_qty_as_of);
  // no stamp: unknown. The stored equity_qty_age_days was counted when the feed was written, so it is never a current age
  if(q==null)return {at:null,days:null};
  if(q>now/1000+300)return {at:null,days:null};
  return {at:q,days:Math.max(0,Math.floor((now/1000-q)/86400))}}
 // the holdings date is a status only when it is old (a day or more) or unknown. An end-of-day report (the broker's own quantities, plan
 // row L05) is a business day behind by nature: it always names its close, and is a status only past a weekend (more than 3 days)
 const eodOf=p=>{const bs=isObj(p&&p.basis)?p.basis:{};return /end-of-day/i.test(str(bs.equity_qty_source,200)||str(bs.equity_qty_label,60))};
 function holdingsNote(p,now){const h=holdings(p,now);
  if(eodOf(p)&&h.at!=null)return {text:'Holdings from the '+etDate(h.at)+' close',old:h.days>3};
  if(h.days!=null&&h.days<1)return null;
  return {text:h.at!=null?'Holdings as of '+etDate(h.at):'Holdings date unknown',old:true}}
 // Crypto quantities have their own snapshot: a current equity close never dates a crypto balance.
function cryptoHoldings(p,now){const bs=isObj(p.basis)?p.basis:{},q=stampOf(bs.crypto_qty_as_of),at=q!=null&&q<=now/1000+300?q:null,
  old=at==null||now/1000-at>=86400;
  return {at,old,live:bs.crypto_live===true&&!feedStale(p)&&!old}}
// four decimals, more for a small quantity (a 0.00001234 BTC holding reads as itself, never as 0 ×)
const fmtQty=q=>{const n=num(q);if(n==null)return '';if(n>=100)return groupSep(String(Math.round(n)));const a=Math.abs(n);if(a===0)return '0';
 return String(+n.toFixed(Math.min(12,Math.max(4,Math.ceil(-Math.log10(a))+2))))};
 const fcd=(exp,now)=>'Hides in '+Math.max(0,Math.round((exp-now)/1000))+' s';
 // m and view: the markets feed and the chart pick, so a held name carries its month line and charts on a tap (amounts never reach a chart)
 function portfolio(p,rev,now,m,view){
  if(!ok(p))return sect('Portfolio',notReporting('Portfolio',p));
  const t=isObj(p.totals)?p.totals:{},ps=arr(p.positions).filter(isObj);
  const vals=rev&&isObj(rev.vals)?rev.vals:null,vt=vals&&isObj(vals.totals)?vals.totals:null;
  const vmap=Object.create(null);if(vals)for(const v of arr(vals.positions))if(isObj(v)&&typeof v.symbol==='string')vmap[v.symbol]=v;
  const ix=chartIndex(m),pick=chartPick(m,view);
  // no markets feed (or no session in it): the session is unknown, so a position price takes the stricter open-session age limit and an old one says its date
  const open=openOf(m);
  const crypto=cryptoHoldings(p,now),cryptoOld=ps.some(x=>x.kind==='crypto')&&crypto.old;
  const note=holdingsNote(p,now),marks=[note?(note.old?'<span class="sd warn"></span>':'')+esc(note.text):'',t.margin_in_use===true?'<span class="pill warn"><span class="sd warn"></span>Margin in use</span>':''].filter(Boolean).join(' ');
  const money=(label,v,signed,sub,cls)=>'<div class="tile"><span class="h">'+esc(label)+'</span><b class="v">'+(vt?(num(v)==null?'<span class="na">No data</span>':esc(signed?sgnUsd(v):usd(v))):MASK)+'</b>'+(vt&&sub?'<span class="t'+(cls?' '+cls:'')+'">'+esc(sub)+'</span>':'')+'</div>';
  // after Show amounts the Positions tile says how much of it is equity and how much crypto; a part the values view lacks is left out.
  // The TV board keeps its revealed shape (tv-hide): the extra line wrapped and pushed the Portfolio 16 px past the board.
  const splitSub=vt?[num(vt.equity_usd)!=null?'Equity '+usd(vt.equity_usd):'',num(vt.crypto_usd)!=null?'Crypto '+usd(vt.crypto_usd):''].filter(Boolean).join(' \u00B7 '):'';
  const cashSub=vt?[num(vt.excess_liquidity_usd)!=null?'Excess liquidity '+usd(vt.excess_liquidity_usd):'',num(vt.net_est_usd)!=null?'Net about '+usd(vt.net_est_usd):''].filter(Boolean).join(' \u00B7 '):'';
  const day='<div class="tile"><span class="h">Day change</span><b class="v">'+(num(t.day_pct)==null?'<span class="na">No data</span>':esc(pctTxt(t.day_pct)))+'</b>'+
   (num(t.priced)!=null&&num(t.positions)!=null&&t.priced<t.positions?'<span class="t">'+esc(t.priced+' of '+t.positions+' priced')+'</span>':'')+'</div>';
  // the dollar totals are the sum of the priced positions: say so when some have no price, as the percent tile does
  const partial=num(t.priced)!=null&&num(t.positions)!=null&&t.priced<t.positions?t.priced+' of '+t.positions+' priced':'';
  const strip='<div class="strip" data-n="4" data-nb="4">'+day+money('Day change, dollars',vt&&vt.day_chg_usd,true,partial)+money('Positions',vt&&vt.positions_usd,false,splitSub,'tv-hide')+money('Cash and margin',vt&&vt.margin_cash_usd,false,cashSub)+'</div>';
  const ctl='<div class="ivctl">'+(vals?'<button type="button" class="btn" data-act="hide">Hide</button><span class="fcd" data-exp="'+esc(rev.exp)+'">'+esc(fcd(rev.exp,now))+'</span>'
   :'<button type="button" class="btn" data-act="reveal"'+(rev&&rev.busy?' disabled':'')+'>'+(rev&&rev.busy?'Loading':'Show amounts')+'</button>')+
   (vals&&(vals.stale||cryptoOld)?'<span class="ivctl-err"><span class="sd warn"></span>Amounts out of date</span>':'')+
   (rev&&rev.err?'<span class="ivctl-err"><span class="sd bad"></span>'+esc(rev.err)+'</span>':'')+'</div>';
  // a position with no live price shows its held quantity only: a value or a dollar change in the values view was priced at a quote this page does not have
  const rows=ps.length?ps.map(x=>{const v=vmap[x.symbol],pr=live(x.price),price=pr==null?'':'$'+px(pr,x.kind==='crypto'?'crypto':''),have=v&&num(v.qty)!=null,
    held=!have?'':pr==null?fmtQty(v.qty)+' held':fmtQty(v.qty)+' \u00D7 '+price+(num(v.value)!=null?' = '+usd(v.value):''),
    sub=[nameOf(x.name),x.kind==='crypto'?'24 h change':'',quoteNote({price:x.price,t:x.t,group:x.kind==='crypto'?'crypto':''},now,open),held].filter(Boolean).join(' \u00B7 ');
    const r=ix[x.symbol],priced=v&&pr!=null;
    return qrow({label:str(x.symbol,12)||'?',price,chg:pr==null?null:num(x.pct),chgTxt:pr==null?'':pctTxt(x.pct),usd:priced?num(v.day_chg):null,usdTxt:priced?sgnUsd(v.day_chg):''},sub,'',r?ctlOf(r,pick):null)}).join('')
   :'<div class="frow"><span class="fl"><b>No positions in the snapshot</b></span></div>';
  return sect('Portfolio',strip+ctl+'<div class="flist">'+rows+'</div>',{act:marks})}
 // Trending tickers (trends.json, 2026-11-17): what the market is trading now, not a list he keeps. Symbol, price and day change, the
 // volume against its average and the source's one-line reason. A symbol the markets feed carries a series for is a chart control
 // with its month line, as the board rows are. Not given (undefined) or failed: not reporting; no rows: one quiet line.
 const ratioTxt=v=>{const n=num(v);return n==null?'':(n>=10?Math.round(n):n.toFixed(1))+'\u00D7 volume'};
function trendingTickers(tr,now,m,view){const title='Trending tickers';
  if(!ok(tr)||!Array.isArray(tr.tickers))return sect(title,notReporting(title,isObj(tr)?tr:null),{cls:'iv-tr'});
  const rows=tr.tickers.filter(x=>isObj(x)&&/^[A-Za-z0-9.\-_^=]{1,16}$/.test(str(x.symbol,16)));
  if(!rows.length)return sect(title,DeckUI.empty({k:'idle',title:'Nothing trending right now',line:'Trending tickers fill in after the next read.'}),{cls:'iv-tr'});
  const ix=chartIndex(m),pick=chartPick(m,view),open=openOf(m);
  // a feed time that is missing, zero or ahead of the clock (past a few minutes of skew) cannot show its age: it reads "Time unknown", never blank or "just now"
  const at=toEpoch(tr.t!=null?tr.t:tr.generated_at),good=at!=null&&at>0&&at<=now/1000+FEED_SKEW_S,
   act=!good?'Time unknown':(tr.stale===true?'Out of date \u00B7 ':'')+DeckCore.whole(DeckCore.ago(at,now));
  return sect(title,'<div class="flist">'+rows.slice(0,12).map(x=>{const s=str(x.symbol,16),p=live(x.price),c=p==null?null:num(x.pct);
   return qrow({label:s,price:p==null?'':'$'+px(p,''),chg:c,chgTxt:c==null?'':pctTxt(x.pct)},
    [ratioTxt(x.volume_ratio),quoteNote(x,now,open),str(x.reason,120)||nameOf(x.name)].filter(Boolean).join(' \u00B7 '),'',ix[s]?ctlOf(ix[s],pick):null)}).join('')+'</div>',{cls:'iv-tr',act:esc(act)})}

 // ---- catalysts (upcoming) and headlines (market news and recent filings), each opens short with Show more ----
 const SHORT={up:6,rc:6},STEP={up:12,rc:12};
 const isRecent=c=>c.kind==='filing'||c.kind==='news';
 const shownCount=(k,view,total)=>Math.min(total,Math.max(SHORT[k],num(view&&view[k])==null?SHORT[k]:Math.round(view[k])));
 const moreRow=(k,shown,total)=>{const left=total-shown;if(left<=0&&shown<=SHORT[k])return '';
  return '<div class="more-row">'+(left>0?'<button type="button" class="btn" data-ivmore="'+k+'">Show '+Math.min(STEP[k],left)+' more</button>':'')+
   (shown>SHORT[k]?'<button type="button" class="btn btn-quiet" data-less="1" data-ivmore="'+k+'">Show fewer</button>':'')+'</div>'};
 const linkRow=(u,inner)=>u?'<a class="frow" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+inner+'</a>':'<div class="frow">'+inner+'</div>';
 function crow(c,now){const when=[dayLabel(str(c.date,10),now),c.time_et?clockET(c.time_et):str(c.when,24)].filter(Boolean).join(' \u00B7 ');
  const pills=(c.impact==='H'?'<span class="pill">High</span>':'')+(c.watch?'<span class="pill">Watched</span>':'');
  return linkRow(safeUrl(c.url),'<span class="fl"><b>'+esc(whole(c.title,TITLE_MAX))+'</b><small>'+esc([when,str(c.detail,40),c.eps_est?'EPS est '+str(c.eps_est,12):''].filter(Boolean).join(' \u00B7 '))+'</small></span>'+(pills?'<span class="fr">'+pills+'</span>':''))}
 function catalysts(m,now,view){
  if(!ok(m))return sect('Catalysts',notReporting('Catalysts',m));
  const today=etToday(now),up=arr(m.catalysts).filter(c=>isObj(c)&&!isRecent(c)&&str(c.date,10)>=today),n=shownCount('up',view,up.length);
  return sect('Catalysts',up.length?'<div class="flist">'+up.slice(0,n).map(c=>crow(c,now)).join('')+'</div>'+moreRow('up',n,up.length)
   :DeckUI.empty({k:'idle',title:'Nothing on the calendar',line:'No upcoming market events are listed.'}),{open:n>SHORT.up})}
 const TOPIC={housing:'Housing',rates:'Rates',local:'Local',ai:'AI companies',fire:'Fire',sports:'Sports business',markets:'Markets'};
 // one list, newest first: market news from the Today feed and recent filings and news from the markets feed
 function headlineItems(t,m,now){const out=[];
  const k=isObj(t)&&isObj(t.markets)?t.markets:null;
  if(k&&!k.error)for(const i of arr(k.items).filter(isObj)){const at=toEpoch(i.at);out.push({title:whole(i.title,TITLE_MAX),line:TOPIC[str(i.topic,16)]||'',at:at==null?0:at,url:safeUrl(i.url)})}
  if(ok(m))for(const c of arr(m.catalysts).filter(c=>isObj(c)&&isRecent(c)&&str(c.date,10))){const d=str(c.date,10),at=toEpoch(d+'T16:00:00Z');
   out.push({title:whole(c.title,TITLE_MAX),line:[c.kind==='filing'?'Filing':'News',dayLabel(d,now)].filter(Boolean).join(' \u00B7 '),at:at==null?0:at,url:safeUrl(c.url)})}
  return out.filter(x=>x.title).sort((a,b)=>b.at-a.at)}
 function headlines(t,m,now,view){const items=headlineItems(t,m,now),newsDown=!(isObj(t)&&isObj(t.markets)&&!t.markets.error);
  if(!items.length)return sect('Headlines',newsDown&&!ok(m)?notReporting('Headlines',null):DeckUI.empty({k:'idle',title:'No headlines right now',line:'Market news fills in after the next read.'}));
  const n=shownCount('rc',view,items.length);
  return sect('Headlines','<div class="flist">'+items.slice(0,n).map(x=>linkRow(x.url,'<span class="fl"><b>'+esc(x.title)+'</b>'+(x.line?'<small>'+esc(x.line)+'</small>':'')+'</span>')).join('')+'</div>'+moreRow('rc',n,items.length),{open:n>SHORT.rc})}

 // ---- page status: quote errors, missing values, invalid clocks and old prices cannot appear fresh ----
 const OPEN_STALE_S=1800,CLOSED_STALE_S=5*86400,FEED_SKEW_S=300;
 const quoteRows=m=>{const mv=isObj(m&&m.movers)?m.movers:{};
  return arr(m&&m.board).concat(arr(m&&m.watchlist),arr(mv.gainers),arr(mv.losers)).filter(isObj)};
 const quoteErrors=m=>arr(m&&m.errors).some(e=>isObj(e)&&/^(?:quote|kraken|movers)\b/i.test(str(e.source,40)));
 // a feed whose quote board is absent or empty read no quotes: it cannot speak for the market as fresh
 const noBoard=m=>!arr(m&&m.board).some(isObj);
 // a quote time of zero or below is no time (a feed hiccup, like a zero price): it reads as unknown, never as a date in 1969
const quoteTime=r=>{const t=toEpoch(r.t);return t!=null&&t>0?t:null};
// the session a quote is judged against. An unknown session (no markets feed, or none in it) takes the stricter open-session limit: a quote is never called fresh on a guess
const openOf=m=>!isObj(m)||!isObj(m.session)||m.session.state==='open';
 // crypto trades around the clock: its quote has the open-session age limit whatever the equity session says
const quoteStale=(r,s,open)=>{const t=quoteTime(r),p=live(r.price),limit=open||r.group==='crypto'?OPEN_STALE_S:CLOSED_STALE_S;
  return p==null||t==null||t>s||s-t>limit};
// what a strip that prints no age must still say about one quote: '' when it is fresh, else why it is not ("Time unknown", "As of Nov 7")
function quoteNote(r,now,open){if(!isObj(r))return '';if(live(r.price)==null)return 'Time unknown';const s=now/1000,t=quoteTime(r);
  if(!quoteStale(r,s,open))return '';return t==null||t>s?'Time unknown':'As of '+etDate(t)}
 // age is the markets feed's own (the portfolio's when the board is down); missing counts the parts that did not report
 function status(m,p,t,now){const s=now/1000,parts=[m,p,isObj(t)&&isObj(t.markets)?t.markets:t];
  const gen=f=>{const g=toEpoch(f.generated_at);return g!=null?g:toEpoch(f.t)};
  const missing=parts.filter(f=>!ok(f)).length;
  const okm=ok(m)?m:null,base=okm||(ok(p)?p:null),refresh=base&&num(base.refresh)>0?base.refresh:300;
  const g=base?gen(base):null,skew=g!=null&&g>s+FEED_SKEW_S;let age=g==null?null:Math.max(0,s-g);
  // a feed stamped ahead of the clock cannot say how old it is: it reads as old, never as just updated
  let stale=skew||parts.some(f=>feedStale(f));
  if(okm){const open=openOf(okm);
   if(noBoard(okm)||quoteErrors(okm)||quoteRows(okm).some(r=>quoteStale(r,s,open)))stale=true}
  if(stale&&age!=null)age=Math.max(age,2*refresh+1);
  return {age,refresh,missing,stale}}

 // ---- Data sheet: everything the rows no longer say ----
 const SRC=[[/federalreserve|^Federal Reserve$/i,'Federal Reserve'],[/bls\.gov/i,'BLS'],[/bea\.gov/i,'BEA'],[/nasdaq/i,'Nasdaq'],[/\bDOL\b/,'Labor Department'],[/\bISM\b/,'ISM'],[/treasurydirect/i,'Treasury'],[/sec\.gov|^SEC$/i,'SEC'],[/yahoo/i,'Yahoo Finance'],[/cnbc/i,'CNBC'],[/marketwatch/i,'MarketWatch'],[/^EIA/,'EIA'],[/^CBOE/i,'Cboe']];
 const srcName=t=>{const x=str(t,80);const h=SRC.find(r=>r[0].test(x));return h?h[1]:x.charAt(0).toUpperCase()+x.slice(1,40)};
 // when a source was read: epoch seconds; DeckUI.dataSheet prints it as a date ("Nov 14"), never ISO
 const whenAt=e=>e==null?'':Math.round(e);
 const plural=(n,w)=>n+' '+w+(n===1?'':'s');
 function data(m,p,t,now,tr){const sources=[],method=[],setup=[];
  const st=f=>!ok(f)?'never':feedStale(f)?'stale':'ok';
  const newest=rows=>{const ts=rows.map(quoteTime).filter(x=>x!=null&&x<=now/1000);return ts.length?Math.max(...ts):null};
  if(ok(m)){const b=arr(m.board).filter(isObj),rows=quoteRows(m),srcs=[...new Set(b.map(r=>srcName(r.src)).filter(Boolean))];
   const open=openOf(m),badQuote=noBoard(m)||quoteErrors(m)||rows.some(r=>quoteStale(r,now/1000,open));
   // the as-of date is the stock board's: crypto trades around the clock, so its minute-old quote never dates a closed market's last session (the feed's own as_of.quotes rule)
   const stocks=b.filter(r=>r.group!=='crypto');
   sources.push({name:'Market quotes'+(srcs.length?' ('+srcs.join(', ')+')':''),gives:plural(b.length,'instrument'),asOf:whenAt(newest(stocks.length?stocks:b)),state:badQuote?'stale':st(m)});
   const cs=[...new Set(arr(m.catalysts).filter(isObj).map(c=>srcName(c.source)).filter(Boolean))];
   if(cs.length)sources.push({name:'Event calendars',gives:cs.join(', '),asOf:whenAt(toEpoch(m.generated_at)||toEpoch(m.t)),state:st(m)});
   const mv=isObj(m.movers)?m.movers:{};if(str(mv.basis,120))method.push(['Gainers and losers',str(mv.basis,120)]);
   for(const e of arr(m.errors).filter(isObj))setup.push({name:str(e.source,40)||'A source',line:str(e.reason,240)||'Not reporting in the last read.',state:'blocked'})}
  else sources.push({name:'Market quotes',gives:'Not reporting',asOf:'',state:'never'});
  method.push(['Stock and fund quotes','Public quotes, about 15 min delayed']);
  method.push(['Changes','Day change from the last close; crypto over 24 h; yields in basis points']);
  method.push(['Lines','A tile draws today\'s path over a hairline at the last close; a row draws the last month of closes over a hairline at its first close, with that month\'s change. Each line has its own scale: compare moves by the change, not by line height']);
  method.push(['Chart','1D is the latest session in 5-minute steps (crypto hourly over 24 h), with the last close dashed; 1M and 3M are daily closes, and their change runs from the first close shown']);
  // where the quantities come from (L05): the served basis carries the collector's own words (equity_qty_source; the label is not served),
  // named here in the Data sheet and never on the page; the source's first clause names it, the whole sentence is a method line
  if(ok(p)){const h=holdings(p,now),bs=isObj(p.basis)?p.basis:{},qs=str(bs.equity_qty_source,200),qn=str(bs.equity_qty_label,60)||qs.split(/[,(;]/)[0].trim().slice(0,60);
   sources.push({name:'Holdings'+(qn?' ('+qn+')':''),gives:plural(arr(p.positions).length,'position'),asOf:h.at!=null?whenAt(h.at):'',state:(holdingsNote(p,now)||{}).old?'stale':st(p)});
   const crypto=cryptoHoldings(p,now);
   if(arr(p.positions).some(x=>isObj(x)&&x.kind==='crypto')||stampOf(bs.crypto_qty_as_of)!=null)sources.push({name:'Crypto balances',gives:crypto.live?'Live balance':'Balance not live',asOf:crypto.at!=null?whenAt(crypto.at):'',state:crypto.old?'stale':st(p)});
   if(qs)method.push(['Quantities',qs]);
   if(str(bs.crypto_qty_source,200))method.push(['Crypto balances',str(bs.crypto_qty_source,200)]);
   if(str(p.as_of_note,220))method.push(['Holdings',str(p.as_of_note,220)]);
   if(str(bs.price_note,220))method.push(['Prices',str(bs.price_note,220)]);
   method.push(['Amounts','Hidden until you tap Show amounts, then hidden again after 30 s'])}
  else sources.push({name:'Holdings',gives:'Not reporting',asOf:'',state:'never'});
  const k=isObj(t)&&isObj(t.markets)?t.markets:null;
  if(k&&!k.error){const ns=[...new Set(arr(k.items).filter(isObj).map(i=>str(i.source,40)).filter(Boolean))];
   sources.push({name:'Market news'+(ns.length?' ('+ns.join(', ')+')':''),gives:plural(arr(k.items).length,'headline'),asOf:whenAt(toEpoch(k.t)),state:k.stale?'stale':'ok'})}
  else sources.push({name:'Market news',gives:'Not reporting',asOf:'',state:'never'});
  if(ok(tr)){const bad=arr(tr.feeds).filter(f=>isObj(f)&&f.ok===false).map(f=>str(f.id,40)).filter(Boolean);
   sources.push({name:'Trending tickers',gives:plural(arr(tr.tickers).length,'ticker')+(bad.length?', not reporting: '+bad.join(', '):''),asOf:whenAt(toEpoch(tr.t!=null?tr.t:tr.generated_at)),state:tr.stale===true||bad.length?'stale':'ok'})}
  else if(tr!==undefined)sources.push({name:'Trending tickers',gives:'Not reporting',asOf:'',state:'never'});
  return {sources,method,setup}}

 // ---- Reveal controller: the one place that holds amounts. 30 s, then they are dropped. ----
 function ctl(env,ms){
  const LIFE=ms||HIDE_MS;let vals=null,exp=0,timer=null,gen=0,err='',busy=false;
  const drop=()=>{vals=null;exp=0;if(timer){env.clearT(timer);timer=null}};
  function hide(){gen++;const was=vals!==null||busy||err!=='';drop();busy=false;err='';if(was)env.onChange()}
  function sweep(){if(vals!==null&&env.now()>=exp){hide();return true}return false}
  async function reveal(){if(busy)return;busy=true;err='';const g=gen;env.onChange();
   let r=null;try{r=await env.get('/api/portfolio-values')}catch(e){r=null}
   if(g!==gen)return; // hidden while the request was in flight: the answer is dropped unread
   busy=false;
   if(!isObj(r)||r.error){err=isObj(r)&&r.error?'Amounts are not available. Try again.':'The deck did not answer. Try again.';env.onChange();return}
   vals={totals:isObj(r.totals)?r.totals:null,positions:arr(r.positions),stale:r.stale===true};exp=env.now()+LIFE;
   timer=env.setT(()=>{hide()},LIFE);env.onChange()}
  return {reveal,hide,sweep,view:()=>({vals,exp,err,busy})}}

 // ---- loading: a section whose feed has not answered yet shows a static skeleton, never a blank panel ----
 const SLOW_MS=8000,ABORT_MS=60000;
 // what each read must look like before the page draws it (DeckPages.get opt.shape). A wrong-typed answer (a board that is not a list, no
 // positions, news that is neither a list nor a reason) counts as a failed read, so the guard keeps the last good answer under its Out of
 // date mark instead of the page reading "Nothing on the calendar" or "No headlines right now" about data it never got
 const listOrNone=v=>v==null||Array.isArray(v);
 const SHAPE={
  markets:d=>isObj(d)&&Array.isArray(d.board)&&listOrNone(d.watchlist)&&listOrNone(d.catalysts),
  portfolio:d=>isObj(d)&&Array.isArray(d.positions)&&(d.totals==null||isObj(d.totals))&&(d.basis==null||isObj(d.basis)),
  today:d=>isObj(d)&&isObj(d.markets)&&(typeof d.markets.error==='string'||Array.isArray(d.markets.items)),
  trends:d=>isObj(d)&&(typeof d.error==='string'||(Array.isArray(d.tickers)&&listOrNone(d.feeds)))};
 const skel=(title,slow)=>sect(title,'<div class="flist" aria-busy="true" data-skel="1">'+'<div class="frow"><span class="fl"><span class="skel l"></span><span class="skel t"></span></span></div>'.repeat(3)+'</div>'+
  (slow?'<p class="note">Taking longer than usual. It fills in when the deck answers.</p>':''));

 // the whole sub page. st = {m, p, t, tr}: 'loading' | 'slow' | 'done'; a part that has not answered shows a skeleton. o = {tv, cls, tr}:
 // the TV view, the device class (P L T D XL TV) and the trends feed; the glue repaints when the class changes. The markup follows the
 // class, so the order a keyboard or screen reader meets is the order on screen:
 // - TV: the .board is one calm screen: the chart beside the Markets strip (PlanDesign M8: the board leads with the 1D chart of the S&P
 //   500, or the symbol last charted), then the Portfolio, its rows cut by height; Trending tickers sit one Down press below, the movers in the flow.
 // - P, L, T: the Markets section (the chart, then the strip; css/money.css puts them side by side at L), then Portfolio, Trending
 //   tickers under the positions and the movers beside them.
 // - D, XL: the strip across, then the chart in its own shape with Trending tickers under it at 8/12, Portfolio and the movers at
 //   4/12, so the two columns end close together.
 // A failed part shows its own not reporting state; when the markets feed is down the page leads with one status bar and one Try again.
 // Under the board the flow opts in to the shared balancer (data-balance): each section stays whole in its column, the long lists open
 // short with Show more.
 function page(m,p,t,rev,now,view,st,o){
  const part=(fn,title)=>{try{return fn()}catch(e){return sect(title,DeckUI.empty({k:'bad',title:'Could not show '+title.toLowerCase(),line:'Reload the deck if it keeps happening.'}))}};
  const wait=k=>st&&st[k]&&st[k]!=='done'?st[k]:'';
  const col=(k,f,title,fn)=>!f&&wait(k)?skel(title,wait(k)==='slow'):part(fn,title);
  const bar=!wait('m')&&!ok(m)?'<div class="stale-bar"><span class="sd warn"></span>Markets are not reporting<button type="button" class="btn btn-sm" data-retry="money/markets">Try again</button></div>':'';
  const cls=str(o&&o.cls,4),tv=!!(o&&o.tv)||cls==='TV',wide=!tv&&(cls==='D'||cls==='XL');
  const lead=col('m',m,'Markets',()=>board(m,'lead',view,{chart:!wide,now})),pf=col('p',p,'Portfolio',()=>portfolio(p,rev,now,m,view));
  const wl=wait('tr')&&!(o&&o.tr)?skel('Trending tickers',wait('tr')==='slow'):part(()=>trendingTickers(o&&o.tr,now,m,view),'Trending tickers'),mv=part(()=>movers(m,now),'Movers'),ch=()=>{try{return chart(m,view)}catch(e){return ''}};
  const top=tv?'<div class="board">'+lead+pf+'</div>'+wl
   :wide?'<div class="board iv-board iv-wide">'+lead+'<div class="iv-cols"><div class="iv-left">'+ch()+wl+'</div><div class="iv-right">'+pf+mv+'</div></div></div>'
   :'<div class="board iv-board">'+lead+'<div class="iv-side">'+pf+wl+mv+'</div></div>';
  return bar+top+'<div class="flow" data-balance>'+part(()=>board(m,'groups',view,{now}),'Markets')+
   col('m',m,'Catalysts',()=>catalysts(m,now,view))+col('t',t,'Headlines',()=>headlines(t,m,now,view))+(tv?mv:'')+'</div>'}
 return {esc,px,pctTxt,bpTxt,usd,sgnUsd,dayLabel,clockET,etToday,quote,quoteNote,leadRows,board,movers,portfolio,holdings,holdingsNote,trendingTickers,catalysts,headlineItems,headlines,status,data,page,ctl,fcd,
  HIDE_MS,MASK,safeUrl,SHORT,STEP,skel,SLOW_MS,ABORT_MS,SHAPE,RANGES,pointsFor,prevClose,rangeChange,daySpark,monthSpark,chartIndex,chartPick,chartModel,readout,nearest,chart}
})();
// ==== DECK INVEST UI END ====
// ---- glue (DOM + fetch): the money/markets route. Skipped where there is no document or no page registry (node tests). ----
if(typeof document!=='undefined'&&typeof DeckPages!=='undefined'){
 // the chart's symbol and range are remembered on this device (a symbol and a range key, never an amount)
 const PICK_KEY='markets-chart';
 const loadPick=()=>{try{const s=JSON.parse(localStorage.getItem(PICK_KEY)||'null');if(s&&typeof s==='object')return {sel:typeof s.sel==='string'?s.sel.slice(0,16):'',rng:DeckInvest.RANGES.some(r=>r[0]===s.rng)?s.rng:'1d'}}catch(e){}return {sel:'',rng:'1d'}};
 const savePick=()=>{try{localStorage.setItem(PICK_KEY,JSON.stringify({sel:IV.view.sel,rng:IV.view.rng}))}catch(e){}};
 const IV={m:null,p:null,t:null,tr:null,at:0,busy:false,st:{m:'loading',p:'loading',t:'loading',tr:'loading'},view:Object.assign({up:DeckInvest.SHORT.up,rc:DeckInvest.SHORT.rc},loadPick()),ctx:null,bound:null};
 // a request that never answers must not hold the page blank (or the busy flag) forever: it is cut off and reads as not reporting. Each read
 // carries its shape check, so a wrong-typed answer is a failed read and the guard hands back the last good one, marked out of date
 const ivGet=path=>DeckPages.get(path,{timeout:DeckInvest.ABORT_MS,shape:DeckInvest.SHAPE[path]}).then(r=>r&&r.ok?r.data:{error:r&&r.error||'http '+(r&&r.status||0)}).catch(()=>null);
 // the values route is never cached and never goes through the shared feed helper; bfetch (deck.js) bounds it at 60 s like every fetch
 const valGet=p=>bfetch(p,{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():{error:'http '+r.status}).catch(()=>null);
 const ICTL=DeckInvest.ctl({get:valGet,setT:(fn,ms)=>setTimeout(fn,ms),clearT:t=>clearTimeout(t),now:()=>Date.now(),onChange:()=>ivPaint()});
 // the TV view and the device class come with the page context (DeckPages reads html.tv and the class the shell set)
 const isTv=()=>!!(IV.ctx&&IV.ctx.tv);
 const clsNow=()=>typeof DeckPages.cls==='function'?DeckPages.cls():IV.ctx&&IV.ctx.cls||'';
 // a repaint (a refresh, Show amounts, a new device class) keeps keyboard and remote focus on the same control: a tile or row by its
 // symbol, a range chip by its range, or the scrub
 const STOPS='[data-ivsel],[data-ivrng],.iv-scrub';
 const stopOf=a=>!a||!a.matches||!a.matches(STOPS)?'':a.matches('.iv-scrub')?'.iv-scrub':a.dataset.ivrng?'[data-ivrng="'+a.dataset.ivrng+'"]':(a.classList.contains('tile')?'.tile':'.frow')+'[data-ivsel="'+String(a.dataset.ivsel).replace(/["\\]/g,'')+'"]';
 function ivPaint(){const c=IV.ctx;if(!c||!c.el)return;const now=Date.now(),a=document.activeElement,at=a&&c.el.contains(a)?stopOf(a):'';
  try{c.el.innerHTML=DeckInvest.page(IV.m,IV.p,IV.t,ICTL.view(),now,IV.view,IV.st,{tv:isTv(),cls:clsNow(),tr:IV.tr||undefined})}catch(e){c.el.innerHTML=DeckUI.empty({k:'bad',title:'Could not show Markets',line:'Reload the deck if it keeps happening.'})}
  if(at){const n=c.el.querySelector(at);if(n)n.focus({preventScroll:true})}
  if(IV.st.m==='done'){const s=DeckInvest.status(IV.m,IV.p,IV.t,now);DeckPages.mark(c,{age:s.age,refresh:s.refresh,missing:s.missing})}
  DeckPages.tv()}
 // a new pick or range replaces the chart section alone (same height) and moves the pressed mark; nothing else on the page moves
 function ivChart(){const c=IV.ctx;if(!c||!c.el)return null;const old=c.el.querySelector('#iv-chart');let h='';try{h=DeckInvest.chart(IV.m,IV.view)}catch(e){h=''}
  if(!old||!h){ivPaint();return c.el.querySelector('#iv-chart')}
  const tp=document.createElement('template');tp.innerHTML=h;const sec=tp.content.firstElementChild;old.replaceWith(sec);
  c.el.querySelectorAll('[data-ivsel]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.ivsel===sec.dataset.ivchart?'true':'false'));
  return sec}
 // a tapped row or tile (or Enter on it) charts its symbol and brings the chart into view; on TV the remote lands on the scrub
 function ivSelect(sym){IV.view.sel=sym;savePick();const sec=ivChart();if(!sec)return;
  const r=sec.getBoundingClientRect(),top=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'))||0;
  if(r.top<top||r.bottom>innerHeight)sec.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(isTv()){const s=sec.querySelector('.iv-scrub');if(s)s.focus({preventScroll:true})}}
 // the scrub: the readout follows a finger, the pointer, the arrow keys and a remote; the hint comes back when it leaves
 function ivModel(){const sec=IV.ctx&&IV.ctx.el&&IV.ctx.el.querySelector('#iv-chart'),r=sec&&IV.m?DeckInvest.chartIndex(IV.m)[sec.dataset.ivchart]:null;
  return r?{sec,r,md:DeckInvest.chartModel(r,sec.dataset.rng)}:null}
 function ivRead(k){const o=ivModel();if(!o||!o.md)return;const ro=DeckInvest.readout(o.r,o.md,k);if(!ro)return;
  const cur=o.sec.querySelector('.iv-cur'),out=o.sec.querySelector('.iv-ro'),s=o.sec.querySelector('.iv-scrub');
  if(cur){cur.hidden=false;cur.style.setProperty('--x',ro.x.toFixed(2)+'%');cur.style.setProperty('--y',ro.y.toFixed(2)+'%')}
  if(out)out.textContent=ro.text;if(s){if(String(s.value)!==String(k))s.value=String(k);s.setAttribute('aria-valuetext',ro.text)}}
 function ivUnread(){const sec=IV.ctx&&IV.ctx.el&&IV.ctx.el.querySelector('#iv-chart');if(!sec)return;const cur=sec.querySelector('.iv-cur'),out=sec.querySelector('.iv-ro');
  if(cur)cur.hidden=true;if(out)out.textContent=out.dataset.hint||''}
 function ivPoint(e){const plot=e.target.closest&&e.target.closest('.iv-plot');if(!plot)return;
  if(e.type==='pointermove'&&e.pointerType!=='mouse'&&!e.buttons)return;
  const ch=plot.querySelector('.chart'),o=ivModel();if(!ch||!o||!o.md)return;const b=ch.getBoundingClientRect();if(!b.width)return;
  ivRead(DeckInvest.nearest(o.md,(e.clientX-b.left)/b.width))}
 function bind(el){if(IV.bound===el)return;IV.bound=el;
  el.addEventListener('click',e=>{const mb=e.target.closest('button[data-ivmore]');
   if(mb){const k=mb.dataset.ivmore,less=!!mb.dataset.less;IV.view[k]=less?DeckInvest.SHORT[k]:IV.view[k]+DeckInvest.STEP[k];ivPaint();
    // Show fewer: the section stays in its column (the plan is the closed one) and its title comes back into view
    if(less&&typeof DeckBalance!=='undefined'){const s=el.querySelector('button[data-ivmore="'+k+'"]');if(s&&s.closest('.sect'))DeckBalance.fewer(s.closest('.sect'))}return}
   const rg=e.target.closest('button[data-ivrng]');if(rg){if(rg.disabled)return;const k=rg.dataset.ivrng;IV.view.rng=k;savePick();const sec=ivChart();
    const n=sec&&sec.querySelector('[data-ivrng="'+k+'"]');if(n)n.focus({preventScroll:true});return}
   const sl=e.target.closest('[data-ivsel]');if(sl){ivSelect(sl.dataset.ivsel);return}
   const rt=e.target.closest('button[data-retry="money/markets"]');if(rt){load(false,true);return}
   const b=e.target.closest('button[data-act]');if(!b||b.disabled)return;
   if(b.dataset.act==='hide')ICTL.hide();else if(b.dataset.act==='reveal'&&!tvArm(b,IV.ctx))ICTL.reveal()});
  el.addEventListener('input',e=>{if(e.target.matches&&e.target.matches('.iv-scrub'))ivRead(+e.target.value)});
  el.addEventListener('focusin',e=>{if(e.target.matches&&e.target.matches('.iv-scrub'))ivRead(+e.target.value)});
  el.addEventListener('focusout',e=>{if(e.target.matches&&e.target.matches('.iv-scrub'))ivUnread()});
  el.addEventListener('pointerdown',ivPoint);el.addEventListener('pointermove',ivPoint);
  // pointerleave does not bubble: the capture listener sees one per element left, so only leaving the plot itself counts
  el.addEventListener('pointerleave',e=>{const t=e.target;if(t.classList&&t.classList.contains('iv-plot')&&!t.contains(document.activeElement))ivUnread()},true);
  el.addEventListener('pointercancel',()=>ivUnread())}
 async function load(tick,force){if(IV.busy||(tick&&!force&&Date.now()-IV.at<60000))return;IV.busy=true;IV.at=Date.now();
  for(const k of ['m','p','t','tr'])if(IV[k]===null)IV.st[k]='loading';
  ivPaint();
  const slow=setTimeout(()=>{for(const k of ['m','p','t','tr'])if(IV.st[k]==='loading')IV.st[k]='slow';ivPaint()},DeckInvest.SLOW_MS);
  // the last good markets feed stays in memory: a failed refresh keeps it, marked out of date, instead of blanking the board
  const keep=(k,f)=>{IV[k]=f&&!f.error?f:IV[k]&&!IV[k].error?Object.assign({},IV[k],{stale:true}):f;IV.st[k]='done';ivPaint()};
  try{await Promise.all([ivGet('markets').then(f=>keep('m',f)),ivGet('portfolio').then(f=>keep('p',f)),ivGet('today').then(f=>keep('t',f)),ivGet('trends').then(f=>keep('tr',f||{error:'no answer'}))])}
  finally{clearTimeout(slow);IV.busy=false}}
 DeckPages.register('money/markets',{
  show(ctx){IV.ctx=ctx;bind(ctx.el);ivPaint();load(false);
   // a rotation or resize that changes the class repaints: the board's markup follows the class (phones stack, a laptop has two columns)
   if(!IV.offCls&&typeof DeckPages.onClass==='function')IV.offCls=DeckPages.onClass(d=>{if(IV.ctx&&d&&d.cls!==d.prev)ivPaint()})},
  refresh(ctx,tick){IV.ctx=ctx;load(tick)},
  hide(){ICTL.hide()},
  data(){return DeckInvest.data(IV.m,IV.p,IV.t,Date.now(),IV.tr||undefined)}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)ICTL.hide()});
 addEventListener('pagehide',()=>ICTL.hide());
 // one-second tick: expire a reveal even if a timer was throttled, hide in ambient mode, keep the countdown honest without repainting
 setInterval(()=>{const v=ICTL.view();if(v.vals===null)return;
  if(typeof mode!=='undefined'&&mode==='ambient'){ICTL.hide();return}
  if(ICTL.sweep())return;
  const now=Date.now();if(IV.ctx&&IV.ctx.el)IV.ctx.el.querySelectorAll('.fcd[data-exp]').forEach(el=>{el.textContent=DeckInvest.fcd(+el.dataset.exp,now)})},1000);
}
