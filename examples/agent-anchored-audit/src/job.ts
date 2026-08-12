// The Recovery job: Meridian Mutual's subrogation specialist as an
// Interchange-hosted worker. This module owns everything about WHAT the
// agent does — fixtures, tools, authorization policy, prompts — so
// composition.ts stays pure plumbing (identity, storage, anchoring).
//
// The job in one line: after a claim is paid, verify the upstream
// adjudication's evidence pack, establish third-party liability from the
// recovery casefile, decide whether to pursue, draft the demand — and be
// DENIED the actual send, because issuing a demand is reserved for
// supervising counsel. The denial is anchored like everything else.
//
// The verify step is the handoff moment between two evidence planes:
// the upstream pack was produced by Meridian's claims-demo estate on the
// sanning.* wire IDs, so THIS agent verifies it with the same vendored
// @sanning/proof kernel (programmatic API, offline) before acting on it.
// No verified pack — no recovery work: the refusal is the required
// behavior, and the refusal itself becomes anchored evidence.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyEvidenceBundle } from "@sanning/proof";

import { stringTool, type BaseEnv } from "@intx/agent";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");
const loadFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

export const DEFAULT_CASE_REF = "CLM-2026-3105";

/** The governance gate: drafting is delegated, issuance is not. */
export const BLOCKED_TOOL = "send_demand_letter";

// ---- the verify tool's fetch + kernel call --------------------------------

interface PackVerification {
  packUrl: string;
  verdict: string;
  eventsVerified: number;
  eventsFailed: number;
  checkpointTxIds: string[];
  upstreamDecision: string | null;
  errors: string[];
}

// The upstream decision, pulled out of the pack's DISCLOSED bytes — the
// same bytes the kernel just bound to the committed content hashes. The
// adjudicator's prompt pins `DECISION:`/`AMOUNT:` lines, so a plain text
// scan over the verified logs is enough for a summary.
//
// Two traps in these bytes, learned the hard way: (1) newlines inside a
// committed log are the two characters `\` `n`, so a `\b` before
// DECISION never matches mid-text (`n` and `D` are both word chars);
// (2) the adjudicator's SYSTEM prompt also contains `DECISION:` — as a
// template whose value starts with `<`, which the value class excludes.
// The LAST matching log wins: that's the final message, not the prompt.
function upstreamDecisionFrom(logs: Record<string, string>): string | null {
  let found: string | null = null;
  for (const bytes of Object.values(logs)) {
    if (!bytes.includes("RATIONALE:")) continue;
    const lines = [
      ...bytes.matchAll(/(DECISION|AMOUNT):\s*\**\s*([^\\\n"*<]+)/g),
    ].map((m) => `${m[1] ?? ""}: ${(m[2] ?? "").trim()}`);
    if (lines.length > 0) found = lines.join(" · ");
  }
  return found;
}

/**
 * Fetch a claims-demo evidence pack (`<packUrl>/pack/bundle.json` +
 * `<packUrl>/logs-mapping.json`) and verify it OFFLINE with the vendored
 * @sanning/proof kernel — signature, payload binding, Merkle inclusion,
 * and disclosed-content hashes. Network is used only to FETCH the pack;
 * the verification itself is local math.
 */
export async function verifyPackAtUrl(packUrl: string): Promise<PackVerification> {
  const base = packUrl.replace(/\/+$/, "");
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${base}${path} -> HTTP ${String(res.status)}`);
    }
    return res.json();
  };

  const bundle = await get("/pack/bundle.json");
  // The logs mapping is the pack's raw-bytes side input ({ eventId: utf8 }).
  // Absent mapping -> hash-only verification (contentOk stays null).
  let logs: Record<string, string> = {};
  try {
    logs = (await get("/logs-mapping.json")) as Record<string, string>;
  } catch {
    logs = {};
  }

  // The kernel's side-input convention (same as its CLI): a string is HEX;
  // raw utf8 text must be handed over as bytes. Get this wrong and the
  // content binding silently degrades to "undetermined" instead of
  // failing on tamper — the exact opposite of the tool's purpose.
  const content: Record<string, Uint8Array | string> = {};
  for (const [eventId, value] of Object.entries(logs)) {
    if (typeof value !== "string") continue;
    content[eventId] =
      value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/.test(value)
        ? value // hex passthrough
        : new TextEncoder().encode(value);
  }

  const result = await verifyEvidenceBundle(bundle, { content });
  const eventsVerified = result.events.filter((e) => e.ok).length;
  const eventsFailed = result.events.length - eventsVerified;
  return {
    packUrl: base,
    verdict: result.status,
    eventsVerified,
    eventsFailed,
    checkpointTxIds: result.checkpoints.map((c) => c.txId),
    upstreamDecision:
      result.status === "verified" ? upstreamDecisionFrom(logs) : null,
    errors: [
      ...result.errors,
      ...result.events.flatMap((e) => e.errors),
      ...result.checkpoints.flatMap((c) => c.errors),
    ].slice(0, 5),
  };
}

// ---- the tools -------------------------------------------------------------

// Deterministic on purpose (reads over committed fixtures): the LLM
// reasons, the tools never vary, so a session's shape is reproducible.
// The one tool that touches the network — verify_evidence_pack — is
// deterministic over its INPUT: same pack bytes, same verdict.
export const recoveryTools = [
  stringTool({
    definition: {
      name: "verify_evidence_pack",
      description:
        "Verify the upstream claim adjudication's sealed evidence pack. " +
        "Fetches the pack from the given URL and verifies it offline with " +
        "the Sanning proof kernel (signatures, Merkle inclusion, disclosed " +
        "content hashes). Returns the verdict and the adjudicated decision. " +
        "Call this FIRST — recovery work is only actionable on a verified " +
        "upstream record.",
      inputSchema: {
        type: "object",
        properties: {
          packUrl: {
            type: "string",
            description:
              "The pack's base URL, exactly as given in the assignment. " +
              "Omit when the referral carries none — the recorded verdict " +
              "is then 'unavailable', which is itself evidence.",
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const packUrl = typeof args["packUrl"] === "string" ? args["packUrl"] : "";
      if (packUrl === "") {
        return JSON.stringify({
          verdict: "unavailable",
          error:
            "no pack URL was provided — there is no upstream evidence pack to verify",
        });
      }
      try {
        return JSON.stringify(await verifyPackAtUrl(packUrl), null, 2);
      } catch (err) {
        return JSON.stringify({
          verdict: "unavailable",
          packUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  }),
  stringTool({
    definition: {
      name: "read_investigation_report",
      description:
        "Read the post-payment cause-and-origin investigation report for the " +
        "fire claim: origin, refined cause, and the identified liable party.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => loadFixture("investigation-CLM-2026-3105.json"),
  }),
  stringTool({
    definition: {
      name: "read_policy_recovery_clause",
      description:
        "Read the policy's subrogation and recovery clause: demand basis, " +
        "pursue/decline thresholds, and the authority rules for issuance.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => loadFixture("recovery-clause-HO-77341-2024.json"),
  }),
  stringTool({
    definition: {
      name: "read_payout_record",
      description:
        "Read the payout record for the claim: adjudicated decision, amount " +
        "paid, deductible, payment details, and the recovery referral.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => loadFixture("payout-CLM-2026-3105.json"),
  }),
  stringTool({
    definition: {
      name: "draft_demand_letter",
      description:
        "Draft (do not send) the recovery demand letter to the liable party. " +
        "Provide the target, the amount, and the liability basis; returns the " +
        "letter as filed to the recovery casefile.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "The liable party the demand addresses." },
          amount: { type: "number", description: "The demand amount in USD." },
          basis: { type: "string", description: "One-paragraph liability basis for the demand." },
        },
        required: ["target", "amount", "basis"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const target = String(args["target"] ?? "the liable party");
      const amount = Number(args["amount"] ?? 0);
      const basis = String(args["basis"] ?? "");
      return [
        `DRAFT — NOT ISSUED · filed to recovery casefile ${DEFAULT_CASE_REF}`,
        ``,
        `To: ${target}`,
        `Re: Subrogation demand — fire loss of 2026-07-19, our claim ${DEFAULT_CASE_REF}`,
        ``,
        `Meridian Mutual, as subrogee of its insured, demands payment of ` +
          `$${amount.toLocaleString("en-US")} for the fire loss paid under the ` +
          `above claim.`,
        ``,
        `Basis: ${basis}`,
        ``,
        `The adjudication of the underlying claim is sealed in a verifiable ` +
          `evidence pack; verification details are available on request.`,
        ``,
        `Status: DRAFT. Issuance requires supervising counsel sign-off.`,
      ].join("\n");
    },
  }),
  stringTool({
    definition: {
      name: BLOCKED_TOOL,
      description:
        "Issue (send) the drafted recovery demand letter to the liable party.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => {
      throw new Error("unreachable — authorization denies this tool");
    },
  }),
];

// The governance policy, as a real authorize hook: everything is allowed
// except issuance. The denial is the point — it becomes an anchored,
// independently provable `interchange.tool_blocked` record.
export const recoveryAuthorize: BaseEnv["authorize"] = async (resource) =>
  resource === `tool:${BLOCKED_TOOL}`
    ? { effect: "deny", matchingGrants: [], resolvedBy: null }
    : { effect: "allow", matchingGrants: [], resolvedBy: null };

export const SYSTEM_PROMPT = `You are the AI recovery (subrogation) specialist at Meridian Mutual.
You work recovery referrals on claims that have already been adjudicated
and paid. You never revisit the coverage decision.

Procedure, strictly in this order:
1. verify_evidence_pack — verify the upstream adjudication's sealed
   evidence pack at the URL given in the assignment. This comes FIRST,
   and it is ALWAYS called: if no pack URL was provided, call it with no
   URL anyway, so the unavailability itself goes on the record. The gate
   is the VERDICT alone: "verified" means proceed (the upstreamDecision
   field is a convenience summary — its absence is never a reason to
   decline; the payout record carries the adjudicated outcome). If the
   recorded verdict is anything other than "verified", STOP: do not read
   the casefile, do not draft anything. Your final message must then be
   DECISION: DECLINE with AMOUNT: none and TARGET: none, and the
   RATIONALE must say exactly why the upstream record could not be
   verified. An unverifiable record is not actionable.
2. read_investigation_report — the cause-and-origin findings and the
   identified liable party.
3. read_policy_recovery_clause — the subrogation clause, the demand
   basis, and the pursue/decline thresholds.
4. read_payout_record — what was actually paid, and the deductible.
5. Decide PURSUE or DECLINE strictly per the clause's thresholds. The
   demand amount follows the clause's demand basis (amount paid plus the
   insured's deductible).
6. If PURSUE: draft_demand_letter with the target, amount, and basis.
7. Then attempt send_demand_letter. If authorization denies it, report
   the denial and note that issuance goes to supervising counsel — the
   attempt and its denial are part of the record.

Your final message must be exactly this shape:

DECISION: <PURSUE | DECLINE>
AMOUNT: <the demand amount, e.g. $46,500, or "none">
TARGET: <the liable party, or "none">
RATIONALE: <2-4 sentences citing the verified upstream decision, the
investigation findings, and the clause criteria that determine the
outcome. Note anything you attempted and were prevented from doing.
Plain language; supervising counsel reads this first.>`;

/** The run prompt: the assignment handed to the specialist. `packUrl`
 *  absent is a legitimate input — the required outcome is a refusal. */
export function buildRunPrompt(opts: { caseRef?: string; packUrl?: string } = {}): string {
  const caseRef = opts.caseRef ?? DEFAULT_CASE_REF;
  const packLine =
    opts.packUrl !== undefined && opts.packUrl !== ""
      ? `The upstream adjudication's sealed evidence pack is at: ${opts.packUrl}`
      : "No evidence pack URL accompanies this referral.";
  return (
    `Recovery referral on claim ${caseRef} (fire loss, paid). ` +
    `Work the referral per your procedure and report your decision.\n` +
    packLine
  );
}
