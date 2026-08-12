// The two-company handoff: pull the latest recovery session from the
// Meridian Claims Workbench, extract the demand its agent DRAFTED (and
// was denied from sending — issuance went to supervising counsel, who
// has now signed off in this demo's fiction), and file it at the Halden
// desk together with the evidence packs the demand rests on.
//
// The file travels over dumb HTTP. The trust travels separately: Halden
// re-verifies every pack with the public kernels on its own machine.
//
//   bun --conditions=intx-src run scripts/file-meridian-demand.ts
//
// Env: MERIDIAN_WORKBENCH_URL (default http://localhost:4601),
//      HALDEN_DESK_URL        (default http://localhost:4620).

import { type } from "arktype";

const WORKBENCH =
  process.env["MERIDIAN_WORKBENCH_URL"] ?? "http://localhost:4601";
const DESK = process.env["HALDEN_DESK_URL"] ?? "http://localhost:4620";

const SessionsListing = type({
  sessions: type({
    sessionDir: "string",
    category: "string",
    recordedAt: "string",
    "golden?": "boolean",
  }).array(),
});

const Timeline = type({
  type: "string",
  "payload?": {
    "tool?": "string",
    "result?": { "content?": "unknown" },
  },
}).array();

const SessionMeta = type({
  "external?": { "upstreamSession?": "string" },
});

const FiledResponse = type({
  "fileRef?": "string",
  "desk?": "string",
  "caseUrl?": "string",
});

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${String(res.status)}`);
  return res.json();
}

async function getValidated<T>(
  url: string,
  schema: (data: unknown) => T | type.errors,
): Promise<T> {
  const parsed = schema(await getJson(url));
  if (parsed instanceof type.errors) {
    throw new Error(`${url}: unexpected shape — ${parsed.summary}`);
  }
  return parsed;
}

function demandFromTimeline(timeline: typeof Timeline.infer): string | null {
  let demand: string | null = null;
  for (const entry of timeline) {
    if (entry.type !== "interchange.tool_call") continue;
    if (entry.payload?.tool !== "draft_demand_letter") continue;
    const content = entry.payload.result?.content;
    if (typeof content === "string") demand = content;
  }
  return demand;
}

// The recovery agent files a DRAFT (issuance is denied to it — that
// denial is chapter one's governance beat). What crosses to Halden is
// the ISSUED demand: supervising counsel has signed off in the demo's
// fiction, so the internal draft banner and status line come off and
// the issuance block goes on.
function issuedDemand(draft: string): string {
  const body = draft
    .split("\n")
    .filter((line) => !line.startsWith("DRAFT — NOT ISSUED"))
    .filter((line) => !line.startsWith("Status: DRAFT"))
    .join("\n")
    .trim();
  const dated = new Date().toISOString().slice(0, 10);
  return (
    `${body}\n\n` +
    `ISSUED by authority of supervising counsel.\n` +
    `Meridian Mutual — Recovery · Dated ${dated}.`
  );
}

async function main(): Promise<number> {
  // 1. The newest recovery session the Workbench has on file (live
  //    sessions preferred over the committed goldens).
  const listing = await getValidated(
    `${WORKBENCH}/api/estate/sessions`,
    SessionsListing,
  );
  const recoveries = listing.sessions
    .filter((s) => s.category === "recovery")
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const ordered = [
    ...recoveries.filter((s) => s.golden !== true),
    ...recoveries.filter((s) => s.golden === true),
  ];
  if (ordered.length === 0) {
    console.error(`no recovery sessions on the Workbench at ${WORKBENCH}`);
    return 1;
  }

  // 2. The drafted demand text, from the session's own timeline. A
  //    refusal session (no verified upstream pack -> nothing drafted)
  //    is skipped in favor of the next newest.
  let sessionDir: string | null = null;
  let demandText: string | null = null;
  for (const row of ordered) {
    const timeline = await getValidated(
      `${WORKBENCH}/sessions/${row.sessionDir}/timeline.json`,
      Timeline,
    );
    const demand = demandFromTimeline(timeline);
    if (demand !== null) {
      sessionDir = row.sessionDir;
      demandText = demand;
      break;
    }
  }
  if (sessionDir === null || demandText === null) {
    console.error("no recovery session with a drafted demand was found");
    return 1;
  }

  // 3. The evidence: the adjudication pack the demand's claim was paid
  //    on (the recovery session's recorded upstream), plus the recovery
  //    session's own pack — the sender's working record of the demand.
  const meta = await getValidated(
    `${WORKBENCH}/sessions/${sessionDir}/meta.json`,
    SessionMeta,
  );
  const upstream = meta.external?.upstreamSession;
  const packUrls = [
    ...(upstream !== undefined && upstream !== ""
      ? [`${WORKBENCH}/sessions/${upstream}`]
      : []),
    `${WORKBENCH}/sessions/${sessionDir}`,
  ];

  // 4. File it at the Halden desk. Plain HTTP; no shared platform, no
  //    shared credential — the desk verifies for itself.
  const res = await fetch(`${DESK}/file-demand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demandText: issuedDemand(demandText), packUrls }),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    console.error(`POST ${DESK}/file-demand -> HTTP ${String(res.status)}`);
    console.error(JSON.stringify(body, null, 2));
    return 1;
  }

  const filed = FiledResponse(body);
  const fileRef =
    filed instanceof type.errors ? "?" : (filed.fileRef ?? "?");
  const deskUrl = filed instanceof type.errors ? DESK : (filed.desk ?? DESK);
  const caseUrl = filed instanceof type.errors ? "?" : (filed.caseUrl ?? "?");
  console.log(`demand filed from Workbench session ${sessionDir}`);
  console.log(`  packs: ${packUrls.join(", ")}`);
  console.log(`  Halden file: ${fileRef}`);
  console.log(`  watch the desk: ${deskUrl}`);
  console.log(`  case JSON:      ${caseUrl}`);
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
