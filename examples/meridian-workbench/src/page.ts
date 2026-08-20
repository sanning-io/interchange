// The Workbench page: one server-rendered HTML string, no build step,
// same discipline as the Halden desk's page — tokens, one column, the
// record is the interface. Deliberately modest: a working view of the
// day (stage cards, live SSE progress, the BLOCKED state, checkpoint
// references), not a rebuild of the claims-demo console.

const CSS = `
:root {
  --mw-paper: #f4f5f7; --mw-sheet: #ffffff; --mw-ink: #16181d;
  --mw-muted: #5c6470; --mw-line: #d9dde3; --mw-field: #eef0f3;
  --mw-slate: #3a4a5d; --mw-slate-tint: #e7ecf2;
  --mw-good: #1f6f43; --mw-good-tint: #e2f1e8;
  --mw-block: #8a2f2f; --mw-block-tint: #f6e4e4;
  --mw-display: Optima, Candara, "Gill Sans", sans-serif;
  --mw-mono: ui-monospace, "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--mw-paper); color: var(--mw-ink);
  font: 14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 28px 20px 60px; }
header.mast { display: flex; align-items: baseline; gap: 12px; border-bottom: 2px solid var(--mw-ink); padding-bottom: 14px; }
.mark { font-family: var(--mw-display); font-size: 22px; font-weight: 600; letter-spacing: 0.2px; }
.mark small { color: var(--mw-muted); font-weight: 400; font-size: 13px; margin-left: 8px; }
.mast .spacer { flex: 1; }
button.run {
  font: inherit; font-size: 13px; padding: 7px 16px; cursor: pointer;
  background: var(--mw-slate); color: #fff; border: none; border-radius: 3px;
}
button.run[disabled] { opacity: 0.5; cursor: default; }
.note { margin: 14px 0 4px; font-size: 12.5px; color: var(--mw-muted); }
.day { margin-top: 18px; display: grid; gap: 14px; }
.stage {
  background: var(--mw-sheet); border: 1px solid var(--mw-line);
  border-left: 3px solid var(--mw-slate); padding: 14px 16px;
}
.stage h2 { margin: 0; font-family: var(--mw-display); font-size: 16px; font-weight: 600; }
.stage .meta { margin-top: 2px; font-size: 12px; color: var(--mw-muted); }
.chips { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11px; letter-spacing: 0.4px; padding: 2px 8px; border-radius: 2px;
  background: var(--mw-field); color: var(--mw-muted); text-transform: uppercase;
}
.chip.good { background: var(--mw-good-tint); color: var(--mw-good); }
.chip.blocked { background: var(--mw-block-tint); color: var(--mw-block); font-weight: 600; }
.chip.live { background: var(--mw-slate-tint); color: var(--mw-slate); }
.decision {
  margin-top: 10px; white-space: pre-wrap; font-family: var(--mw-mono);
  font-size: 12px; background: var(--mw-field); padding: 10px 12px;
  border-radius: 2px; overflow-x: auto;
}
.refs { margin-top: 8px; font-family: var(--mw-mono); font-size: 11px; color: var(--mw-muted); word-break: break-all; }
.steps { margin: 8px 0 0; padding: 0; list-style: none; font-size: 12px; color: var(--mw-muted); }
.steps li { padding: 1px 0; }
footer.foot { margin-top: 30px; border-top: 1px solid var(--mw-line); padding-top: 12px; font-size: 12px; color: var(--mw-muted); }
footer.foot code { font-family: var(--mw-mono); font-size: 11px; background: var(--mw-field); padding: 1px 5px; }
`;

const JS = `
const ORDER = ["intake", "adjudication", "renewal", "recovery"];
const TITLES = {
  intake: "Intake — FNOL triage",
  adjudication: "Claims — adjudication",
  renewal: "Renewal — policy review",
  recovery: "Recovery — subrogation referral",
};
const live = {};   // stageId -> { steps: [], running: bool }
let needsKey = document.body.dataset.gated === "1";
let key = "";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function stageCard(stageId, meta) {
  const card = el("section", "stage");
  card.append(el("h2", "", TITLES[stageId] || stageId));
  const state = live[stageId];
  if (meta) {
    card.append(el("div", "meta",
      meta.caseRef + " · " + meta.agentName + " · " + meta.recordedAt.slice(0, 19).replace("T", " ")));
    const chips = el("div", "chips");
    chips.append(el("span", "chip good", "anchored — " + meta.records + " records"));
    if (meta.blocked) chips.append(el("span", "chip blocked", "BLOCKED — escalated to counsel"));
    chips.append(el("span", "chip", meta.environment));
    card.append(chips);
    if (meta.decision) card.append(el("pre", "decision", meta.decision));
    if (meta.checkpointTxIds.length) {
      card.append(el("div", "refs", "checkpoint " + meta.checkpointTxIds.join(" · ")));
    }
  } else if (state && state.running) {
    const chips = el("div", "chips");
    chips.append(el("span", "chip live", "working…"));
    card.append(chips);
  } else {
    card.append(el("div", "meta", "not yet run today"));
  }
  if (state && state.steps.length) {
    const ul = el("ul", "steps");
    for (const s of state.steps.slice(-6)) ul.append(el("li", "", s));
    card.append(ul);
  }
  return card;
}

async function refresh() {
  const res = await fetch("/api/estate/sessions");
  const { sessions } = await res.json();
  const newest = {};
  for (const s of sessions) if (!newest[s.stageId]) newest[s.stageId] = s;
  const day = document.getElementById("day");
  day.replaceChildren(...ORDER.map((id) => stageCard(id, newest[id])));
}

function describeStep(e) {
  const p = e.payload || {};
  if (e.type === "interchange.tool_call") return "tool — " + (p.tool || "?");
  if (e.type === "interchange.tool_blocked") return "DENIED — " + (p.tool || "?");
  if (e.type === "interchange.reply") return "reply sealed";
  return e.type.replace("interchange.", "");
}

function runDay() {
  const btn = document.getElementById("run");
  btn.disabled = true;
  if (needsKey && !key) {
    key = window.prompt("Demo passcode") || "";
    if (!key) { btn.disabled = false; return; }
  }
  const es = new EventSource("/run-day?stream=1" + (key ? "&key=" + encodeURIComponent(key) : ""));
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.kind === "stage_start") { live[ev.stageId] = { steps: [], running: true }; }
    if (ev.kind === "step" && live[ev.stageId]) live[ev.stageId].steps.push(describeStep(ev.event));
    if (ev.kind === "stage_done" && live[ev.stageId]) { live[ev.stageId].running = false; refresh(); }
    if (ev.kind === "day_done" || ev.kind === "day_error") {
      if (ev.kind === "day_error") window.alert("Day failed: " + ev.message);
      es.close(); btn.disabled = false;
      for (const k of Object.keys(live)) delete live[k];
      refresh();
      return;
    }
    const day = document.getElementById("day");
    if (day) refresh();
  };
  es.onerror = () => { es.close(); btn.disabled = false; refresh(); };
}

document.getElementById("run").addEventListener("click", runDay);
refresh();
`;

export function renderPageHtml(gated: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meridian Mutual — Claims Workbench</title>
<style>${CSS}</style>
</head>
<body data-gated="${gated ? "1" : "0"}">
<div class="wrap">
  <header class="mast">
    <div class="mark">Meridian Mutual<small>Claims Workbench — Interchange estate</small></div>
    <div class="spacer"></div>
    <button class="run" id="run">Run the day</button>
  </header>
  <p class="note">Four stages, each a live agent session anchored through the
  published Sanning SDK on the Interchange platform. Sealed records disclose
  their content in-body; the recovery referral verifies the day's own
  adjudication pack before acting, and its send attempt is policy-denied —
  the denial is anchored evidence. The demand Halden receives remains
  scripted fiction: no machine request lane and no authorisation layer exist
  yet, deliberately.</p>
  <div class="day" id="day"></div>
  <footer class="foot">Verify any session's pack yourself:
  <code>npx @sanning/proof verify &lt;bundle.json&gt;</code> — no Sanning
  account, local math only.</footer>
</div>
<script>${JS}</script>
</body>
</html>
`;
}
