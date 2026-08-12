// The desk page: one server-rendered shell, client-rendered case state
// over SSE. Styled ENTIRELY with the Halden house tokens (assets/
// halden.css — the founder-approved brand sheet, inlined verbatim);
// the page CSS below only composes those tokens into a layout. The
// design law is the brand's: grey until convinced — the slate circle
// holds still through examination and fills verdigris exactly when a
// pack verifies; a failure fills madder; nothing pulses, nothing is
// rounded, and the only ceremony is the verdigris seal stamped beside
// a record that has verified.

// The compact seal (the 1908 inspection stamp, console-chrome variant
// from the identity specimen). Inline SVG, single currentColor: in
// spruce ink it is the company; in verdigris it is the stamp of assent.
const SEAL_SVG =
  '<svg class="hl-seal" viewBox="0 0 120 120" aria-hidden="true">' +
  '<circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="1.6 3.11"/>' +
  '<circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
  '<text x="60" y="76" text-anchor="middle" font-family="Optima, Candara, sans-serif" font-weight="500" font-size="46" fill="currentColor">H</text>' +
  "</svg>";

const PAGE_CSS = `
/* ---- desk layout: composed from hl-* tokens only ------------------------ */
main { max-width: 1180px; margin: 0 auto; padding: 22px 20px 40px; }
.desk-grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 940px) { .desk-grid { grid-template-columns: 1fr; } }
section { margin-top: 22px; }
.panel-label { margin-bottom: 8px; display: flex; align-items: baseline; justify-content: space-between; }
.hl-facts { margin: 14px 0 4px; }

.case-strip { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; margin-top: 18px; }
.case-strip .hl-title { letter-spacing: 0.2em; }

.demand-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
.demand-packs { margin-top: 14px; border-top: 1px solid var(--hl-line); padding-top: 10px; }
.demand-packs .hl-ref { display: block; margin-top: 4px; overflow-wrap: anywhere; }

.pack-row { display: flex; gap: 12px; align-items: baseline; padding: 12px 0; }
.pack-row + .pack-row { border-top: 1px solid var(--hl-line); }
.pack-row .pack-main { flex: 1; min-width: 0; }
.pack-row .hl-ref { overflow-wrap: anywhere; }
.pack-verdict { margin-top: 4px; font-size: 12px; }
.pack-detail { margin-top: 3px; font-size: 11px; color: var(--hl-muted); }
.pack-detail .hl-ref { font-size: 11px; }
/* the third state of the examination circle: filled madder on failure */
.hl-failed::before {
  content: ""; display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; margin-right: 6px; vertical-align: 1px;
  border: 1px solid var(--hl-madder); background: var(--hl-madder);
}
.hl-failed { font-size: 12px; color: var(--hl-madder); }
/* the one ceremony: the verdigris seal beside a verified record */
.pack-seal { color: var(--hl-verdigris); flex: none; align-self: center; }
.pack-seal svg { width: 26px; height: 26px; display: block; }

.steps { list-style: none; }
.steps li { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--hl-line); }
.steps li:first-child { border-top: none; }
.steps .at { font-family: var(--hl-mono); font-size: 11px; color: var(--hl-muted); flex: none; padding-top: 1px; }
.steps .txt { font-size: 12.5px; }
.steps li.k-record .txt { color: var(--hl-muted); }
.steps li.k-blocked .txt { color: var(--hl-madder); }
.steps li.k-error .txt { color: var(--hl-madder); }

.letter-wrap { max-width: 700px; }
.letter-wrap .hl-rule { margin-bottom: 14px; }
.letter-ref { font-family: var(--hl-mono); font-size: 11px; color: var(--hl-muted); margin-bottom: 16px; }
.letter-sign { margin-top: 1.6em; display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
.letter-sign .lines { font-family: var(--hl-serif); font-size: 14px; line-height: 1.5; }
.letter-sign .hl-seal { width: 54px; height: 54px; color: var(--hl-spruce); }
[data-theme="dark"] .letter-sign .hl-seal { color: var(--hl-ink); }

.basis { font-size: 13px; max-width: 72ch; margin-top: 8px; }
.response-line { margin-top: 8px; font-size: 12.5px; color: var(--hl-muted); }

.empty { padding: 40px 0; color: var(--hl-muted); font-size: 13px; }
.empty .hl-ref { display: inline; }
header .right { display: flex; align-items: baseline; gap: 14px; }
footer { max-width: 1180px; margin: 0 auto; padding: 10px 20px 26px; }
footer span + span::before { content: " · "; }
`;

const CLIENT_JS = [
  "var SEAL = " + JSON.stringify(SEAL_SVG) + ";",
  "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}",
  "function t(at){try{return new Date(at).toISOString().slice(11,19)+'Z';}catch(e){return '';}}",
  "function statusBadge(c){",
  "  if(c.status==='received')return '<span class=\"hl-badge ack\">Received</span>';",
  "  if(c.status==='examining')return '<span class=\"hl-badge review\">Under examination</span>';",
  "  if(c.status==='error')return '<span class=\"hl-badge disputed\">Error</span>';",
  "  var d=c.decision&&c.decision.decision;",
  "  if(d==='ACCEPT')return '<span class=\"hl-badge paid\">Accepted</span>';",
  "  if(d==='DISPUTE')return '<span class=\"hl-badge disputed\">Disputed</span>';",
  "  if(d==='REQUEST-MORE')return '<span class=\"hl-badge review\">Further evidence requested</span>';",
  "  return '<span class=\"hl-badge verified\">Concluded</span>';",
  "}",
  "function packRow(p){",
  "  var cls=p.status==='verified'?'hl-attested':(p.status==='failed'?'hl-failed':'hl-examining');",
  "  var line;",
  "  if(p.status==='verified'){line='Verified — '+p.recordsVerified+' of '+(p.recordsVerified+p.recordsFailed)+' records verify against the public anchor, independently of the sender.';}",
  "  else if(p.status==='failed'){line='Not verified'+(p.errors.length?' — '+esc(p.errors[0]):'')+'. What does not verify is not evidence.';}",
  "  else if(p.status==='examining'){line='Under examination.';}",
  "  else{line='Awaiting examination.';}",
  "  var detail='';",
  "  if(p.status==='verified'){",
  "    detail='<div class=\"pack-detail\">'+(p.specVersion?'<span class=\"hl-ref\">'+esc(p.specVersion)+'</span>':'')+(p.kernel?' · kernel '+esc(p.kernel):'')+(p.checkpointTxIds.length?' · checkpoint <span class=\"hl-ref\">'+esc(p.checkpointTxIds[0].slice(0,12))+'…</span>':'')+'</div>';",
  "  }",
  "  var seal=p.status==='verified'?'<span class=\"pack-seal\" title=\"Verified — the stamp of assent\">'+SEAL+'</span>':'';",
  "  return '<div class=\"pack-row\"><div class=\"pack-main\">'+",
  "    '<span class=\"hl-ref\">'+esc(p.ref)+'</span>'+",
  "    '<div class=\"pack-verdict '+cls+'\">'+line+'</div>'+detail+",
  "    '</div>'+seal+'</div>';",
  "}",
  "function stepsHtml(c){",
  "  if(!c.steps.length)return '<div class=\"empty\">Nothing is on the record yet.</div>';",
  "  var out='<ul class=\"steps\">';",
  "  for(var i=0;i<c.steps.length;i++){var s=c.steps[i];out+='<li class=\"k-'+esc(s.kind)+'\"><span class=\"at\">'+t(s.at)+'</span><span class=\"txt\">'+esc(s.text)+'</span></li>';}",
  "  return out+'</ul>';",
  "}",
  "function letterHtml(c){",
  "  if(!c.letter)return '';",
  "  var lines=c.letter.text.split('\\n');",
  "  var ref=lines.length&&lines[0].indexOf('RE ')===0?lines.shift():'';",
  "  while(lines.length&&lines[0].trim()==='')lines.shift();",
  "  var sig=[];",
  "  while(lines.length&&lines[lines.length-1].trim()!=='')sig.unshift(lines.pop());",
  "  var paras=lines.join('\\n').split(/\\n\\s*\\n/).filter(function(p){return p.trim()!=='';});",
  "  var body='';",
  "  for(var i=0;i<paras.length;i++)body+='<p>'+esc(paras[i].trim())+'</p>';",
  "  var sign='<div class=\"letter-sign\"><div class=\"lines\">'+sig.map(esc).join('<br>')+'</div>'+SEAL+'</div>';",
  "  return '<section><div class=\"panel-label\"><span class=\"hl-label\">Halden\\u2019s response — as filed</span>'+",
  "    '<span class=\"hl-label\">position committed by <span class=\"hl-ref\">'+esc(c.letter.positionBy)+'</span></span></div>'+",
  "    '<div class=\"hl-sheet letter-wrap\"><div class=\"hl-rule\"></div>'+",
  "    (ref?'<div class=\"letter-ref\">'+esc(ref)+'</div>':'')+",
  "    '<div class=\"hl-letter\">'+body+sign+'</div></div></section>';",
  "}",
  "function decisionHtml(c){",
  "  if(!c.decision)return '';",
  "  return '<section><div class=\"panel-label\"><span class=\"hl-label\">The desk\\u2019s decision</span></div>'+",
  "    '<div class=\"hl-sheet\">'+statusBadge(c)+",
  "    '<p class=\"basis\">'+esc(c.decision.basis)+'</p>'+",
  "    '<p class=\"response-line\">'+esc(c.decision.response)+'</p></div></section>';",
  "}",
  "function render(c){",
  "  var el=document.getElementById('desk');",
  "  if(!c){el.innerHTML='<div class=\"empty\">No demand is on file. A counterparty files one with <span class=\"hl-ref\">POST /file-demand</span>.</div>';return;}",
  "  var html='';",
  "  html+='<div class=\"case-strip\"><span class=\"hl-title\">File '+esc(c.fileRef)+'</span>'+statusBadge(c)+",
  "    '<span class=\"hl-label\">received <span class=\"hl-ref\">'+esc(c.receivedAt.slice(0,10))+' '+t(c.receivedAt)+'</span></span></div>';",
  "  html+='<div class=\"desk-grid\">';",
  "  html+='<div><section><div class=\"panel-label\"><span class=\"hl-label\">Inward demand — as received</span></div>'+",
  "    '<div class=\"hl-sheet\"><div class=\"demand-text\">'+esc(c.demandText)+'</div>'+",
  "    '<div class=\"demand-packs\"><span class=\"hl-label\">Evidence offered with the demand</span>'+",
  "    c.packs.map(function(p){return '<a class=\"hl-ref\" href=\"'+esc(p.url)+'/pack/bundle.json\">'+esc(p.ref)+'</a>';}).join('')+",
  "    '</div></div></section></div>';",
  "  html+='<div><section style=\"margin-top:0\"><div class=\"panel-label\"><span class=\"hl-label\">The examination</span></div>'+",
  "    '<div class=\"hl-sheet\">'+(c.packs.length?c.packs.map(packRow).join(''):'<div class=\"empty\">No evidence was offered.</div>')+'</div></section>';",
  "  html+='<section><div class=\"panel-label\"><span class=\"hl-label\">Desk record</span></div>'+",
  "    '<div class=\"hl-sheet\">'+stepsHtml(c)+'</div></section></div>';",
  "  html+='</div>';",
  "  html+=decisionHtml(c);",
  "  html+=letterHtml(c);",
  "  el.innerHTML=html;",
  "}",
  "function applyTheme(v){if(v){document.documentElement.setAttribute('data-theme',v);}else{document.documentElement.removeAttribute('data-theme');}",
  "  var dark=v==='dark'||(v!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "  document.getElementById('theme-toggle').textContent=dark?'Day desk':'Night desk';}",
  "function initTheme(){var v=null;try{v=localStorage.getItem('halden-theme');}catch(e){}applyTheme(v);}",
  "document.getElementById('theme-toggle').addEventListener('click',function(){",
  "  var cur=document.documentElement.getAttribute('data-theme');",
  "  var dark=cur==='dark'||(cur!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "  var next=dark?'light':'dark';try{localStorage.setItem('halden-theme',next);}catch(e){}applyTheme(next);});",
  "initTheme();",
  "render(null);",
  "var es=new EventSource('/stream');",
  "es.onmessage=function(ev){try{var d=JSON.parse(ev.data);if(d&&('case' in d))render(d['case']);}catch(e){}};",
].join("\n");

/**
 * The one page the desk serves. `cssText` is the verbatim contents of
 * assets/halden.css (the approved house sheet); everything else on the
 * page composes its tokens.
 */
export function renderPageHtml(cssText: string): string {
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
    <span class="hl-user">T. Ardal · Recovery Response</span>
    <button class="hl-btn ghost" id="theme-toggle" type="button">Night desk</button>
  </span>
</header>
<div class="hl-rule"></div>
<main id="desk"></main>
<footer class="hl-fineprint">
  <span>Verified against the public record — independently of the sender.</span>
  <span>The desk holds no account with the sender or its evidence platform.</span>
  <span>The desk's own logbook is an SSH-signed git audit trail.</span>
</footer>
<script>
${CLIENT_JS}
</script>
</body>
</html>
`;
}
