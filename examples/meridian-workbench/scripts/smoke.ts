/* eslint-disable no-console */
// End-to-end estate smoke, zero spend: mock LLM + mock dev upload →
// the full four-stage day → every sealed pack re-verified the way the
// COUNTERPARTY verifies (the Halden desk's kernel dispatch, in-body
// disclosure, no side files) → the recovery stage's policy denial
// present as an anchored record.
//
//   bun --conditions=intx-src run scripts/smoke.ts
//
// Exits 0 with PASS lines, 1 with the first failure. Uses its own
// throwaway data dir per run; nothing touches a real estate or spends
// a cent.

import { mkdtempSync, rmSync } from "node:fs";

import { type } from "arktype";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fetchLatestDemand,
  resolveEvidence,
  verifyPackAtUrl,
} from "@intx/example-halden-claims-desk";

import { serve } from "../src/serve";
import { serveMocks } from "./mock-services";

const MOCK_PORT = 4685;
const WB_PORT = 4686;

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "meridian-smoke-"));
const mocks = serveMocks(MOCK_PORT);
const wb = serve({
  port: WB_PORT,
  dataDir,
  env: {
    ...process.env,
    OPENROUTER_API_KEY: "mock",
    OPENROUTER_BASE_URL: `http://localhost:${String(MOCK_PORT)}`,
    SANNING_DEV_UPLOAD_URL: `http://localhost:${String(MOCK_PORT)}`,
    SANNING_API_KEY: "",
    DEMO_PASSCODE: "",
  },
});

const base = `http://localhost:${String(WB_PORT)}`;

try {
  const run = await fetch(`${base}/run-day`, { method: "POST" });
  if (!run.ok) fail(`POST /run-day -> HTTP ${String(run.status)}`);
  const DayResult = type({
    sessions: type({
      sessionDir: "string",
      stageId: "string",
      blocked: "boolean",
    }).array(),
  });
  const parsed = DayResult(await run.json());
  if (parsed instanceof type.errors) fail(parsed.summary);
  const { sessions } = parsed;
  if (sessions.length !== 4) {
    fail(`expected 4 stage sessions, got ${String(sessions.length)}`);
  }
  console.log(`PASS day ran: ${sessions.map((s) => s.stageId).join(" → ")}`);

  const recovery = sessions.find((s) => s.stageId === "recovery");
  if (recovery === undefined) fail("no recovery session");
  if (!recovery.blocked) {
    fail("recovery session carries no policy-denied (blocked) record");
  }
  console.log("PASS recovery send is policy-denied — anchored blocked record");

  // Verify-first, in-estate: the recovery agent's verify_evidence_pack
  // ran against THIS estate's adjudication pack and recorded "verified".
  const tlRes = await fetch(
    `${base}/sessions/${recovery.sessionDir}/timeline.json`,
  );
  const Timeline = type({
    type: "string",
    "payload?": { "tool?": "string", "result?": { "content?": "unknown" } },
  }).array();
  const tlParsed = Timeline(await tlRes.json());
  if (tlParsed instanceof type.errors) fail(tlParsed.summary);
  const tl = tlParsed;
  const verifyStep = tl.find(
    (e) =>
      e.type === "interchange.tool_call" &&
      e.payload?.tool === "verify_evidence_pack",
  );
  const verifyText =
    typeof verifyStep?.payload?.result?.content === "string"
      ? verifyStep.payload.result.content
      : "";
  if (!verifyText.includes('"verdict": "verified"')) {
    fail(
      `recovery's upstream verify did not return verified: ${verifyText.slice(0, 200)}`,
    );
  }
  console.log(
    "PASS recovery verified the day's own adjudication pack before acting",
  );

  // Verify every stage's pack exactly as the counterparty does.
  for (const s of sessions) {
    const verdict = await verifyPackAtUrl(`${base}/sessions/${s.sessionDir}`);
    if (verdict.verdict !== "verified") {
      fail(
        `${s.stageId} pack verdict ${verdict.verdict}: ${verdict.errors.join("; ")}`,
      );
    }
    if (verdict.recordsFailed > 0) {
      fail(
        `${s.stageId} pack has ${String(verdict.recordsFailed)} failed records`,
      );
    }
    console.log(
      `PASS ${s.stageId} pack verified (${verdict.kernel ?? "?"}; ` +
        `${String(verdict.recordsVerified)} records, spec ${verdict.specVersion ?? "?"})`,
    );
  }

  // The adjudication pack must carry the pinned decision lines the
  // recovery agent and the desk both scan for.
  const adj = sessions.find((s) => s.stageId === "adjudication");
  if (adj === undefined) fail("no adjudication session");
  const adjVerdict = await verifyPackAtUrl(
    `${base}/sessions/${adj.sessionDir}`,
  );
  if (adjVerdict.decisionLines === null) {
    fail("adjudication pack carries no DECISION:/AMOUNT: lines");
  }
  console.log(`PASS decision lines readable: ${adjVerdict.decisionLines}`);

  // The counterparty seam, exactly as the Halden desk drives it: the
  // demand pulled from the newest recovery session, then an evidence
  // request resolved against the estate's open listing.
  const demand = await fetchLatestDemand(base);
  if (demand.claimRef !== "CLM-2026-3105") {
    fail(`demand claimRef ${String(demand.claimRef)} != CLM-2026-3105`);
  }
  if (demand.lossDate !== "2026-07-19") {
    fail(`demand lossDate ${String(demand.lossDate)} != 2026-07-19`);
  }
  console.log(
    `PASS desk pulled the demand (claim ${demand.claimRef}, loss ${demand.lossDate})`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const located = await resolveEvidence(base, {
    claimRef: demand.claimRef,
    since: today,
    until: today,
    kinds: ["adjudication", "recovery-working"],
  });
  if (located.length !== 2) {
    fail(
      `desk resolved ${String(located.length)} records, expected adjudication + recovery-working`,
    );
  }
  for (const r of located) {
    const v = await verifyPackAtUrl(r.packUrl);
    if (v.verdict !== "verified") {
      fail(`located ${r.kindId} pack verdict ${v.verdict}`);
    }
  }
  console.log(
    "PASS desk located and verified both requested evidence kinds in-estate",
  );

  console.log("SMOKE PASS");
} finally {
  void wb.stop(true);
  void mocks.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
}
