// The Meridian day, as Interchange-idiom jobs: the same story the
// claims-demo Workbench runs — a fire FNOL triaged, the claim it became
// adjudicated, the household's renewal reviewed, and the paid claim's
// recovery worked — each stage one anchored agent session. WHAT each
// stage does lives here (fixtures, tools, prompts); the plumbing
// (identity, storage, anchoring) is the sibling example's composition,
// reused unchanged.
//
// The recovery stage IS the sibling example's job (`RECOVERY_JOB`):
// the demo grid's stage four always ran on Interchange, and this
// estate simply runs it beside its upstream stages instead of across
// an HTTP seam to the claims-demo repo.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRunPrompt,
  DEFAULT_CASE_REF,
  RECOVERY_JOB,
  type JobSpec,
} from "@intx/example-agent-anchored-audit";
import { stringTool, type BaseEnv } from "@intx/agent";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
);
const loadFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

/** Everything is allowed — the day's one governance denial lives in the
 *  recovery stage's own policy (issuance is counsel's). */
const allowAll: BaseEnv["authorize"] = async () => ({
  effect: "allow",
  matchingGrants: [],
  resolvedBy: null,
});

/** Every stage files its final pinned block to the record BEFORE
 *  replying — the decision itself becomes an anchored, disclosed
 *  record inside the sealed pack, not just chat output. */
const fileReportTool = stringTool({
  definition: {
    name: "file_stage_report",
    description:
      "File your final report block to the case record, verbatim, before " +
      "replying. The filed report is committed to the anchored audit " +
      "record like every other action.",
    inputSchema: {
      type: "object",
      properties: {
        report: {
          type: "string",
          description:
            "The exact final report block you are about to reply with.",
        },
      },
      required: ["report"],
      additionalProperties: false,
    },
  },
  handler: async () => JSON.stringify({ filed: true }),
});

const readTool = (name: string, description: string, fixture: string) =>
  stringTool({
    definition: {
      name,
      description,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async () => loadFixture(fixture),
  });

// ---- stage descriptors -----------------------------------------------------

export interface StageSpec {
  /** Stable stage id — orders the day and names the context dir. */
  stageId: string;
  title: string;
  /** The estate category — what a counterparty's evidence request
   *  resolves against (the desk consumes `claims-adjudication` and
   *  `recovery`). */
  category: string;
  /** The sealed producer name (SANNING_AGENT_NAME; no spaces). */
  agentName: string;
  /** The roster display name (never sealed). */
  displayName: string;
  caseRef: string;
  job: JobSpec;
  /** The assignment handed to the agent. `packUrl` reaches only the
   *  recovery stage (its verify-first procedure needs the upstream
   *  adjudication's pack). */
  prompt: (opts: { packUrl?: string }) => string;
}

const intakeJob: JobSpec = {
  id: "meridian-intake-triage",
  systemPrompt: `You are the AI intake-triage specialist at Meridian Mutual.
You route incoming first notices of loss: severity, coverage line, queue.
You never decide coverage — routing only.

Procedure, strictly in this order:
1. read_fnol — the incoming first notice of loss.
2. read_routing_rules — the routing rules for severity, queue, and SLA.
3. Route per the rules exactly.
4. file_stage_report — file your final report block to the record,
   verbatim, before replying.

Your final message must be exactly this shape:

ROUTE: <the queue>
SEVERITY: <major | standard>
LINE: <the coverage line>
RATIONALE: <2-3 sentences citing the FNOL facts and the rule that
determines severity and queue. Plain language.>`,
  tools: [
    readTool(
      "read_fnol",
      "Read the incoming first notice of loss: policy, loss type and date, description, initial estimate, habitability.",
      "fnol-2026-3105.json",
    ),
    readTool(
      "read_routing_rules",
      "Read Meridian's intake routing rules: severity criteria, queues, and SLAs by coverage line.",
      "routing-rules.json",
    ),
    fileReportTool,
  ],
  authorize: allowAll,
};

const adjudicationJob: JobSpec = {
  id: "meridian-claims-adjudication",
  systemPrompt: `You are the AI claims adjudicator at Meridian Mutual.
You decide claims strictly against the policy's written terms — never
sentiment, never precedent.

Procedure, strictly in this order:
1. read_claim_file — the claim, the loss, and the field inspection.
2. read_policy_terms — the policy's coverage, exclusions, limits, and
   deductible.
3. Decide APPROVE or DENY strictly per the written terms. An approved
   amount is the substantiated claimed amount less the deductible, and
   never exceeds the coverage limit.
4. file_stage_report — file your final report block to the record,
   verbatim, before replying.

Your final message must be exactly this shape:

DECISION: <APPROVE | DENY>
AMOUNT: <the approved amount, e.g. $45,500, or "none">
RATIONALE: <2-4 sentences citing the inspection findings and the exact
policy language that determines the outcome. Plain language.>`,
  tools: [
    readTool(
      "read_claim_file",
      "Read the claim file: loss facts, claimed amount, and the field inspection findings.",
      "claim-CLM-2026-3105.json",
    ),
    readTool(
      "read_policy_terms",
      "Read the policy: coverage grants, exclusions, limits, and the deductible.",
      "policy-HO-77341-2024.json",
    ),
    fileReportTool,
  ],
  authorize: allowAll,
};

const renewalJob: JobSpec = {
  id: "meridian-policy-renewal",
  systemPrompt: `You are the AI policy-renewal reviewer at Meridian Mutual.
You review policies approaching renewal against the claims history and
recommend terms. You never re-decide past claims.

Procedure, strictly in this order:
1. read_renewal_review — the renewal file: current premium, tenure,
   requested changes.
2. read_claims_history — the household's claims record.
3. Recommend RENEW, RENEW WITH CONDITIONS, or NON-RENEW. Unrepaired
   known risks documented in the history must surface as conditions.
4. file_stage_report — file your final report block to the record,
   verbatim, before replying.

Your final message must be exactly this shape:

RENEWAL: <RENEW | RENEW WITH CONDITIONS | NON-RENEW>
PREMIUM: <the recommended change, e.g. +12%, or "unchanged">
RATIONALE: <2-4 sentences citing the claims history entries that
determine the recommendation. Plain language.>`,
  tools: [
    readTool(
      "read_renewal_review",
      "Read the renewal review file: renewal date, current premium, tenure, requested changes.",
      "renewal-REN-2026-0114.json",
    ),
    readTool(
      "read_claims_history",
      "Read the policyholder's claims history: past decisions, their bases, and open risk notes.",
      "claims-history-PH-201District.json",
    ),
    fileReportTool,
  ],
  authorize: allowAll,
};

/** The day, in order. The desk's evidence kinds resolve against the
 *  `claims-adjudication` and `recovery` categories. */
export const STAGES: readonly StageSpec[] = [
  {
    stageId: "intake",
    title: "Intake — FNOL triage",
    category: "intake-triage",
    agentName: "Meridian-Mutual.Intake-Triage",
    displayName: "Meridian Mutual — Intake Triage",
    caseRef: "FNOL-2026-3105",
    job: intakeJob,
    prompt: () =>
      "First notice of loss FNOL-2026-3105 has arrived (fire and smoke). " +
      "Triage it per your procedure and report the routing.",
  },
  {
    stageId: "adjudication",
    title: "Claims — adjudication",
    category: "claims-adjudication",
    agentName: "Meridian-Mutual.Claims-Adjudication",
    displayName: "Meridian Mutual — Claims Adjudication",
    caseRef: DEFAULT_CASE_REF,
    job: adjudicationJob,
    prompt: () =>
      `Claim ${DEFAULT_CASE_REF} (fire loss of 2026-07-19) is ready for ` +
      "adjudication. Decide it per your procedure and report the decision.",
  },
  {
    stageId: "renewal",
    title: "Renewal — policy review",
    category: "policy-renewal",
    agentName: "Meridian-Mutual.Policy-Renewal",
    displayName: "Meridian Mutual — Policy Renewal",
    caseRef: "REN-2026-0114",
    job: renewalJob,
    prompt: () =>
      "Renewal review REN-2026-0114 has opened. Review it per your " +
      "procedure and report the recommendation.",
  },
  {
    stageId: "recovery",
    title: "Recovery — subrogation referral",
    category: "recovery",
    agentName: "Meridian-Mutual.Subrogation",
    displayName: "Meridian Mutual — Recovery",
    caseRef: DEFAULT_CASE_REF,
    job: RECOVERY_JOB,
    prompt: ({ packUrl }) =>
      buildRunPrompt({
        caseRef: DEFAULT_CASE_REF,
        ...(packUrl !== undefined && packUrl !== "" ? { packUrl } : {}),
      }),
  },
];

export const stage = (stageId: string): StageSpec | null =>
  STAGES.find((s) => s.stageId === stageId) ?? null;
