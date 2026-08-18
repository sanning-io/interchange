// The desk's case state: one DeskCase per inward demand, held in memory
// and persisted as plain JSON under `<contextDir>/cases/` so a restart
// re-serves the latest case. This is SURFACE state (what the page
// shows); the audit record proper is the SSH-signed git logbook the
// composition writes — the two are deliberately separate planes.
//
// Shapes are arktype-defined and validated on load (per repo
// convention: validated, not asserted).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

export const PackPanel = type({
  url: "string",
  /** The last path segment — the sender's session directory name. */
  ref: "string",
  status: "'offered' | 'examining' | 'verified' | 'failed'",
  specVersion: "string | null",
  kernel: "string | null",
  verdict: "string | null",
  recordsVerified: "number",
  recordsFailed: "number",
  checkpointTxIds: "string[]",
  errors: "string[]",
});
export type PackPanel = typeof PackPanel.infer;
export type PackStatus = PackPanel["status"];

export const StepEntry = type({
  at: "string",
  kind: "'desk' | 'tool' | 'record' | 'blocked' | 'reply' | 'error'",
  text: "string",
});
export type StepEntry = typeof StepEntry.infer;

export const DeskLetter = type({
  disposition: "string",
  senderRef: "string",
  positionBy: "string",
  text: "string",
  filedAt: "string",
});
export type DeskLetter = typeof DeskLetter.infer;

export const DeskDecision = type({
  decision: "string",
  basis: "string",
  response: "string",
});
export type DeskDecision = typeof DeskDecision.infer;

/** The evidence request filed on the case: what was asked for, when,
 *  and how many records the resolver located. */
export const EvidenceRequest = type({
  claimRef: "string",
  since: "string",
  until: "string",
  kinds: "string[]",
  requestedAt: "string",
  /** Records the resolver located: a count, or null when the request
   *  never resolved (the records service could not be read). */
  located: "number | null",
});
export type EvidenceRequest = typeof EvidenceRequest.infer;

export const DeskCase = type({
  fileRef: "string",
  receivedAt: "string",
  status: "'received' | 'examining' | 'concluded' | 'error'",
  demandText: "string",
  /** The claim reference the demand cites (identifier-only filings). */
  claimRef: "string | null",
  /** The loss date the demand cites, ISO. */
  lossDate: "string | null",
  /** The evidence request, once one has been filed on the case. */
  request: EvidenceRequest.or("null"),
  packs: PackPanel.array(),
  steps: StepEntry.array(),
  letter: DeskLetter.or("null"),
  decision: DeskDecision.or("null"),
  reply: "string | null",
  error: "string | null",
});
export type DeskCase = typeof DeskCase.infer;

export const packRef = (url: string): string => {
  const clean = url.replace(/\/+$/, "");
  const seg = clean.slice(clean.lastIndexOf("/") + 1);
  return seg === "" ? clean : seg;
};

export function newCase(
  fileRef: string,
  demandText: string,
  opts: {
    /** Legacy filings attach packs directly; identifier-only filings
     *  start with none — evidence arrives by request. */
    packUrls?: readonly string[];
    claimRef?: string | null;
    lossDate?: string | null;
  } = {},
): DeskCase {
  const packUrls = opts.packUrls ?? [];
  return {
    fileRef,
    receivedAt: new Date().toISOString(),
    status: "received",
    demandText,
    claimRef: opts.claimRef ?? null,
    lossDate: opts.lossDate ?? null,
    request: null,
    packs: packUrls.map((url) => ({
      url: url.replace(/\/+$/, ""),
      ref: packRef(url),
      status: "offered" as const,
      specVersion: null,
      kernel: null,
      verdict: null,
      recordsVerified: 0,
      recordsFailed: 0,
      checkpointTxIds: [],
      errors: [],
    })),
    steps: [],
    letter: null,
    decision: null,
    reply: null,
    error: null,
  };
}

/** Parse the agent's pinned DECISION:/BASIS:/RESPONSE: lines. Bold
 *  markers and stray whitespace are tolerated; order is fixed. */
export function parsePinnedReply(reply: string): DeskDecision | null {
  const m = reply.match(
    /DECISION:\s*\**\s*([A-Z][A-Z-]*)\**[\s\S]*?BASIS:\s*\**\s*([\s\S]*?)\s*\**\s*RESPONSE:\s*\**\s*([\s\S]*?)\s*$/,
  );
  if (m === null) return null;
  const clean = (s: string): string => s.replaceAll("**", "").trim();
  return {
    decision: clean(m[1] ?? ""),
    basis: clean(m[2] ?? ""),
    response: clean(m[3] ?? ""),
  };
}

// ---- persistence -----------------------------------------------------------

const casesDir = (contextDir: string): string => join(contextDir, "cases");

export function saveCase(contextDir: string, deskCase: DeskCase): void {
  const dir = casesDir(contextDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${deskCase.fileRef}.json`),
    JSON.stringify(deskCase, null, 2) + "\n",
  );
}

export function loadCases(contextDir: string): DeskCase[] {
  const dir = casesDir(contextDir);
  if (!existsSync(dir)) return [];
  const cases: DeskCase[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue; // an unreadable case file is skipped, not fatal
    }
    // Cases persisted before the identifier flow lack the newer fields;
    // default them so the record stays loadable across the change.
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      parsed = { claimRef: null, lossDate: null, request: null, ...parsed };
    }
    const validated = DeskCase(parsed);
    if (validated instanceof type.errors) continue;
    cases.push(validated);
  }
  cases.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return cases;
}
