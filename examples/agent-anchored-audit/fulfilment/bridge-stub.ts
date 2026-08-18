// Bridge stub: stands in for the Sanning console-ledger poller that is
// out of scope until a service account exists. A real bridge would
// watch the console for APPROVED evidence requests and forward each
// one to the fulfilment workflow's mail trigger; this stub forwards ONE
// faked approved request and then watches the run to completion.
//
//   faked approval ──POST /workflows/:id/mail──▶ fulfilment workflow
//                                                    │ (agent step calls the
//                                                    │  assemble tool → agent
//                                                    │  service POST /assemble)
//   run events ◀──poll /runs/:runId/events──────────┘
//
// Reads the deployment coordinates ./deploy.ts wrote to
// `<repo>/tmp/sanning-fulfilment-deploy.json`.
//
// Run from the repo root:
//
//   bun examples/agent-anchored-audit/fulfilment/bridge-stub.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const EMAIL = process.env["HUB_ADMIN_EMAIL"] ?? "alice@example.com";
const PASSWORD = process.env["HUB_ADMIN_PASSWORD"] ?? "password123";

const coords = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "tmp", "sanning-fulfilment-deploy.json"),
    "utf8",
  ),
) as {
  base: string;
  tenantId: string;
  deploymentId: string;
  mailAddress: string;
};

const BASE = coords.base;
const TENANT = coords.tenantId;
const DEPLOYMENT = coords.deploymentId;

function fail(msg: string, data?: unknown): never {
  console.error(`FAIL: ${msg}`);
  if (data !== undefined) console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

let cookies: string[] = [];
async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookies.length > 0) headers["Cookie"] = cookies.join("; ");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  for (const sc of res.headers.getSetCookie()) {
    const pair = sc.split(";")[0]!;
    const name = pair.split("=")[0]!;
    cookies = cookies.filter((c) => !c.startsWith(`${name}=`));
    cookies.push(pair);
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, data };
}

// -- 1. Sign in (the stub authenticates like any operator client) ----------
const signIn = await api("POST", "/api/auth/sign-in/email", {
  email: EMAIL,
  password: PASSWORD,
});
if (signIn.status !== 200) fail("sign-in", signIn);

// -- 2. The faked approved request ------------------------------------------
const now = new Date();
const approvedRequest = {
  request_id: "req_demo_001",
  period_since: now.toISOString().slice(0, 10), // today's ISO date
  period_until: now.toISOString(),
};
console.log("bridge-stub: forwarding approved request", approvedRequest);

const runsBefore = await api(
  "GET",
  `/api/tenants/${TENANT}/workflows/${DEPLOYMENT}/runs`,
);
const knownRuns = new Set(
  runsBefore.status === 200
    ? (runsBefore.data as { runIds: string[] }).runIds
    : [],
);

const trigRes = await api(
  "POST",
  `/api/tenants/${TENANT}/workflows/${DEPLOYMENT}/mail`,
  { content: JSON.stringify(approvedRequest) },
);
if (trigRes.status !== 202) fail("mail trigger", trigRes);
console.log("bridge-stub: trigger accepted", JSON.stringify(trigRes.data));

// -- 3. Watch the run to a terminal event -----------------------------------
const deadline = Date.now() + 180_000;
let runId: string | undefined;
let lastEvents: { seq: number; type: string; body?: unknown }[] = [];
let printed = 0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  if (runId === undefined) {
    const runsRes = await api(
      "GET",
      `/api/tenants/${TENANT}/workflows/${DEPLOYMENT}/runs`,
    );
    if (runsRes.status !== 200) continue;
    const runIds = (runsRes.data as { runIds: string[] }).runIds;
    runId = runIds.find((id) => !knownRuns.has(id)) ?? runIds[0];
    if (runId === undefined) continue;
    console.log(`bridge-stub: run ${runId}`);
  }
  const evRes = await api(
    "GET",
    `/api/tenants/${TENANT}/workflows/${DEPLOYMENT}/runs/${encodeURIComponent(runId)}/events`,
  );
  if (evRes.status !== 200) continue;
  lastEvents = (
    evRes.data as { events: { seq: number; type: string; body?: unknown }[] }
  ).events;
  for (; printed < lastEvents.length; printed++) {
    const e = lastEvents[printed]!;
    console.log(`  event seq=${e.seq} ${e.type}`);
  }
  const types = lastEvents.map((e) => e.type);
  if (
    types.includes("RunCompleted") ||
    types.includes("RunFailed") ||
    types.includes("RunCancelled")
  ) {
    break;
  }
}

if (runId === undefined) fail("no run appeared before the deadline");
console.log(`\nbridge-stub: final event log for ${runId}:`);
console.log(JSON.stringify(lastEvents, null, 2));
const terminal = lastEvents.at(-1)?.type;
if (terminal !== "RunCompleted") fail(`run ended ${terminal ?? "nowhere"}`);
console.log("bridge-stub: fulfilment run completed");
