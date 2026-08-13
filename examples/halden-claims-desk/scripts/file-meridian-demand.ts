// The two-company handoff, from a terminal: ask the Halden desk to pull
// Meridian's newest recovery demand from the Workbench and open a case.
//
// This script is a thin caller of the desk's own POST /fetch-demand —
// the same endpoint the desk page's "Incoming demand — Meridian" button
// drives. The desk does the work server-side: it reads the Workbench,
// lifts the drafted demand to "issued by counsel" (the demo's fiction),
// extracts the IDENTIFIERS (claim reference, loss date), and opens the
// case identifier-only. No pack URL crosses the company seam; evidence
// arrives later, when the desk files its evidence request.
//
//   bun --conditions=intx-src run scripts/file-meridian-demand.ts
//
// Env: HALDEN_DESK_URL         (default http://localhost:4620)
//      HALDEN_DESK_KEY         (or DEMO_PASSCODE) — the desk's demo
//                              passcode, when the hosted desk gates its
//                              endpoints.
//
// Which Workbench the demand is pulled from is the DESK's setting
// (MERIDIAN_WORKBENCH_URL in the desk's environment), not this
// script's: the resolver lives desk-side.

import { type } from "arktype";

const DESK = process.env["HALDEN_DESK_URL"] ?? "http://localhost:4620";
const DESK_KEY =
  process.env["HALDEN_DESK_KEY"] ?? process.env["DEMO_PASSCODE"] ?? "";

const FiledResponse = type({
  "fileRef?": "string",
  "claimRef?": "string | null",
  "lossDate?": "string | null",
  "desk?": "string",
  "caseUrl?": "string",
});

async function main(): Promise<number> {
  const res = await fetch(`${DESK}/fetch-demand`, {
    method: "POST",
    headers: DESK_KEY !== "" ? { "x-demo-key": DESK_KEY } : {},
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    console.error(`POST ${DESK}/fetch-demand -> HTTP ${String(res.status)}`);
    console.error(JSON.stringify(body, null, 2));
    return 1;
  }

  const filed = FiledResponse(body);
  const get = (k: "fileRef" | "claimRef" | "lossDate" | "desk" | "caseUrl") =>
    filed instanceof type.errors ? null : (filed[k] ?? null);
  console.log(`demand filed at the desk, identifier-only`);
  console.log(`  Halden file:  ${get("fileRef") ?? "?"}`);
  console.log(`  claim cited:  ${get("claimRef") ?? "(none)"}`);
  console.log(`  loss date:    ${get("lossDate") ?? "(none)"}`);
  console.log(`  watch the desk: ${get("desk") ?? DESK}`);
  console.log(`  case JSON:      ${get("caseUrl") ?? "?"}`);
  console.log(
    `next: the desk's evidence-request form (Act II on the page) fetches the records`,
  );
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
