/* eslint-disable no-console */
// Trigger one Workbench day from the terminal and print the outcome —
// the CLI face of the page's "Run the day" button.
//
//   bun --conditions=intx-src run scripts/run-day.ts [workbench-url]
//
// Default workbench: http://localhost:4630. DEMO_PASSCODE is sent when
// set in the environment.

import { type } from "arktype";

const DayResult = type({
  sessions: type({
    sessionDir: "string",
    stageId: "string",
    records: "number",
    blocked: "boolean",
    checkpointTxIds: "string[]",
    decision: "string",
  }).array(),
});

const base = (process.argv[2] ?? "http://localhost:4630").replace(/\/+$/, "");
const passcode = process.env["DEMO_PASSCODE"] ?? "";

const res = await fetch(`${base}/run-day`, {
  method: "POST",
  headers: passcode !== "" ? { "x-demo-key": passcode } : {},
});
if (!res.ok) {
  console.error(`POST ${base}/run-day -> HTTP ${String(res.status)}`);
  console.error(await res.text());
  process.exit(1);
}
const parsed = DayResult(await res.json());
if (parsed instanceof type.errors) {
  console.error(`unexpected /run-day shape: ${parsed.summary}`);
  process.exit(1);
}
const { sessions } = parsed;
for (const s of sessions) {
  console.log(`\n== ${s.stageId} · ${s.sessionDir} ==`);
  console.log(
    `records ${String(s.records)}${s.blocked ? " · BLOCKED send (policy denial anchored)" : ""}`,
  );
  if (s.checkpointTxIds.length > 0) {
    console.log(`checkpoint ${s.checkpointTxIds.join(" · ")}`);
  }
  console.log(s.decision);
}
console.log(
  `\nVerify any pack: npx @sanning/proof verify <(curl -s ${base}/sessions/<dir>/pack/bundle.json)`,
);
