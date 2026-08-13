// The desk page: one server-rendered shell, client-rendered case state
// over SSE. Styled ENTIRELY with the Halden house tokens (assets/
// halden.css — the founder-approved brand sheet, inlined verbatim);
// the page CSS below only composes those tokens into a layout.
//
// The composition is a CASE FILE, not a dashboard: one case, one
// centered column, read top to bottom as a story —
//
//   letterhead + progression spine        (the only persistent status)
//   I   · The demand      — identifiers (claim reference, loss date),
//                           the full letter folded away; no pack URLs
//                           anywhere a human sees
//   II  · The request     — the evidence-request form (what records,
//                           which claim, what window), or the filed
//                           request once one is on the case
//   III · The evidence    — one line per located record; grey until
//                           convinced, the circle fills verdigris
//   IV  · The review      — the agent's steps, one line each,
//                           expandable, one open at a time
//   V   · The position    — the decision chip and the letter itself,
//                           real correspondence, the page's payoff
//
// The design law is the brand's: grey until convinced; nothing pulses,
// nothing is rounded, and the only ceremony is the verdigris seal
// beside a record that has verified.

// The compact seal (the 1908 inspection stamp, console-chrome variant
// from the identity specimen). Inline SVG, single currentColor: in
// spruce ink it is the company; in verdigris it is the stamp of assent.
const SEAL_SVG =
  '<svg class="hl-seal" viewBox="0 0 120 120" aria-hidden="true">' +
  '<circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="1.6 3.11"/>' +
  '<circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
  '<text x="60" y="76" text-anchor="middle" font-family="Optima, Candara, sans-serif" font-weight="500" font-size="46" fill="currentColor">H</text>' +
  "</svg>";

const PAGE_CSS = String.raw`
/* ---- the case file: one column, composed from hl-* tokens only ---------- */
main { max-width: 720px; margin: 0 auto; padding: 34px 24px 80px; }
.dim { color: var(--hl-muted); }

/* chrome: switcher + theme control recede into the top corner */
.hl-header { padding: 12px 24px; flex-wrap: wrap; gap: 8px; align-items: center; }
.hl-header .right { display: flex; align-items: stretch; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.hl-header .hl-btn.ghost { padding: 4px 10px; font-size: 11.5px; border-color: var(--hl-line); }
.case-menu { position: relative; }
.case-menu > summary {
  list-style: none; cursor: pointer;
  display: inline-flex; align-items: baseline; gap: 7px;
  border: 1px solid var(--hl-line); background: var(--hl-sheet);
  padding: 5px 10px; height: 100%;
}
.case-menu > summary::-webkit-details-marker { display: none; }
.case-menu > summary::after { content: "\25BE"; font-size: 9px; color: var(--hl-muted); }
.case-menu .menu {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 10;
  min-width: 240px; background: var(--hl-sheet); border: 1px solid var(--hl-line);
}
.mi {
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
  width: 100%; text-align: left; font: inherit; font-size: 12px; color: var(--hl-ink);
  background: none; border: none; border-top: 1px solid var(--hl-line);
  padding: 8px 12px; cursor: pointer;
}
.mi:first-child { border-top: none; }
.mi:hover { background: var(--hl-field); }
.mi.on { background: var(--hl-slate-tint); }

/* letterhead */
.lh { margin-top: 16px; }
.lh .fileref {
  font-family: var(--hl-display); font-weight: 500; font-size: 19px;
  letter-spacing: 0.18em; text-transform: uppercase;
}
.lh .parties { margin-top: 10px; font-size: 14px; }
.lh .parties .arr { color: var(--hl-muted); padding: 0 3px; }
.lh .lmeta { margin-top: 4px; font-size: 12px; color: var(--hl-muted); }

/* the progression spine — the page's only persistent status element.
   The same circle law as the evidence: hollow until earned, then filled. */
.spine { display: grid; grid-template-columns: repeat(4, 1fr); margin: 36px 0 0; }
.spine .st { position: relative; text-align: center; }
.spine .st::before {
  content: ""; position: absolute; top: 4.5px; left: 0; right: 0;
  border-top: 1px solid var(--hl-line);
}
.spine .st:first-child::before { left: 50%; }
.spine .st:last-child::before { right: 50%; }
.spine .dot {
  position: relative; z-index: 1; display: inline-block;
  width: 9px; height: 9px; border-radius: 50%;
  border: 1px solid var(--hl-line); background: var(--hl-field);
}
.spine .slbl {
  display: block; margin-top: 8px; font-size: 9.5px;
  text-transform: uppercase; letter-spacing: 0.11em; color: var(--hl-muted);
}
.spine .st.done .dot { border-color: var(--hl-verdigris); background: var(--hl-verdigris); }
.spine .st.done .slbl { color: var(--hl-verdigris-deep); }
.spine .st.now .dot { border-color: var(--hl-slate); }
.spine .st.now .slbl { color: var(--hl-ink); font-weight: 600; }
.spine .st.err .dot { border-color: var(--hl-madder); background: var(--hl-field); }
.spine .st.err .slbl { color: var(--hl-madder); }

/* acts: an eyebrow over a hairline, then air — no boxes */
.act { margin-top: 48px; }
.act-label {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  border-bottom: 1px solid var(--hl-line); padding-bottom: 7px;
}
.act-label .hl-label:first-child { white-space: nowrap; }
.act-body { margin-top: 14px; }

/* I — the demand docket */
.drow { display: flex; gap: 18px; align-items: baseline; padding: 7px 0; }
.drow .dk {
  flex: none; width: 84px; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.12em; color: var(--hl-muted);
}
.drow .dv { flex: 1; min-width: 0; font-size: 13.5px; }
.drow .dv .hl-amount { font-size: 16px; }
details.reveal { margin-top: 14px; }
details.reveal > summary {
  list-style: none; display: inline-block; cursor: pointer;
  font-size: 12px; color: var(--hl-verdigris-deep);
}
details.reveal > summary::-webkit-details-marker { display: none; }
details.reveal > summary::before { content: "\25B8\00A0"; font-size: 10px; }
details.reveal[open] > summary::before { content: "\25BE\00A0"; }
.inletter {
  margin-top: 12px; background: var(--hl-sheet); border: 1px solid var(--hl-line);
  padding: 26px 30px; font-family: var(--hl-serif); font-size: 14px; line-height: 1.65;
  white-space: pre-wrap; overflow-wrap: anywhere;
}

/* II — the request: the evidence-request form, in the docket's grid */
.rq .dv input, .filing .fmeta input {
  font: inherit; font-size: 13px; color: var(--hl-ink);
  background: var(--hl-sheet); border: 1px solid var(--hl-line);
  border-radius: 0; padding: 6px 9px;
}
.rq .dv input { font-family: var(--hl-mono); font-size: 12px; }
.rq input#rq-claim { width: 220px; max-width: 100%; }
.rq .win { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.rq .win .to { font-size: 12px; color: var(--hl-muted); }
.rq .kopt { display: flex; gap: 9px; align-items: center; padding: 3px 0; font-size: 13px; }
.rq .kopt input { accent-color: var(--hl-verdigris); margin: 0; }
.rq .frow { margin-top: 14px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.rq .fnote { font-size: 12px; color: var(--hl-muted); }
.rq .fnote.err { color: var(--hl-madder); }
.rqnote { margin-top: 4px; padding: 8px 0 10px; font-size: 13px; color: var(--hl-madder); }
[data-theme="dark"] .rq .dv input[type="date"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .rq .dv input[type="date"] { color-scheme: dark; }
}

/* III — the evidence check: one quiet line per pack */
.packline { display: flex; gap: 11px; align-items: baseline; padding: 10px 0; }
.packline + .packline { border-top: 1px solid var(--hl-line); }
.packline .pmark { flex: none; }
.packline .pmark::before { margin-right: 0; }
.hl-offered::before {
  content: ""; display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; margin-right: 6px; vertical-align: 1px;
  border: 1px solid var(--hl-line); background: transparent;
}
/* the third state of the examination circle: filled madder on failure */
.hl-failed::before {
  content: ""; display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; margin-right: 6px; vertical-align: 1px;
  border: 1px solid var(--hl-madder); background: var(--hl-madder);
}
.packline .pbody { flex: 1; min-width: 0; }
.packline .pline { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
.packline .pline .hl-ref { overflow-wrap: anywhere; }
.pverdict.ok { color: var(--hl-verdigris-deep); }
.pverdict.bad { color: var(--hl-madder); }
.pverdict.wait { color: var(--hl-slate); }
.pverdict.idle { color: var(--hl-muted); }
.psub { margin-top: 3px; font-size: 11px; color: var(--hl-muted); overflow-wrap: anywhere; }

/* IV — the review: one line per step, expandable, one open at a time */
.review details.step { border-top: 1px solid var(--hl-line); }
.review details.step:first-child { border-top: none; }
.review details.step > summary {
  list-style: none; display: flex; gap: 12px; align-items: baseline;
  padding: 7px 0; cursor: pointer; font-size: 12.5px;
}
.review details.step > summary::-webkit-details-marker { display: none; }
.step .at { flex: none; width: 58px; font-family: var(--hl-mono); font-size: 11px; color: var(--hl-muted); }
.step .one { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.step[open] > summary .one { white-space: normal; overflow: visible; text-overflow: clip; }
.step .stepbody { padding: 0 0 10px 70px; }
.step .stepmeta { font-size: 10.5px; color: var(--hl-muted); }
.step.k-record > summary .one, .step.k-record > summary .at { color: var(--hl-muted); }
.step.k-blocked > summary .one, .step.k-error > summary .one { color: var(--hl-madder); }
.deny {
  flex: none; align-self: center; font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--hl-madder); border: 1px solid var(--hl-madder);
  padding: 1px 5px;
}
.logline { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; font-size: 11.5px; color: var(--hl-muted); }
.logline .hl-ref { font-size: 11.5px; color: var(--hl-ink); }

/* V — the position: the chip, then the letter itself */
.chiprow { display: flex; gap: 12px; align-items: baseline; font-size: 12px; }
.letter-sheet {
  margin-top: 16px; background: var(--hl-sheet); border: 1px solid var(--hl-line);
  padding: 34px 38px 30px;
}
.letter-sheet .hl-rule { border-top-color: var(--hl-chrome-ink); margin-bottom: 18px; }
.letter-ref { font-family: var(--hl-mono); font-size: 11px; color: var(--hl-muted); margin-bottom: 18px; }
.letter-sign { margin-top: 2em; display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
.letter-sign .lines { font-family: var(--hl-serif); font-size: 14px; line-height: 1.5; }
.letter-sign .hl-seal { width: 56px; height: 56px; flex: none; color: var(--hl-chrome-ink); }
.letter-date { margin-top: 12px; font-family: var(--hl-mono); font-size: 11px; color: var(--hl-muted); }

/* the filing form — the counterparty seam (POST /file-demand), driven
   from the page on hosted desks; hidden until asked for */
.filing { margin-top: 28px; }
.filing textarea, .filing input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--hl-ink); background: var(--hl-sheet);
  border: 1px solid var(--hl-line); border-radius: 0; padding: 8px 10px;
}
.filing textarea {
  font-family: var(--hl-serif); line-height: 1.55;
  min-height: 150px; resize: vertical;
}
.filing .fmeta { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.filing .fmeta input { flex: 1; min-width: 180px; font-family: var(--hl-mono); font-size: 11.5px; }
.filing .frow { margin-top: 12px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.filing .fnote { font-size: 12px; color: var(--hl-muted); }
.filing .fnote.err { color: var(--hl-madder); }

.empty { padding: 90px 0; color: var(--hl-muted); font-size: 13px; text-align: center; }
footer { max-width: 720px; margin: 0 auto; padding: 0 24px 30px; }
footer span + span::before { content: " \00B7 "; }

@media (max-width: 640px) {
  main { padding: 24px 16px 64px; }
  .hl-header { padding: 10px 16px; }
  footer { padding: 0 16px 26px; }
  .lh .fileref { font-size: 16px; }
  .drow { flex-direction: column; gap: 2px; }
  .drow .dk { width: auto; }
  .step .at { width: 48px; font-size: 10px; }
  .step .stepbody { padding-left: 0; }
  .act-label .hl-label + .hl-label { display: none; }
  .inletter { padding: 18px 16px; }
  .letter-sheet { padding: 22px 18px 20px; }
  .spine .slbl { font-size: 8.5px; letter-spacing: 0.08em; }
}
`;

// The client program. Kept as raw text (no template interpolation): the
// few server-known values (seal, insured, policy) are prepended below.
const CLIENT_MAIN = String.raw`
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function hhmm(at){try{return new Date(at).toISOString().slice(11,19)+'Z';}catch(e){return '';}}
function ymd(at){try{return new Date(at).toISOString().slice(0,10);}catch(e){return '';}}

/* ---- Act I: best-effort key lines out of the letter, with fallbacks ---- */
function parseDemand(text){
  var out={claimant:null,subrogee:false,re:null,amount:null,basis:null};
  var m=text.match(/^Re:\s*(.+)$/m); if(m)out.re=m[1].trim();
  m=text.match(/\$[0-9][0-9,]*(?:\.[0-9][0-9])?/); if(m)out.amount=m[0];
  m=text.match(/^(.{2,60}?),\s*as subrogee/m);
  if(m){out.claimant=m[1].trim();out.subrogee=true;}
  if(!out.claimant){m=text.match(/^([A-Z][A-Za-z&.'\- ]{2,50}?)\s+demands/m);if(m)out.claimant=m[1].trim();}
  if(!out.claimant){m=text.match(/^([A-Z][A-Za-z&.'\- ]{2,50}?)\s+—\s+Recovery/m);if(m)out.claimant=m[1].trim();}
  m=text.match(/Basis:\s*([\s\S]*?)(?:\n\s*\n|$)/);
  if(m){
    var b=m[1].replace(/\s+/g,' ').trim();
    var parts=b.split(/(?<=\.)\s+/),pick=null,i;
    for(i=0;i<parts.length;i++){if(/caus|negligen|identif|liab/i.test(parts[i])){pick=parts[i];break;}}
    if(!pick)pick=parts[0]||b;
    if(pick.length>320)pick=pick.slice(0,317)+'…';
    out.basis=pick;
  }
  return out;
}

function letterheadHtml(c,p){
  var who=p.claimant?esc(p.claimant):'Inward claimant';
  return '<div class="lh"><div class="fileref">File '+esc(c.fileRef)+'</div>'+
    '<div class="parties">'+who+' <span class="arr">→</span> Halden Indemnity</div>'+
    '<div class="lmeta">Insured '+esc(INSURED)+' · Policy <span class="hl-ref">'+esc(POLICY)+'</span>'+
    ' · received <span class="hl-ref">'+esc(ymd(c.receivedAt))+' '+esc(hhmm(c.receivedAt))+'</span></div></div>';
}

/* Received(0) -> Verified(1) -> Under review(2) -> Position stated(3); 4 = all done */
function stageOf(c){
  if(c.status==='concluded'||c.letter!==null||c.decision!==null)return 4;
  if(c.status==='received')return 0;
  var pend=false,i;
  for(i=0;i<c.packs.length;i++){var st=c.packs[i].status;if(st==='offered'||st==='examining')pend=true;}
  if(c.packs.length&&pend)return 1;
  return 2;
}
function spineHtml(c){
  var names=['Received','Verified','Under review','Position stated'];
  var cur=stageOf(c),err=c.status==='error',html='<div class="spine" aria-label="Case progression">',i;
  for(i=0;i<4;i++){
    var cls=i<cur?'done':(i===cur?'now':'todo');
    if(err&&i===cur)cls+=' err';
    html+='<div class="st '+cls+'"><span class="dot"></span><span class="slbl">'+names[i]+'</span></div>';
  }
  return html+'</div>';
}

function actOpen(num,label,meta){
  return '<section class="act"><div class="act-label"><span class="hl-label">'+num+' · '+label+'</span>'+
    (meta?'<span class="hl-label">'+meta+'</span>':'')+'</div><div class="act-body">';
}
function drow(k,v){return '<div class="drow"><span class="dk">'+k+'</span><span class="dv">'+v+'</span></div>';}

function demandActHtml(c,p){
  var html=actOpen('I','The demand','as received');
  if(p.amount||p.re||p.claimant){
    if(p.claimant)html+=drow('From',esc(p.claimant)+(p.subrogee?' <span class="dim">as subrogee of its insured</span>':''));
    if(p.amount)html+=drow('Demand','<span class="hl-amount">'+esc(p.amount)+'</span>'+(p.re?' <span class="dim">— '+esc(p.re)+'</span>':''));
    if(p.basis)html+=drow('Basis',esc(p.basis));
  }else{
    var lines=c.demandText.split('\n').filter(function(l){return l.trim()!=='';}).slice(0,3);
    html+=drow('Letter',esc(lines.join(' · ')));
  }
  if(c.claimRef)html+=drow('Claim','<span class="hl-ref">'+esc(c.claimRef)+'</span>');
  if(c.lossDate)html+=drow('Loss date','<span class="hl-ref">'+esc(c.lossDate)+'</span>');
  html+='<details class="reveal" data-k="demand-full"><summary>Read the full letter</summary>'+
    '<div class="inletter">'+esc(c.demandText)+'</div></details>';
  return html+'</div></section>';
}

/* ---- Act II: the evidence request — the form, or the request as filed --- */
function kindLabel(id){
  for(var i=0;i<KINDS.length;i++)if(KINDS[i].id===id)return KINDS[i].label;
  return id;
}
function addDaysIso(at,days){
  var t=new Date(at);t.setUTCDate(t.getUTCDate()+days);
  return t.toISOString().slice(0,10);
}
function requestFormHtml(claim,since,until,checked,btn){
  var html='<div class="rq">'+
    drow('Claim','<input id="rq-claim" value="'+esc(claim)+'" placeholder="CLM-…" aria-label="Claim reference">')+
    drow('Window','<span class="win"><input id="rq-since" type="date" value="'+esc(since)+'" aria-label="Records since">'+
      '<span class="to">to</span>'+
      '<input id="rq-until" type="date" value="'+esc(until)+'" aria-label="Records until"></span>');
  var kinds='';
  for(var i=0;i<KINDS.length;i++){
    var k=KINDS[i],on=checked.indexOf(k.id)!==-1;
    kinds+='<label class="kopt"><input type="checkbox" id="rq-k-'+esc(k.id)+'" value="'+esc(k.id)+'"'+(on?' checked':'')+'> The '+esc(k.label)+'</label>';
  }
  html+=drow('Records',kinds);
  html+='<div class="frow"><button class="hl-btn" id="rq-send" type="button">'+esc(btn)+'</button>'+
    '<span class="fnote" id="rq-note"></span></div></div>';
  return html;
}
function requestSummaryHtml(r){
  var labels=[],i;
  for(i=0;i<r.kinds.length;i++)labels.push('the '+kindLabel(r.kinds[i]));
  return drow('Claim','<span class="hl-ref">'+esc(r.claimRef)+'</span>')+
    drow('Window','<span class="hl-ref">'+esc(r.since)+'</span> <span class="dim">to</span> <span class="hl-ref">'+esc(r.until)+'</span>')+
    drow('Records',esc(labels.join(', ')))+
    drow('Requested','<span class="hl-ref">'+esc(ymd(r.requestedAt))+' '+esc(hhmm(r.requestedAt))+'</span>');
}
function requestActHtml(c){
  var r=c.request;
  if(!r&&c.packs.length){
    var html=actOpen('II','The request','superseded');
    html+=drow('Records','<span class="dim">Evidence accompanied the demand as filed (deprecated path); no request was needed.</span>');
    return html+'</div></section>';
  }
  if(r&&c.packs.length){
    var done=actOpen('II','The request','as filed');
    done+=requestSummaryHtml(r);
    done+=drow('Located',String(r.located)+' record'+(r.located===1?'':'s'));
    return done+'</div></section>';
  }
  var defClaim=c.claimRef||'',defSince=c.lossDate||addDaysIso(c.receivedAt,-30),defUntil=ymd(new Date().toISOString());
  var defKinds=[],i;
  for(i=0;i<KINDS.length;i++)defKinds.push(KINDS[i].id);
  if(r){
    var back=actOpen('II','The request','as filed');
    back+=requestSummaryHtml(r);
    back+=(r.located===0
      ?'<div class="rqnote">No records were located for that reference and window. Nothing is examined.</div>'
      :'<div class="rqnote">The request did not resolve; the records service could not be read.</div>');
    back+=requestFormHtml(r.claimRef,r.since,r.until,r.kinds,'Refile the request');
    return back+'</div></section>';
  }
  var open=actOpen('II','The request','the records are requested, not attached');
  open+=requestFormHtml(defClaim,defSince,defUntil,defKinds,'Request the evidence');
  return open+'</div></section>';
}

function packLine(p){
  var mark,verdict,vcls,sub='';
  if(p.status==='verified'){
    mark='hl-attested';vcls='ok';
    verdict=String(p.recordsVerified)+' of '+String(p.recordsVerified+p.recordsFailed)+' records verify';
    var bits=[];
    if(p.specVersion)bits.push(esc(p.specVersion));
    if(p.kernel)bits.push(esc(p.kernel));
    if(p.checkpointTxIds.length)bits.push('checkpoint '+esc(p.checkpointTxIds[0].slice(0,10))+'…');
    sub=bits.join(' · ');
  }else if(p.status==='failed'){
    mark='hl-failed';vcls='bad';
    verdict='does not verify'+(p.errors.length?' — '+esc(p.errors[0]):'');
    sub='What does not verify is not evidence.';
  }else if(p.status==='examining'){
    mark='hl-examining';vcls='wait';verdict='under examination';
  }else{
    mark='hl-offered';vcls='idle';verdict='awaiting examination';
  }
  return '<div class="packline"><span class="pmark '+mark+'"></span><div class="pbody">'+
    '<div class="pline"><span class="hl-ref">'+esc(p.ref)+'</span>'+
    '<span class="pverdict '+vcls+'">'+verdict+'</span></div>'+
    (sub?'<div class="psub">'+sub+'</div>':'')+'</div></div>';
}
function evidenceActHtml(c){
  var html=actOpen('III','The evidence','checked independently of the sender'),i;
  if(!c.packs.length){
    html+='<div class="packline"><span class="pmark hl-offered"></span><div class="pbody">'+
      '<div class="pline"><span class="pverdict idle">No records are on the file. Evidence arrives by request.</span></div></div></div>';
    return html+'</div></section>';
  }
  for(i=0;i<c.packs.length;i++)html+=packLine(c.packs[i]);
  return html+'</div></section>';
}

/* pack verdicts already live in Act II; the review keeps the rest */
function isPackStep(s){
  return s.kind==='tool'&&(/^Evidence pack /.test(s.text)||/ records verify\./.test(s.text)||/verification failed/.test(s.text));
}
function reviewItems(c){
  var items=[],run=null,i;
  for(i=0;i<c.steps.length;i++){
    var s=c.steps[i];
    if(isPackStep(s))continue;
    if(s.kind==='record'){
      if(!run){run={kind:'records',steps:[],key:'r-'+i};items.push(run);}
      run.steps.push(s);continue;
    }
    run=null;
    items.push({kind:'step',step:s,key:'s-'+i});
  }
  return items;
}
function stepHtml(it){
  var s=it.step;
  var chip=s.kind==='blocked'?'<span class="deny">denied</span>':(s.kind==='error'?'<span class="deny">error</span>':'');
  return '<details class="step k-'+esc(s.kind)+'" data-k="'+it.key+'"><summary>'+
    '<span class="at">'+esc(hhmm(s.at))+'</span><span class="one">'+esc(s.text)+'</span>'+chip+'</summary>'+
    '<div class="stepbody"><div class="stepmeta">'+esc(s.kind)+' · '+esc(s.at)+'</div></div></details>';
}
function recordsHtml(it){
  var n=it.steps.length,body='',i;
  for(i=0;i<n;i++){
    var m=it.steps[i].text.match(/Logbook:\s*(\S+) committed \(seq (\d+)\)/);
    body+='<div class="logline">'+(m
      ?'<span class="hl-ref">'+esc(m[1])+'</span><span>seq '+esc(m[2])+'</span>'
      :'<span>'+esc(it.steps[i].text)+'</span>')+'</div>';
  }
  return '<details class="step k-record" data-k="'+it.key+'"><summary>'+
    '<span class="at">'+esc(hhmm(it.steps[0].at))+'</span>'+
    '<span class="one">Committed to the desk logbook — '+String(n)+' signed record'+(n===1?'':'s')+'.</span></summary>'+
    '<div class="stepbody">'+body+'</div></details>';
}
function reviewActHtml(items){
  var html=actOpen('IV','The review',''),i;
  html+='<div class="review">';
  for(i=0;i<items.length;i++)html+=items[i].kind==='records'?recordsHtml(items[i]):stepHtml(items[i]);
  return html+'</div></div></section>';
}

function decisionChip(d){
  var t=esc(d);
  if(d==='ACCEPT')return '<span class="hl-badge paid">'+t+'</span>';
  if(d==='DISPUTE')return '<span class="hl-badge disputed">'+t+'</span>';
  if(d==='REQUEST-MORE')return '<span class="hl-badge review">'+t+'</span>';
  return '<span class="hl-badge verified">'+t+'</span>';
}
function positionHtml(c){
  if(!c.decision&&!c.letter)return '';
  var html=actOpen('V','The position','as filed');
  if(c.decision){
    html+='<div class="chiprow">'+decisionChip(c.decision.decision)+
      (c.letter?'<span class="dim">position committed by '+esc(c.letter.positionBy)+'</span>':'')+'</div>';
  }
  if(c.letter){
    var lines=c.letter.text.split('\n');
    var ref=lines.length&&lines[0].indexOf('RE ')===0?lines.shift():'';
    while(lines.length&&lines[0].trim()==='')lines.shift();
    var sig=[];
    while(lines.length&&lines[lines.length-1].trim()!=='')sig.unshift(lines.pop());
    var paras=lines.join('\n').split(/\n\s*\n/).filter(function(x){return x.trim()!=='';});
    var body='',i;
    for(i=0;i<paras.length;i++)body+='<p>'+esc(paras[i].trim())+'</p>';
    html+='<div class="letter-sheet"><div class="hl-rule"></div>'+
      (ref?'<div class="letter-ref">'+esc(ref)+'</div>':'')+
      '<div class="hl-letter">'+body+
      '<div class="letter-sign"><div><div class="lines">'+sig.map(esc).join('<br>')+'</div>'+
      '<div class="letter-date">Filed '+esc(ymd(c.letter.filedAt))+'</div></div>'+SEAL+'</div>'+
      '</div></div>';
  }
  return html+'</div></section>';
}

/* ---- render: rebuild the column, preserve which folds are open --------- */
var sel=null,list=[],cur=null;
var RQ_FIELDS=['rq-claim','rq-since','rq-until'];
function render(c){
  var sameCase=cur!==null&&c!==null&&cur.fileRef===c.fileRef;
  cur=c;
  var el=document.getElementById('desk');
  var open={},keep={},checks={},focusId=null,i;
  if(sameCase){
    var od=el.querySelectorAll('details[open]');
    for(i=0;i<od.length;i++){var k=od[i].getAttribute('data-k');if(k)open[k]=1;}
    /* a live update must not clobber what the human is typing into the
       request form: carry field values, checkboxes, and focus across */
    for(i=0;i<RQ_FIELDS.length;i++){
      var f=document.getElementById(RQ_FIELDS[i]);
      if(f)keep[RQ_FIELDS[i]]=f.value;
    }
    var cbs=el.querySelectorAll('.rq input[type=checkbox]');
    for(i=0;i<cbs.length;i++)checks[cbs[i].id]=cbs[i].checked;
    if(document.activeElement&&document.activeElement.id&&el.contains(document.activeElement))focusId=document.activeElement.id;
  }
  if(!c){
    el.innerHTML='<div class="empty">No demand is on file. Meridian’s demand arrives with “Incoming demand” (top right); a counterparty files its own with <span class="hl-ref">POST /file-demand</span>.</div>';
    updateMenu();return;
  }
  var p=parseDemand(c.demandText);
  var html=letterheadHtml(c,p)+spineHtml(c)+demandActHtml(c,p)+requestActHtml(c)+evidenceActHtml(c);
  var items=reviewItems(c);
  if(items.length)html+=reviewActHtml(items);
  html+=positionHtml(c);
  el.innerHTML=html;
  for(var key in open){
    var d=el.querySelector('details[data-k="'+key+'"]');
    if(d)d.open=true;
  }
  for(var kf in keep){
    var fld=document.getElementById(kf);
    if(fld)fld.value=keep[kf];
  }
  for(var kc in checks){
    var cb=document.getElementById(kc);
    if(cb)cb.checked=checks[kc];
  }
  if(focusId){var fo=document.getElementById(focusId);if(fo)fo.focus();}
  updateMenu();
}

/* ---- the case switcher (top corner) ------------------------------------ */
function summarize(c){return {fileRef:c.fileRef,receivedAt:c.receivedAt,status:c.status,decision:c.decision?c.decision.decision:null};}
function upsert(c){
  var s=summarize(c),i;
  for(i=0;i<list.length;i++){if(list[i].fileRef===s.fileRef){list[i]=s;return;}}
  list.push(s);
  list.sort(function(a,b){return a.receivedAt<b.receivedAt?-1:1;});
}
function updateMenu(){
  document.getElementById('cm-cur').textContent=cur?cur.fileRef:'no case on file';
  var out='<button class="mi'+(sel===null?' on':'')+'" data-file=""><span>Follow the latest case</span></button>',i;
  for(i=list.length-1;i>=0;i--){
    var e=list[i];
    out+='<button class="mi'+(sel===e.fileRef?' on':'')+'" data-file="'+esc(e.fileRef)+'">'+
      '<span class="hl-ref">'+esc(e.fileRef)+'</span>'+
      '<span class="dim">'+esc((e.decision||e.status).toLowerCase())+'</span></button>';
  }
  document.getElementById('cm-list').innerHTML=out;
}
function fetchCase(q){
  fetch('/case.json'+q).then(function(r){return r.ok?r.json():null;}).then(function(c){
    if(c){upsert(c);render(c);}else if(q===''){render(null);}
  }).catch(function(){});
}
document.getElementById('cm-list').addEventListener('click',function(ev){
  var b=ev.target.closest('button.mi');
  if(!b)return;
  document.getElementById('cm').open=false;
  var f=b.getAttribute('data-file');
  if(f===''){sel=null;fetchCase('');}
  else{sel=f;fetchCase('?file='+encodeURIComponent(f));}
});
document.addEventListener('click',function(ev){
  var cm=document.getElementById('cm');
  if(cm.open&&!cm.contains(ev.target))cm.open=false;
});

/* ---- filing: the counterparty seam, driven from the page --------------- */
/* Hosted desks gate POST /file-demand (the one endpoint that starts a
   paid examination) behind a passcode; GET /gate is the cheap
   preflight. The key is asked for once and kept for the tab session
   (sessionStorage), the same prompt-once flow as the Workbench. */
function deskKey(){try{return sessionStorage.getItem('halden-demo-key')||'';}catch(e){return '';}}
function keepKey(k){try{sessionStorage.setItem('halden-demo-key',k);}catch(e){}}
function gateCheck(k){
  return fetch('/gate'+(k?'?key='+encodeURIComponent(k):''))
    .then(function(r){return r.status===204;})
    .catch(function(){return false;});
}
function ensureKey(){
  var key=deskKey();
  return gateCheck(key).then(function(ok){
    if(ok)return key;
    var entered=window.prompt('Demo passcode');
    if(entered===null)return null;
    return gateCheck(entered).then(function(ok2){
      if(!ok2){window.alert("That passcode wasn't accepted.");return null;}
      keepKey(entered);
      return entered;
    });
  });
}
var filing=document.getElementById('filing');
function note(t,err){
  var n=document.getElementById('fd-note');
  n.textContent=t;n.className='fnote'+(err?' err':'');
}
document.getElementById('file-toggle').addEventListener('click',function(){
  filing.hidden=!filing.hidden;
  if(!filing.hidden)document.getElementById('fd-text').focus();
});
document.getElementById('fd-send').addEventListener('click',function(){
  var text=document.getElementById('fd-text').value.trim();
  if(text===''){note('A demand letter is required.',true);return;}
  var claim=document.getElementById('fd-claim').value.trim();
  var loss=document.getElementById('fd-loss').value.trim();
  var payload={demandText:text};
  if(claim!=='')payload.claimRef=claim;
  if(loss!=='')payload.lossDate=loss;
  note('Filing…',false);
  ensureKey().then(function(key){
    if(key===null){note('Not filed.',true);return;}
    var headers={'Content-Type':'application/json'};
    if(key!=='')headers['x-demo-key']=key;
    fetch('/file-demand',{method:'POST',headers:headers,
      body:JSON.stringify(payload)})
      .then(function(r){
        return r.json().then(function(b){return {status:r.status,body:b};})
          .catch(function(){return {status:r.status,body:null};});
      })
      .then(function(res){
        if(res.status===401){keepKey('');note('The desk declined the passcode.',true);return;}
        if(res.status!==202){
          note('HTTP '+res.status+(res.body&&res.body.error?' — '+res.body.error:''),true);
          return;
        }
        note('File '+res.body.fileRef+' opened.',false);
        sel=null; /* follow the new case as the stream reports it */
        document.getElementById('fd-text').value='';
        document.getElementById('fd-claim').value='';
        document.getElementById('fd-loss').value='';
        filing.hidden=true;
      })
      .catch(function(){note('The desk could not be reached.',true);});
  });
});

/* ---- the incoming demand: pull Meridian's letter, server-side ---------- */
/* The button does what the handoff script does — the desk fetches the
   newest recovery demand from the Workbench and opens the case
   identifier-only. No terminal required. */
(function(){
  var btn=document.getElementById('fetch-demand');
  var label=btn.textContent;
  function done(msg){btn.disabled=false;btn.textContent=label;if(msg)window.alert(msg);}
  btn.addEventListener('click',function(){
    btn.disabled=true;btn.textContent='Fetching the demand…';
    ensureKey().then(function(key){
      if(key===null){done();return;}
      var headers={};
      if(key!=='')headers['x-demo-key']=key;
      fetch('/fetch-demand',{method:'POST',headers:headers})
        .then(function(r){
          return r.json().then(function(b){return {status:r.status,body:b};})
            .catch(function(){return {status:r.status,body:null};});
        })
        .then(function(res){
          if(res.status===401){keepKey('');done('The desk declined the passcode.');return;}
          if(res.status!==202){
            done('The demand could not be fetched'+(res.body&&res.body.error?' — '+res.body.error:'')+'.');
            return;
          }
          sel=null; /* follow the new case as the stream reports it */
          done();
        })
        .catch(function(){done('The desk could not be reached.');});
    });
  });
})();

/* ---- the evidence request: the form submits to /request-evidence ------- */
function rqNote(t,err){
  var n=document.getElementById('rq-note');
  if(n){n.textContent=t;n.className='fnote'+(err?' err':'');}
}
function submitRequest(){
  if(!cur)return;
  var file=cur.fileRef;
  var claim=(document.getElementById('rq-claim').value||'').trim();
  var since=document.getElementById('rq-since').value;
  var until=document.getElementById('rq-until').value;
  var kinds=[],cbs=document.querySelectorAll('.rq input[type=checkbox]'),i;
  for(i=0;i<cbs.length;i++)if(cbs[i].checked)kinds.push(cbs[i].value);
  if(claim===''){rqNote('A claim reference is required.',true);return;}
  if(!since||!until){rqNote('The window needs both dates.',true);return;}
  if(!kinds.length){rqNote('Select at least one record.',true);return;}
  rqNote('Requesting…',false);
  ensureKey().then(function(key){
    if(key===null){rqNote('Not requested.',true);return;}
    var headers={'Content-Type':'application/json'};
    if(key!=='')headers['x-demo-key']=key;
    fetch('/request-evidence',{method:'POST',headers:headers,
      body:JSON.stringify({file:file,claimRef:claim,since:since,until:until,kinds:kinds})})
      .then(function(r){
        return r.json().then(function(b){return {status:r.status,body:b};})
          .catch(function(){return {status:r.status,body:null};});
      })
      .then(function(res){
        if(res.status===401){keepKey('');rqNote('The desk declined the passcode.',true);return;}
        if(res.status===200&&res.body&&res.body.located===0){
          rqNote('No records located.',true);return;
        }
        if(res.status!==202){
          rqNote('HTTP '+res.status+(res.body&&res.body.error?' — '+res.body.error:''),true);
          return;
        }
        rqNote(res.body.located+' record'+(res.body.located===1?'':'s')+' located.',false);
      })
      .catch(function(){rqNote('The desk could not be reached.',true);});
  });
}
document.getElementById('desk').addEventListener('click',function(ev){
  var b=ev.target&&ev.target.closest?ev.target.closest('#rq-send'):null;
  if(b)submitRequest();
});

/* the review's reveal idiom: one record open at a time */
document.addEventListener('toggle',function(ev){
  var d=ev.target;
  if(d.tagName==='DETAILS'&&d.open&&d.closest('.review')){
    var all=document.querySelectorAll('.review details[open]'),i;
    for(i=0;i<all.length;i++){if(all[i]!==d)all[i].open=false;}
  }
},true);

/* ---- theme: day desk / night desk; ?theme= override for review -------- */
function applyTheme(v){
  if(v){document.documentElement.setAttribute('data-theme',v);}
  else{document.documentElement.removeAttribute('data-theme');}
  var dark=v==='dark'||(v!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('theme-toggle').textContent=dark?'Day desk':'Night desk';
}
function initTheme(){
  var v=null;
  try{v=new URLSearchParams(location.search).get('theme');}catch(e){}
  if(v!=='dark'&&v!=='light'){v=null;try{v=localStorage.getItem('halden-theme');}catch(e){}}
  applyTheme(v);
}
document.getElementById('theme-toggle').addEventListener('click',function(){
  var curT=document.documentElement.getAttribute('data-theme');
  var dark=curT==='dark'||(curT!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  var next=dark?'light':'dark';
  try{localStorage.setItem('halden-theme',next);}catch(e){}
  applyTheme(next);
});
initTheme();
render(null);

/* ---- live: the acts appear as they happen ------------------------------ */
fetch('/cases.json').then(function(r){return r.ok?r.json():[];}).then(function(l){
  if(Array.isArray(l)){list=l;updateMenu();}
}).catch(function(){});
var es=new EventSource('/stream');
es.onmessage=function(ev){
  var d;
  try{d=JSON.parse(ev.data);}catch(e){return;}
  if(!d||!('case' in d))return;
  var c=d['case'];
  if(c===null){if(sel===null)render(null);return;}
  upsert(c);
  if(sel===null||c.fileRef===sel)render(c);
  else updateMenu();
};
`;

/**
 * The one page the desk serves. `cssText` is the verbatim contents of
 * assets/halden.css (the approved house sheet); everything else on the
 * page composes its tokens. `insured`/`policyId` are the desk's own
 * schedule facts, shown on the letterhead; `kinds` are the record kinds
 * the evidence-request form offers.
 */
export function renderPageHtml(
  cssText: string,
  opts: {
    insured: string;
    policyId: string;
    kinds: readonly { id: string; label: string }[];
  },
): string {
  const clientJs =
    `var SEAL=${JSON.stringify(SEAL_SVG)};\n` +
    `var INSURED=${JSON.stringify(opts.insured)};\n` +
    `var POLICY=${JSON.stringify(opts.policyId)};\n` +
    `var KINDS=${JSON.stringify(
      opts.kinds.map((k) => ({ id: k.id, label: k.label })),
    )};\n` +
    CLIENT_MAIN;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Halden Indemnity — Inward Claims</title>
<style>
${cssText}
${PAGE_CSS}
</style>
</head>
<body>
<header class="hl-header">
  <span class="hl-wordmark">${SEAL_SVG}Halden Indemnity<span>INWARD CLAIMS</span></span>
  <span class="right">
    <details class="case-menu" id="cm">
      <summary><span id="cm-cur" class="hl-ref">…</span></summary>
      <div class="menu" id="cm-list"></div>
    </details>
    <button class="hl-btn ghost" id="fetch-demand" type="button">Incoming demand — Meridian</button>
    <button class="hl-btn ghost" id="file-toggle" type="button">File a demand</button>
    <button class="hl-btn ghost" id="theme-toggle" type="button">Night desk</button>
  </span>
</header>
<div class="hl-rule"></div>
<main>
  <section class="act filing" id="filing" hidden>
    <div class="act-label"><span class="hl-label">File a demand</span><span class="hl-label">POST /file-demand</span></div>
    <div class="act-body">
      <textarea id="fd-text" placeholder="The demand letter, as issued." aria-label="Demand letter"></textarea>
      <div class="fmeta">
        <input id="fd-claim" placeholder="Claim reference (e.g. CLM-2026-3105)" aria-label="Claim reference">
        <input id="fd-loss" placeholder="Loss date (YYYY-MM-DD)" aria-label="Loss date">
      </div>
      <div class="frow">
        <button class="hl-btn" id="fd-send" type="button">File at the desk</button>
        <span class="fnote" id="fd-note"></span>
      </div>
    </div>
  </section>
  <div id="desk"></div>
</main>
<footer class="hl-fineprint">
  <span>Verified against the public record — independently of the sender.</span>
  <span>Raw record: <a href="/case.json">case</a> · <a href="/cases.json">cases</a> · <a href="/health">desk</a></span>
</footer>
<script>
${clientJs}
</script>
</body>
</html>
`;
}
