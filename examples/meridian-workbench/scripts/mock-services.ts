/* eslint-disable no-console */
// Dev-only mock services, so the WHOLE Workbench day — four stages,
// anchoring, pack sealing, desk verification — is drivable with zero
// model spend and zero anchor spend:
//
//   POST /chat/completions  an OpenAI-compatible mock that walks each
//                           stage through its scripted tool sequence
//                           (SSE chunks, as the inference provider
//                           always requests stream:true)
//   POST /v1/tx             the anchorer's dev-mode upload mock
//                           (`SANNING_DEV_UPLOAD_URL` → { id })
//
// Point the Workbench at it:
//   OPENROUTER_API_KEY=mock OPENROUTER_BASE_URL=http://localhost:4680 \
//   SANNING_DEV_UPLOAD_URL=http://localhost:4680 bun run serve
//
// The scripts are fixtures, not intelligence: the point is exercising
// the anchoring pipeline deterministically. A live run (a real
// OPENROUTER_API_KEY, no base-URL override) produces the same record
// shapes with real model reasoning.

import { type } from "arktype";

const DEFAULT_PORT = 4680;

const Body = type({
  "messages?": type({ role: "string", "content?": "unknown" }).array(),
  "stream?": "boolean",
});

interface ToolStep {
  name: string;
  args: Record<string, unknown>;
}

type Step = ToolStep | { final: string };

// ---- the scripted stage sequences -----------------------------------------

const INTAKE_REPORT =
  "ROUTE: property-claims-adjudication\n" +
  "SEVERITY: major\n" +
  "LINE: fire and smoke\n" +
  "RATIONALE: The FNOL reports a fire loss with the property " +
  "uninhabitable and an initial estimate of $46,500 — both over the " +
  "major-severity bar for the fire line. Routing rules send major fire " +
  "losses to property-claims-adjudication with a field inspection " +
  "before adjudication.";

const INTAKE: Step[] = [
  { name: "read_fnol", args: {} },
  { name: "read_routing_rules", args: {} },
  { name: "file_stage_report", args: { report: INTAKE_REPORT } },
  {
    final:
      "ROUTE: property-claims-adjudication\n" +
      "SEVERITY: major\n" +
      "LINE: fire and smoke\n" +
      "RATIONALE: The FNOL reports a fire loss with the property " +
      "uninhabitable and an initial estimate of $46,500 — both over the " +
      "major-severity bar for the fire line. Routing rules send major fire " +
      "losses to property-claims-adjudication with a field inspection " +
      "before adjudication.",
  },
];

const ADJUDICATION_REPORT =
  "DECISION: APPROVE\n" +
  "AMOUNT: $45,500\n" +
  "RATIONALE: The inspection identifies a sudden, accidental cooking " +
  "fire with no accelerant traces and no code violations — squarely " +
  "inside the policy's fire grant and outside its exclusions. The " +
  "claimed $46,500 is substantiated; less the $1,000 deductible the " +
  "approved amount is $45,500, within the $250,000 limit.";

const ADJUDICATION: Step[] = [
  { name: "read_claim_file", args: {} },
  { name: "read_policy_terms", args: {} },
  { name: "file_stage_report", args: { report: ADJUDICATION_REPORT } },
  {
    final:
      "DECISION: APPROVE\n" +
      "AMOUNT: $45,500\n" +
      "RATIONALE: The inspection identifies a sudden, accidental cooking " +
      "fire with no accelerant traces and no code violations — squarely " +
      "inside the policy's fire grant and outside its exclusions. The " +
      "claimed $46,500 is substantiated; less the $1,000 deductible the " +
      "approved amount is $45,500, within the $250,000 limit.",
  },
];

const RENEWAL_REPORT =
  "RENEWAL: RENEW WITH CONDITIONS\n" +
  "PREMIUM: +12%\n" +
  "RATIONALE: The history shows the 2024 water claim denied for a " +
  "known, unrepaired supply-line leak that the current inspection " +
  "confirms is still unrepaired — a documented, unmitigated risk that " +
  "must surface as a repair condition. The approved 2026 fire loss is " +
  "sudden-and-accidental and does not bar renewal.";

const RENEWAL: Step[] = [
  { name: "read_renewal_review", args: {} },
  { name: "read_claims_history", args: {} },
  { name: "file_stage_report", args: { report: RENEWAL_REPORT } },
  {
    final:
      "RENEWAL: RENEW WITH CONDITIONS\n" +
      "PREMIUM: +12%\n" +
      "RATIONALE: The history shows the 2024 water claim denied for a " +
      "known, unrepaired supply-line leak that the current inspection " +
      "confirms is still unrepaired — a documented, unmitigated risk that " +
      "must surface as a repair condition. The approved 2026 fire loss is " +
      "sudden-and-accidental and does not bar renewal.",
  },
];

const recoverySteps = (packUrl: string | null): Step[] => [
  {
    name: "record_working_note",
    args: {
      note:
        "Verifying the upstream adjudication's sealed evidence pack before " +
        "any recovery work — an unverifiable record is not actionable.",
    },
  },
  {
    name: "verify_evidence_pack",
    args: packUrl !== null ? { packUrl } : {},
  },
  {
    name: "record_working_note",
    args: {
      note:
        "Pack verified. Reading the investigation findings to establish " +
        "third-party liability.",
    },
  },
  { name: "read_investigation_report", args: {} },
  { name: "read_policy_recovery_clause", args: {} },
  { name: "read_payout_record", args: {} },
  {
    name: "draft_demand_letter",
    args: {
      target: "Hollis & Verne Electrical",
      amount: 46500,
      basis:
        "The cause-and-origin examination identifies defective workmanship " +
        "by Hollis & Verne Electrical as the proximate cause of the fire " +
        "loss paid under CLM-2026-3105. Meridian, as subrogee, demands the " +
        "amount paid plus the insured's deductible per the recovery clause.",
    },
  },
  { name: "send_demand_letter", args: {} },
  {
    final:
      "DECISION: PURSUE\n" +
      "AMOUNT: $46,500\n" +
      "TARGET: Hollis & Verne Electrical\n" +
      "RATIONALE: The upstream adjudication's evidence pack verified with " +
      "the proof kernel, and the investigation identifies Hollis & Verne " +
      "Electrical as the liable party. The clause's demand basis is the " +
      "amount paid plus the deductible — $46,500. I drafted the demand and " +
      "attempted issuance; authorization denied the send, so issuance goes " +
      "to supervising counsel.",
  },
];

function stageSequence(system: string, packUrl: string | null): Step[] {
  if (system.includes("intake-triage specialist")) return INTAKE;
  if (system.includes("claims adjudicator")) return ADJUDICATION;
  if (system.includes("policy-renewal reviewer")) return RENEWAL;
  if (system.includes("recovery (subrogation) specialist")) {
    return recoverySteps(packUrl);
  }
  return [{ final: "OK." }];
}

// ---- OpenAI SSE framing ----------------------------------------------------

function sse(frames: unknown[]): Response {
  const body =
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
  id: "chatcmpl-mock",
  object: "chat.completion.chunk",
  created: 0,
  model: "mock",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function respond(step: Step, callIndex: number): Response {
  if ("final" in step) {
    return sse([
      chunk({ role: "assistant" }, null),
      chunk({ content: step.final }, null),
      chunk({}, "stop"),
    ]);
  }
  return sse([
    chunk({ role: "assistant" }, null),
    chunk(
      {
        tool_calls: [
          {
            index: 0,
            id: `call_${String(callIndex)}_${step.name}`,
            type: "function",
            function: {
              name: step.name,
              arguments: JSON.stringify(step.args),
            },
          },
        ],
      },
      null,
    ),
    chunk({}, "tool_calls"),
  ]);
}

// ---- the server ------------------------------------------------------------

export function serveMocks(port = DEFAULT_PORT) {
  const server = Bun.serve({
    port,
    hostname: "::",
    async fetch(req) {
      const url = new URL(req.url);

      // The anchorer's dev-mode upload seam: POST <base>/v1/tx -> { id }.
      // The id is NOT free-form: the anchorer verifies it against the
      // data item's own derived id (ANS-104: sha256 of the signature,
      // base64url), so the mock derives it from the posted bytes.
      if (req.method === "POST" && url.pathname === "/v1/tx") {
        const bytes = new Uint8Array(await req.arrayBuffer());
        const sigType = (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
        const SIG_LEN: Record<number, number> = { 1: 512, 2: 64, 3: 65, 4: 64 };
        const sigLen = SIG_LEN[sigType] ?? 64;
        const digest = await globalThis.crypto.subtle.digest(
          "SHA-256",
          bytes.slice(2, 2 + sigLen),
        );
        const id = Buffer.from(digest)
          .toString("base64")
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "");
        return Response.json({ id });
      }

      if (req.method === "POST" && url.pathname === "/chat/completions") {
        const parsed = Body(await req.json());
        if (parsed instanceof type.errors) {
          return Response.json({ error: parsed.summary }, { status: 400 });
        }
        const messages = parsed.messages ?? [];
        const text = (m: { content?: unknown }): string =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        const system = messages
          .filter((m) => m.role === "system")
          .map(text)
          .join("\n");
        const user = messages
          .filter((m) => m.role === "user")
          .map(text)
          .join("\n");
        const packUrl = /pack is at:\s*(\S+)/.exec(user)?.[1] ?? null;
        // Progress = how many tool results have come back so far.
        const done = messages.filter((m) => m.role === "tool").length;
        const seq = stageSequence(system, packUrl);
        const step = seq[Math.min(done, seq.length - 1)];
        if (step === undefined) {
          return Response.json({ error: "empty sequence" }, { status: 500 });
        }
        return respond(step, done);
      }

      return Response.json(
        { error: `no route: ${req.method} ${url.pathname}` },
        { status: 404 },
      );
    },
  });
  console.log(
    `[meridian-workbench mocks] LLM + dev upload on http://localhost:${String(server.port)}`,
  );
  return server;
}

if (import.meta.main) {
  serveMocks();
}
