// Desk-side reads against the Meridian Workbench's OPEN estate APIs
// (`/api/estate/sessions`, `/sessions/<dir>/…`). Two duties live here:
//
//   fetchLatestDemand  — pull the newest recovery session's drafted
//                        demand, lift it to "issued by counsel" (the
//                        demo's fiction), and extract its IDENTIFIERS
//                        (claim reference, loss date). What crosses the
//                        company seam is the letter and its identifiers
//                        — never a pack URL.
//   resolveEvidence    — answer an evidence REQUEST (claim reference +
//                        time window + record kinds) by locating the
//                        matching sessions on the Workbench. The pack
//                        URLs exist only here, desk-side, as the
//                        resolution's result; no human surface carries
//                        them.
//
// This resolver-against-open-session-listings is interim scaffolding:
// the product version is a console evidence request served by the
// control plane (control-plane#68). The seam it models — demands carry
// identifiers, evidence arrives by request — is the durable part.

import { type } from "arktype";

export const DEFAULT_WORKBENCH_URL = "http://localhost:4601";

/** The Workbench base URL: `MERIDIAN_WORKBENCH_URL`, or the local
 *  claims-demo default. */
export function workbenchUrl(env: NodeJS.ProcessEnv): string {
  const raw = env["MERIDIAN_WORKBENCH_URL"];
  return raw !== undefined && raw !== ""
    ? raw.replace(/\/+$/, "")
    : DEFAULT_WORKBENCH_URL;
}

// ---- the record kinds a counterparty may request --------------------------

export interface EvidenceKind {
  /** Wire id, as the request form submits it. */
  id: string;
  /** The kind as the case file names it. */
  label: string;
  /** The Workbench agent category the kind resolves against. */
  category: string;
}

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  {
    id: "adjudication",
    label: "adjudication record",
    category: "claims-adjudication",
  },
  {
    id: "recovery-working",
    label: "recovery working record",
    category: "recovery",
  },
];

export const evidenceKind = (id: string): EvidenceKind | null =>
  EVIDENCE_KINDS.find((k) => k.id === id) ?? null;

// ---- Workbench shapes (validated, not asserted) ---------------------------

const SessionRow = type({
  sessionDir: "string",
  category: "string",
  recordedAt: "string",
  "caseRef?": "string",
  "golden?": "boolean",
});

const SessionsListing = type({ sessions: SessionRow.array() });

const Timeline = type({
  type: "string",
  "payload?": {
    "tool?": "string",
    "result?": { "content?": "unknown" },
  },
}).array();

async function getValidated<T>(
  url: string,
  schema: (data: unknown) => T | type.errors,
): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${String(res.status)}`);
  const parsed = schema(await res.json());
  if (parsed instanceof type.errors) {
    throw new Error(`${url}: unexpected shape — ${parsed.summary}`);
  }
  return parsed;
}

// Newest first, live sessions before committed goldens.
function newestFirst<T extends { recordedAt: string; golden?: boolean }>(
  rows: readonly T[],
): T[] {
  const sorted = [...rows].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  );
  return [
    ...sorted.filter((r) => r.golden !== true),
    ...sorted.filter((r) => r.golden === true),
  ];
}

// ---- identifier extraction ------------------------------------------------

/** The claim reference the demand cites ("… our claim CLM-2026-3105"). */
export function extractClaimRef(text: string): string | null {
  const m = text.match(/claim\s+([A-Z]{2,6}-\d{4}-\d{3,6})/i);
  return m?.[1] ?? null;
}

/** The loss date the demand cites, as an ISO date. */
export function extractLossDate(text: string): string | null {
  const iso = text.match(/loss (?:of|on|dated) (\d{4}-\d{2}-\d{2})/i);
  if (iso?.[1] !== undefined) return iso[1];
  const prose = text.match(/loss (?:of|on|dated) ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (prose?.[1] !== undefined) {
    const t = Date.parse(`${prose[1]} UTC`);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

// The recovery agent files a DRAFT (issuance is denied to it — that
// denial is chapter one's governance beat). What crosses to Halden is
// the ISSUED demand: supervising counsel has signed off in the demo's
// fiction, so the internal draft banner and status line come off and
// the issuance block goes on. Interim scaffolding; a real delivery step
// replaces it (control-plane#68).
export function issuedDemand(draft: string): string {
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

export interface FetchedDemand {
  /** The demand as issued (draft banner off, issuance block on). */
  demandText: string;
  claimRef: string | null;
  lossDate: string | null;
  /** The Workbench session the demand was drafted in. */
  sessionDir: string;
}

/**
 * The incoming demand, pulled from the Workbench: the newest recovery
 * session whose timeline holds a drafted demand (a refusal session —
 * nothing drafted — is skipped for the next newest). Returns the issued
 * letter and its identifiers; no pack URL leaves this function.
 */
export async function fetchLatestDemand(
  workbench: string,
): Promise<FetchedDemand> {
  const listing = await getValidated(
    `${workbench}/api/estate/sessions`,
    SessionsListing,
  );
  const recoveries = newestFirst(
    listing.sessions.filter((s) => s.category === "recovery"),
  );
  if (recoveries.length === 0) {
    throw new Error(`no recovery sessions on the Workbench at ${workbench}`);
  }
  for (const row of recoveries) {
    const timeline = await getValidated(
      `${workbench}/sessions/${row.sessionDir}/timeline.json`,
      Timeline,
    );
    const draft = demandFromTimeline(timeline);
    if (draft === null) continue;
    const demandText = issuedDemand(draft);
    return {
      demandText,
      claimRef: row.caseRef ?? extractClaimRef(demandText),
      lossDate: extractLossDate(demandText),
      sessionDir: row.sessionDir,
    };
  }
  throw new Error("no recovery session with a drafted demand was found");
}

// ---- the evidence request resolver ----------------------------------------

export interface EvidenceQuery {
  claimRef: string;
  /** Inclusive ISO date window on the sessions' recordedAt. */
  since: string;
  until: string;
  /** Requested kind ids (see EVIDENCE_KINDS). */
  kinds: readonly string[];
}

export interface ResolvedRecord {
  kindId: string;
  label: string;
  sessionDir: string;
  recordedAt: string;
  /** The session's pack URL — desk-internal; never shown to a human. */
  packUrl: string;
}

/**
 * Resolve an evidence request against the Workbench's open session
 * listing: sessions whose caseRef matches the claim reference, whose
 * recordedAt falls inside the window, and whose agent category matches
 * a requested kind. One record per requested kind — the NEWEST match
 * (live over golden): re-runs of the demo estate produce many sessions
 * for one case, but the fiction has one adjudication record and one
 * recovery working record per claim.
 */
export async function resolveEvidence(
  workbench: string,
  query: EvidenceQuery,
): Promise<ResolvedRecord[]> {
  const listing = await getValidated(
    `${workbench}/api/estate/sessions`,
    SessionsListing,
  );
  const inWindow = listing.sessions.filter((s) => {
    const day = s.recordedAt.slice(0, 10);
    return (
      s.caseRef === query.claimRef && day >= query.since && day <= query.until
    );
  });
  const resolved: ResolvedRecord[] = [];
  for (const kind of EVIDENCE_KINDS) {
    if (!query.kinds.includes(kind.id)) continue;
    const match = newestFirst(
      inWindow.filter((s) => s.category === kind.category),
    )[0];
    if (match === undefined) continue;
    resolved.push({
      kindId: kind.id,
      label: kind.label,
      sessionDir: match.sessionDir,
      recordedAt: match.recordedAt,
      packUrl: `${workbench}/sessions/${match.sessionDir}`,
    });
  }
  return resolved;
}
