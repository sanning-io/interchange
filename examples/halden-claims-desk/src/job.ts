// The Inward Claims job: Halden Indemnity's commercial-liability claims
// agent, receiving the OTHER side of the claims-demo story. Meridian
// Mutual has paid its policyholder, decided to pursue recovery, and its
// demand — with the evidence packs of its own agents' work attached —
// lands on the desk of the insurer for Hollis & Verne Electrical.
//
// The counterparty stance, in one line: Halden verifies the sender's
// evidence with the public verification kernels and NO account on the
// sender's platform — verification is free and open; only the producer
// pays. What Halden concedes after verification is a separate question,
// and that separation ("acceptance of the record is not acceptance of
// liability") is the whole voice of the house.
//
// Two kernels, dispatched by the pack's own spec_version: `sanning.*`
// packs verify with the vendored @sanning/proof kernel, `ario.*` packs
// with the published @ar.io/proof kernel. Both verifications are local
// math over fetched bytes; no credential is sent anywhere.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type } from "arktype";

import { verifyEvidenceBundle as verifyArioBundle } from "@ar.io/proof";
import { verifyEvidenceBundle as verifySanningBundle } from "@sanning/proof";

import { stringTool, type AgentTool, type BaseEnv } from "@intx/agent";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");
const loadFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

export const POLICY_ID = "CGL-118-4720";
export const INSURED = "Hollis & Verne Electrical";

/** The governance gate: the desk may acknowledge, verify, and dispute —
 *  it may never admit liability. Authorization denies this tool. */
export const BLOCKED_TOOL = "admit_liability";

// ---- desk events the serve layer watches ----------------------------------

/** What the tools tell the desk as they work — purely observational;
 *  the tools' return values (the agent's record) are unchanged. */
export type DeskObservation =
  | { kind: "tool_start"; tool: string }
  | { kind: "pack_examining"; packUrl: string }
  | {
      kind: "pack_verdict";
      packUrl: string;
      verdict: string;
      specVersion: string | null;
      kernel: string | null;
      recordsVerified: number;
      recordsFailed: number;
      checkpointTxIds: string[];
      errors: string[];
    }
  | {
      kind: "letter_filed";
      disposition: string;
      senderRef: string;
      positionBy: string;
      text: string;
    };

export type DeskObserver = (event: DeskObservation) => void;

// ---- pack verification: the right kernel by spec_version ------------------

interface PackRecordSummary {
  record: number;
  label: string;
  blocked: boolean;
  preview: string | null;
}

interface PackVerification {
  packUrl: string;
  specVersion: string | null;
  kernel: string | null;
  verdict: string;
  recordsVerified: number;
  recordsFailed: number;
  checkpointTxIds: string[];
  decisionLines: string | null;
  records: PackRecordSummary[];
  errors: string[];
}

// Minimal common shape of both kernels' results — the packages are
// separate publications with nominally distinct types, so the dispatch
// validates down to what the desk actually reads (per repo convention:
// validated, not asserted).
const KernelResult = type({
  status: "string",
  events: type({ ok: "boolean", errors: "string[]" }).array(),
  checkpoints: type({ txId: "string", errors: "string[]" }).array(),
  errors: "string[]",
});
type KernelResult = typeof KernelResult.infer;

// What the desk reads off a fetched bundle for its citation summary —
// spec_version to dispatch on, and the disclosed events to number.
const BundleShape = type({
  spec_version: "string",
  "body?": {
    events: type({
      envelope: { event_id: "string" },
      "content?": "unknown",
    }).array(),
  },
});

const LogsMapping = type("Record<string, string>");

// An interchange audit record, as disclosed inside a pack.
const DisclosedToolRecord = type({
  tool: "string",
  "authz?": type({ blocked: "boolean" }).or("null"),
});

const HEX_RE = /^[0-9a-f]+$/;

const isHex = (s: string): boolean =>
  s.length > 0 && s.length % 2 === 0 && HEX_RE.test(s);

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

// The disclosed text of one pack record, for the desk's citation
// summary: in-body content first (hex-encoded bytes), the logs-mapping
// side input second (raw utf8, or hex per the kernels' convention).
function disclosedText(
  inBody: unknown,
  sideInput: string | undefined,
): string | null {
  if (typeof inBody === "string" && isHex(inBody)) return hexToUtf8(inBody);
  if (typeof inBody === "string") return inBody;
  if (sideInput !== undefined) {
    return isHex(sideInput) ? hexToUtf8(sideInput) : sideInput;
  }
  return null;
}

// A one-line reading label for a disclosed record: interchange audit
// records name their tool; anything else is a model exchange.
function recordLabel(text: string): { label: string; blocked: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { label: "record", blocked: false };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { label: "record", blocked: false };
  }
  const toolRecord = DisclosedToolRecord(parsed);
  if (!(toolRecord instanceof type.errors)) {
    const blocked = toolRecord.authz?.blocked === true;
    return {
      label: `${blocked ? "tool blocked" : "tool call"} — ${toolRecord.tool}`,
      blocked,
    };
  }
  return {
    label: `model exchange (${Object.keys(parsed).join(", ")})`,
    blocked: false,
  };
}

// A bounded plain-text preview so the agent can cite records by number.
function preview(text: string): string {
  const flat = text
    .replaceAll("\\n", " ")
    .replaceAll('\\"', '"')
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 640 ? `${flat.slice(0, 640)}…` : flat;
}

// The sender's own pinned decision lines (DECISION:/AMOUNT:), scanned
// out of the verified logs — same trap-aware scan the Meridian-side
// example uses: committed newlines are the two characters `\` `n`, and
// the LAST matching log wins (the final message, not the prompt).
function decisionLinesFrom(texts: (string | null)[]): string | null {
  let found: string | null = null;
  for (const bytes of texts) {
    if (bytes === null || !bytes.includes("RATIONALE:")) continue;
    const lines = [
      ...bytes.matchAll(/(DECISION|AMOUNT):\s*\**\s*([^\\\n"*<]+)/g),
    ].map((m) => `${m[1] ?? ""}: ${(m[2] ?? "").trim()}`);
    if (lines.length > 0) found = lines.join(" · ");
  }
  return found;
}

/**
 * Fetch an evidence pack (`<packUrl>/pack/bundle.json` +
 * `<packUrl>/logs-mapping.json`) and verify it OFFLINE with the kernel
 * its own spec_version names: `sanning.*` → the vendored @sanning/proof,
 * `ario.*` → the published @ar.io/proof. Network is used only to FETCH
 * the pack; the verification is local math, and no Sanning credential
 * exists anywhere in this example.
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
  let logs: Record<string, string> = {};
  try {
    const parsedLogs = LogsMapping(await get("/logs-mapping.json"));
    if (!(parsedLogs instanceof type.errors)) logs = parsedLogs;
  } catch {
    // absent mapping -> hash-only verification of undisclosed records
  }

  const shaped = BundleShape(bundle);
  const specVersion =
    shaped instanceof type.errors ? null : shaped.spec_version;

  // The kernels' side-input convention (same as their CLIs): a string is
  // HEX; raw utf8 text must be handed over as bytes. Get this wrong and
  // the content binding silently degrades to "undetermined" instead of
  // failing on tamper.
  const content: Record<string, Uint8Array | string> = {};
  for (const [eventId, value] of Object.entries(logs)) {
    if (typeof value !== "string") continue;
    content[eventId] = isHex(value) ? value : new TextEncoder().encode(value);
  }

  let kernel: string | null;
  let rawResult: unknown;
  if (specVersion?.startsWith("sanning.") === true) {
    kernel = "@sanning/proof 0.4.0 (vendored)";
    rawResult = await verifySanningBundle(bundle, { content });
  } else if (specVersion?.startsWith("ario.") === true) {
    kernel = "@ar.io/proof 0.3.0 (npm)";
    rawResult = await verifyArioBundle(bundle, { content });
  } else {
    return {
      packUrl: base,
      specVersion,
      kernel: null,
      verdict: "unsupported",
      recordsVerified: 0,
      recordsFailed: 0,
      checkpointTxIds: [],
      decisionLines: null,
      records: [],
      errors: [
        `unsupported spec_version ${JSON.stringify(specVersion)} — no kernel claims it`,
      ],
    };
  }

  const result = KernelResult(rawResult);
  if (result instanceof type.errors) {
    throw new Error(`unexpected kernel result shape: ${result.summary}`);
  }

  const recordsVerified = result.events.filter((e) => e.ok).length;
  const recordsFailed = result.events.length - recordsVerified;
  const verified = result.status === "verified";

  // Citation summary — built only AFTER the verdict, and only for a
  // verified pack: the desk does not read what did not verify.
  const records: PackRecordSummary[] = [];
  const texts: (string | null)[] = [];
  if (verified && !(shaped instanceof type.errors) && shaped.body !== undefined) {
    for (const [i, ev] of shaped.body.events.entries()) {
      const text = disclosedText(ev.content, logs[ev.envelope.event_id]);
      texts.push(text);
      if (text === null) {
        records.push({
          record: i + 1,
          label: "record (content not disclosed; hash verified)",
          blocked: false,
          preview: null,
        });
        continue;
      }
      const { label, blocked } = recordLabel(text);
      records.push({ record: i + 1, label, blocked, preview: preview(text) });
    }
  }

  return {
    packUrl: base,
    specVersion,
    kernel,
    verdict: result.status,
    recordsVerified,
    recordsFailed,
    checkpointTxIds: result.checkpoints.map((c) => c.txId),
    decisionLines: verified ? decisionLinesFrom(texts) : null,
    records,
    errors: [
      ...result.errors,
      ...result.events.flatMap((e) => e.errors),
      ...result.checkpoints.flatMap((c) => c.errors),
    ].slice(0, 5),
  };
}

// ---- the tools -------------------------------------------------------------

export interface DeskCaseContext {
  /** Halden's file reference for this demand, e.g. HIC-2026-0412. */
  fileRef: string;
  /** The demand letter exactly as received. */
  demandText: string;
  /** Purely observational feed to the desk surface. */
  observe?: DeskObserver;
}

/**
 * Build the desk's tools for ONE case. Deterministic reads over the
 * received demand and the committed fixtures; the one network tool —
 * verify_evidence_pack — is deterministic over its input: same pack
 * bytes, same verdict.
 */
export function buildDeskTools(ctx: DeskCaseContext): AgentTool[] {
  const observe: DeskObserver = (event) => {
    try {
      ctx.observe?.(event);
    } catch {
      // A watching surface must never affect the record.
    }
  };

  return [
    stringTool({
      definition: {
        name: "verify_evidence_pack",
        description:
          "Verify one evidence pack offered with the demand. Fetches the " +
          "pack from the given URL and verifies it offline with the public " +
          "verification kernel its own spec_version names (sanning.* or " +
          "ario.*) — signatures, Merkle inclusion, disclosed-content " +
          "hashes. No account and no credential of the sender's platform " +
          "is used. Returns the verdict, record counts, and (for a " +
          "verified pack) a numbered record summary for citation. Call " +
          "this FIRST for every pack; nothing is read before it verifies.",
        inputSchema: {
          type: "object",
          properties: {
            packUrl: {
              type: "string",
              description: "The pack's base URL, exactly as given in the assignment.",
            },
          },
          required: ["packUrl"],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        const packUrl = typeof args["packUrl"] === "string" ? args["packUrl"] : "";
        observe({ kind: "tool_start", tool: "verify_evidence_pack" });
        if (packUrl === "") {
          return JSON.stringify({
            verdict: "unavailable",
            error: "no pack URL was provided",
          });
        }
        observe({ kind: "pack_examining", packUrl });
        try {
          const verification = await verifyPackAtUrl(packUrl);
          observe({
            kind: "pack_verdict",
            packUrl,
            verdict: verification.verdict,
            specVersion: verification.specVersion,
            kernel: verification.kernel,
            recordsVerified: verification.recordsVerified,
            recordsFailed: verification.recordsFailed,
            checkpointTxIds: verification.checkpointTxIds,
            errors: verification.errors,
          });
          return JSON.stringify(verification, null, 2);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          observe({
            kind: "pack_verdict",
            packUrl,
            verdict: "unavailable",
            specVersion: null,
            kernel: null,
            recordsVerified: 0,
            recordsFailed: 0,
            checkpointTxIds: [],
            errors: [message],
          });
          return JSON.stringify({ verdict: "unavailable", packUrl, error: message });
        }
      },
    }),
    stringTool({
      definition: {
        name: "read_demand_letter",
        description:
          "Read the recovery demand exactly as received at the desk, " +
          "including the sender's theory of liability and the amount demanded.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      handler: async () => {
        observe({ kind: "tool_start", tool: "read_demand_letter" });
        return ctx.demandText;
      },
    }),
    stringTool({
      definition: {
        name: "read_policy_certificate",
        description:
          "Read our insured's commercial general liability policy with " +
          "Halden (limits, period, conditions — including the desk's " +
          "authority and the no-voluntary-admission condition).",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      handler: async () => {
        observe({ kind: "tool_start", tool: "read_policy_certificate" });
        return loadFixture("policy-certificate-CGL-118-4720.json");
      },
    }),
    stringTool({
      definition: {
        name: "read_fnol_extract",
        description:
          "Read the desk's extract of the sender's own first-notice-of-loss " +
          "and field-inspection language, quoted verbatim from the disclosed " +
          "records of the sender's adjudication pack. Usable only after that " +
          "pack has verified.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      handler: async () => {
        observe({ kind: "tool_start", tool: "read_fnol_extract" });
        return loadFixture("fnol-extract-FNOL-2026-3105.json");
      },
    }),
    stringTool({
      definition: {
        name: "draft_response_letter",
        description:
          "File Halden's response to the demand. Provide the disposition " +
          "(accept | dispute | request-more), the sender's reference line, " +
          "the date Halden commits to, and the letter body. Returns the " +
          "letter as filed.",
        inputSchema: {
          type: "object",
          properties: {
            disposition: {
              type: "string",
              enum: ["accept", "dispute", "request-more"],
              description: "Halden's position on the demand.",
            },
            senderRef: {
              type: "string",
              description:
                "The sender's claim reference the letter answers, e.g. CLM-2026-3105.",
            },
            positionBy: {
              type: "string",
              description:
                "The date this letter commits Halden to (ISO date). Every letter commits to a date.",
            },
            body: {
              type: "string",
              description:
                "The letter body in Halden's register — paragraphs separated by blank lines. " +
                "Do not include the reference line or the signature block; the desk sets both.",
            },
          },
          required: ["disposition", "senderRef", "positionBy", "body"],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        const disposition = String(args["disposition"] ?? "dispute");
        const senderRef = String(args["senderRef"] ?? "");
        const positionBy = String(args["positionBy"] ?? "");
        const body = String(args["body"] ?? "").trim();
        const text = [
          `RE ${senderRef} · OUR FILE ${ctx.fileRef} · POLICY ${POLICY_ID}`,
          ``,
          body,
          ``,
          `HALDEN INDEMNITY COMPANY`,
          `Inward Claims — Recovery Response`,
          `File ${ctx.fileRef}`,
        ].join("\n");
        observe({
          kind: "letter_filed",
          disposition,
          senderRef,
          positionBy,
          text,
        });
        return `FILED — ${disposition.toUpperCase()} · ${ctx.fileRef}\n\n${text}`;
      },
    }),
    stringTool({
      definition: {
        name: BLOCKED_TOOL,
        description:
          "Admit liability for the demand on behalf of our insured. " +
          "Reserved to supervising counsel under the policy's " +
          "no-voluntary-admission condition; authorization denies this desk.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      handler: async () => {
        throw new Error("unreachable — authorization denies this tool");
      },
    }),
  ];
}

// The governance policy, as a real authorize hook: the desk may
// acknowledge, verify, dispute, and accept payment — it may never admit
// liability. The denial lands in the desk's signed git logbook like
// every other record.
export const deskAuthorize: BaseEnv["authorize"] = async (resource) =>
  resource === `tool:${BLOCKED_TOOL}`
    ? { effect: "deny", matchingGrants: [], resolvedBy: null }
    : { effect: "allow", matchingGrants: [], resolvedBy: null };

// The register below is carried verbatim from the house voice guide
// (halden-brand: agent-voice.md) — it IS the deliverable.
export const SYSTEM_PROMPT = `You are the commercial-liability claims agent at the Halden Indemnity
Company (worker Halden-Indemnity.Inward-Claims), Hartford, est. 1908.
You work the inward recovery desk: another insurer has paid its own
policyholder and demands recovery from Halden's insured. You examine
the thing itself, believe no one's word, and put your stamp only on
what passes. Inspection before indemnity.

The register, in force everywhere — letters, notes, and your own
reasoning steps:
1. Short declarative sentences. One fact per sentence.
2. Exact figures, exact dates, named documents. "$45,500.00", never
   "the amount in question".
3. Civil, never warm. Courtesy is procedural: "Receipt is
   acknowledged," not "Thanks for sending this over."
4. Firm, never rude. Never characterize the other party's motives,
   competence, or good faith — only their documents.
5. The record and the conclusion are always distinguished. Concede a
   verified fact in the same paragraph you dispute what the fact
   proves. The house sentences: "Acknowledgment is not an admission of
   liability." and "Acceptance of the record is not acceptance of
   liability." Use them at the natural point in every acknowledgment
   and every position letter.
6. Cite evidence by record number, never paraphrase when you can quote.
7. Every letter commits to a date, and Halden keeps it.
8. No exclamation marks, no rhetorical questions, no adjectives of
   emphasis (clearly, obviously, simply).
9. Where Halden declines, state what would change Halden's position.
   A dispute is a door left open on Halden's terms.
10. Passive voice only where procedure is the actor ("Payment will
    issue"); active voice where Halden acts ("We decline the demand as
    presented").
Banned: exclamation marks, "trust", "obviously/clearly/simply",
warmth, apology, and any verdict on the record before verification
completes.

Procedure, strictly in this order:
1. verify_evidence_pack — once for EACH pack URL in the assignment, in
   the order given. Verification comes FIRST: nothing is read and no
   position is formed before every offered pack has a recorded verdict.
   The verdict is the kernel's alone. A pack that verifies is a
   genuine, unaltered record; what the record proves remains open. A
   pack that does not verify is not evidence.
2. read_demand_letter — the demand as received.
3. read_policy_certificate — our insured's policy with Halden.
4. read_fnol_extract — the sender's own first-notice and
   field-inspection language, quoted from their verified record.
5. Compare the demand's theory of liability against the verified
   record. Note where the sender's own records support their theory
   and where they do not. Cite records by pack and record number —
   but ONLY record numbers whose preview in the verification summary
   shows the content you cite. If no preview shows it, cite the pack
   without a record number. A wrong citation is worse than none.
6. Decide ACCEPT, DISPUTE, or REQUEST-MORE.
   - ACCEPT only where the verified record itself establishes our
     insured's liability under the policy. Before drafting an
     acceptance, attempt admit_liability; when authorization denies
     it, note the denial — admission is reserved to supervising
     counsel, and an acceptance letter accepts payment while stating
     that acceptance of the record is not acceptance of liability.
   - DISPUTE where the verified record does not establish the demand's
     theory. Argue from the sender's own records, by record number.
     Never call admit_liability on a dispute.
   - REQUEST-MORE where a pack failed verification, or the record is
     silent on a point the decision requires.
7. draft_response_letter — Halden's position in Halden's voice. The
   letter commits to a date. A dispute states what would change
   Halden's position.

Your final message must be exactly this shape:

DECISION: <ACCEPT | DISPUTE | REQUEST-MORE>
BASIS: <2-4 sentences citing each pack's verdict and the specific
record numbers the decision turns on. Distinguish what the record
establishes from what the sender concludes. Note anything you
attempted and were prevented from doing.>
RESPONSE: <one line: the disposition of the letter filed and the date
it commits Halden to.>`;

/** The assignment handed to the desk when a demand is filed. Packs are
 *  named by RECORD REFERENCE; the URL is the verify tool's machine
 *  address, never a citation — letters cite references only. */
export function buildCasePrompt(opts: {
  fileRef: string;
  receivedAt: string;
  packs: readonly { ref: string; url: string }[];
}): string {
  const packLines =
    opts.packs.length > 0
      ? opts.packs
          .map(
            (p, i) =>
              `  ${String(i + 1)}. record ${p.ref} ` +
              `(verify_evidence_pack packUrl: ${p.url})`,
          )
          .join("\n")
      : "  (none on file)";
  return (
    `Inward recovery demand received ${opts.receivedAt.slice(0, 10)}. ` +
    `Our file: ${opts.fileRef}. ` +
    `The demand is asserted against our insured, ${INSURED}, and is on ` +
    `file (read_demand_letter). Evidence records located for the file:\n` +
    `${packLines}\n` +
    `Work the demand per your procedure and report your decision. In ` +
    `letters and notes, cite each evidence record by its record ` +
    `reference (e.g. "${opts.packs[0]?.ref ?? "the record"}"), never by ` +
    `URL — a URL is a machine address, not a citation. Dates Halden ` +
    `commits to run from the received date.`
  );
}
