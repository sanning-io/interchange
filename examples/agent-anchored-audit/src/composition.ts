// The shared composition for agent-anchored-audit: everything cli.ts
// (one-shot run) and serve.ts (service mode) have in common lives here,
// so the two entry points cannot drift apart.
//
// Three surfaces:
//
//   - `runAnchoredSession` — one full agent session (identity → signed
//     git store → anchored audit store → agent turn → flush), exactly
//     the composition the CLI has always driven. Both entry points call
//     it; the CLI adds argv/stdio handling, the server adds HTTP.
//   - `createExampleAnchorer` — the anchorer alone (same persisted
//     identity, same retention, same production/dev switch), for paths
//     that need to SIGN without running an agent — assembly of an
//     evidence pack from previously durably-retained receipts.
//   - `loadReceiptsFromSink` — reconstruct `InclusionReceipt`s from the
//     durable retention trail (`anchor/proofs.jsonl`), optionally
//     filtered to a time window and/or session set. This is what makes
//     the key-holder able to assemble evidence AFTER the sessions that
//     produced it are gone: the sink rows + logStore are the retained
//     truth, and `anchorer.bundle()` re-signs them into one portable
//     pack.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

import {
  createAnchorer,
  FsLogStore,
  FsSink,
  LocalEd25519Signer,
  SolanaWalletSigner,
  type Anchorer,
  type AnchorerOptions,
  type InclusionReceipt,
  type RetainedCheckpoint,
  type RetainedEvent,
} from "@sanning/anchor";
import {
  anchoredAuditStore,
  signerFromCryptoProvider,
  type InterchangeAnchorEvent,
} from "@sanning/anchor-interchange";
import {
  createAgent,
  createDefaultDirectorRegistry,
  createToolRunner,
  defineAgent,
  defineTool,
  type BaseEnv,
} from "@intx/agent";
import { createEd25519Crypto, generateKeyPair } from "@intx/crypto";
import { optional, type CommonMainOptions } from "@intx/example-agent-common";
import { createIsogitStore } from "@intx/storage-isogit";
import type {
  CryptoProvider,
  InferenceSource,
  KeyPair,
} from "@intx/types/runtime";

import { recoveryAuthorize, recoveryTools, SYSTEM_PROMPT } from "./job";

export const EXAMPLE_NAME = "agent-anchored-audit";

// The ROSTER display name — what Fleet shows for this producer. The
// subject name sealed into the evidence stays `SANNING_AGENT_NAME`
// (Meridian-Mutual.Subrogation, the persisted identity's history); the
// roster override is the human name, per the SDK's displayName contract.
const DEFAULT_DISPLAY_NAME = "Meridian Mutual — Recovery";

export function rosterDisplayName(env: NodeJS.ProcessEnv): string {
  const fromEnv = env["SANNING_DISPLAY_NAME"];
  return fromEnv !== undefined && fromEnv !== ""
    ? fromEnv
    : DEFAULT_DISPLAY_NAME;
}

// OpenRouter rides Interchange's OpenAI-compatible adapter: same wire
// format, different baseURL. When OPENROUTER_API_KEY is set it takes
// precedence over the sibling examples' ANTHROPIC_API_KEY path — the
// anchoring story is provider-agnostic, so the audit trail and its
// proofs are identical whichever model produced the calls.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";

export function openrouterSource(
  env: NodeJS.ProcessEnv,
): InferenceSource | null {
  const apiKey = env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;
  const model = env["OPENROUTER_MODEL"] ?? DEFAULT_OPENROUTER_MODEL;
  // OPENROUTER_BASE_URL override: dev-only knob so the whole flow is
  // drivable against a local mock without model spend.
  const baseURL =
    env["OPENROUTER_BASE_URL"] !== undefined &&
    env["OPENROUTER_BASE_URL"] !== ""
      ? env["OPENROUTER_BASE_URL"]
      : OPENROUTER_BASE_URL;
  return {
    id: `openrouter:${model}`,
    provider: "openai",
    baseURL,
    apiKey,
    model,
  };
}

// Re-exported so entry points name the governance gate from one place.
export { BLOCKED_TOOL, buildRunPrompt, DEFAULT_CASE_REF } from "./job";

// The shape of the committed record each receipt retains (the bytes the
// on-chain hash commits to) — validated rather than asserted, per repo
// convention. `session_id` is what lets the assembly path filter a
// retained trail down to specific sessions.
const CommittedRecord = type({
  event_type: "string",
  metadata: {
    interchange: {
      tool: "string | null",
      seq: "number",
      blocked: "boolean",
      "session_id?": "string",
    },
  },
});

/** One committed audit record, summarized for display / API responses. */
export interface RecordSummary {
  eventType: string;
  tool: string | null;
  seq: number;
  blocked: boolean;
  sessionId: string | null;
}

/**
 * Parse a receipt's committed record bytes into a summary, or null when
 * the bytes are not an interchange audit record (callers skip those).
 */
export function summarizeReceipt(r: InclusionReceipt): RecordSummary | null {
  return summarizeReceiptBytes(r.recordBytes);
}

// ---- persisted keys ------------------------------------------------------

const hexEncode = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function hexDecode(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const StoredIdentity = type({
  privateKey: /^[0-9a-f]{64}$/,
  publicKey: /^[0-9a-f]{64}$/,
});

const StoredWallet = type({ seed: /^[0-9a-f]{64}$/ });

/**
 * Load the agent's Ed25519 identity from `path`, or generate one on the
 * first run and save it there. Persisting the seed is what makes every
 * run of this example the SAME producer: the key that signed yesterday's
 * anchors signs today's, so the evidence accumulates under one identity
 * instead of minting a stranger per run.
 */
async function loadOrCreateIdentity(path: string): Promise<KeyPair> {
  if (existsSync(path)) {
    const parsed = StoredIdentity(JSON.parse(readFileSync(path, "utf8")));
    if (parsed instanceof type.errors) {
      throw new Error(`${path}: ${parsed.summary}`);
    }
    return {
      privateKey: hexDecode(parsed.privateKey),
      publicKey: hexDecode(parsed.publicKey),
    };
  }
  const pair = await generateKeyPair();
  writeFileSync(
    path,
    JSON.stringify(
      {
        privateKey: hexEncode(pair.privateKey),
        publicKey: hexEncode(pair.publicKey),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return pair;
}

/**
 * Load the data-item wallet seed from `path`, or generate and save one.
 * Production mode signs uploads with a funding-chain wallet that is
 * deliberately a DIFFERENT key from the identity that signs envelopes —
 * the anchorer keeps those roles separate, so this example custodies
 * them in separate files.
 */
function loadOrCreateWalletSeedHex(path: string): string {
  if (existsSync(path)) {
    const parsed = StoredWallet(JSON.parse(readFileSync(path, "utf8")));
    if (parsed instanceof type.errors) {
      throw new Error(`${path}: ${parsed.summary}`);
    }
    return parsed.seed;
  }
  const seed = hexEncode(crypto.getRandomValues(new Uint8Array(32)));
  writeFileSync(path, JSON.stringify({ seed }, null, 2) + "\n", {
    mode: 0o600,
  });
  return seed;
}

/**
 * The persisted example identity: ONE Ed25519 key whose signSSH half
 * signs git commits and whose raw-sign half signs anchors. The seed
 * lives in `<contextDir>/identity.json`.
 */
export async function createExampleIdentity(
  contextDir: string,
): Promise<CryptoProvider> {
  mkdirSync(contextDir, { recursive: true });
  return createEd25519Crypto(
    await loadOrCreateIdentity(join(contextDir, "identity.json")),
  );
}

/**
 * The example's anchorer: retention (FsSink + FsLogStore under
 * `<contextDir>/anchor/`) injected once, and the SANNING_API_KEY switch
 * between dev mode and production through the Sanning control plane —
 * identical to what the CLI has always built. Constructing an anchorer
 * is side-effect-free (no network until the first write), so the
 * assembly path can safely build one just to sign a bundle.
 */
export function createExampleAnchorer(
  contextDir: string,
  env: NodeJS.ProcessEnv,
  identity: CryptoProvider,
): Anchorer {
  const retention: Pick<AnchorerOptions, "signer" | "sink" | "logStore"> = {
    signer: signerFromCryptoProvider(identity),
    sink: new FsSink(join(contextDir, "anchor", "proofs.jsonl")),
    logStore: new FsLogStore(join(contextDir, "anchor", "logs")),
  };

  const sanningApiKey = env["SANNING_API_KEY"];
  if (sanningApiKey !== undefined && sanningApiKey !== "") {
    return createAnchorer({
      ...retention,
      environment: "production",
      wallet: new SolanaWalletSigner(
        LocalEd25519Signer.fromSeedHex(
          loadOrCreateWalletSeedHex(join(contextDir, "wallet.json")),
        ),
      ),
      subject: {
        type: "producer",
        producer_id: env["SANNING_PRODUCER_ID"] ?? "interchange-audit-demo",
        ...optional("name", env["SANNING_AGENT_NAME"]),
      },
      controlPlane: {
        baseUrl:
          env["SANNING_CONTROL_PLANE_URL"] ?? "https://console.sanning.io",
        apiKey: sanningApiKey,
        autoRegister: true,
        // Roster-only override (never sealed): Fleet shows the human name.
        displayName: rosterDisplayName(env),
      },
    });
  }
  // Dev mode. The default /anchor front may reject unauthenticated
  // uploads; SANNING_DEV_UPLOAD_URL points dev runs at a local mock
  // (`POST <url>/v1/tx -> { id }`) so the WHOLE flow — receipts, packs,
  // service endpoints — is testable without spending an anchor.
  const devUploadUrl = env["SANNING_DEV_UPLOAD_URL"];
  return createAnchorer({
    ...retention,
    ...(devUploadUrl !== undefined && devUploadUrl !== ""
      ? { arweave: { baseUrl: devUploadUrl } }
      : {}),
  });
}

// A runnable job: WHAT an agent session does — prompt, tools, policy —
// while runAnchoredSession stays the plumbing (identity, storage,
// anchoring). The default is this example's Recovery job; the Meridian
// Workbench example passes its own stages through the same seam.
export interface JobSpec {
  /** Agent id — names the session's tool package too. */
  id: string;
  systemPrompt: string;
  tools: typeof recoveryTools;
  authorize: BaseEnv["authorize"];
}

function toolsFactoryFor(job: JobSpec) {
  return defineTool({
    id: `@intx/example-${job.id}/tools`,
    definitions: job.tools.map((t) => ({ name: t.definition.name })),
    factory: () => {
      const runner = createToolRunner(job.tools);
      return {
        definitions: runner.definitions,
        run: (call, signal) => runner.run(call, signal),
      };
    },
  });
}

// The Recovery job (see ./job): four deterministic reads over the
// recovery casefile, the kernel-backed pack verification, the allowed
// draft, and the DENIED send. The authorize policy denies issuance, so
// a full run produces both audit shapes — allowed calls
// (interchange.tool_call) and the blocked one (interchange.tool_blocked).
export const RECOVERY_JOB: JobSpec = {
  id: EXAMPLE_NAME,
  systemPrompt: SYSTEM_PROMPT,
  tools: recoveryTools,
  authorize: recoveryAuthorize,
};

/** Thrown when the session succeeded but the anchoring flush did not.
 *  The signed git audit trail in `contextDir` is intact either way. */
export class AnchoringFailedError extends Error {
  constructor(
    message: string,
    readonly contextDir: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AnchoringFailedError";
  }
}

export interface RunSessionParams {
  prompt: string;
  source: InferenceSource;
  env: NodeJS.ProcessEnv;
  contextDir: string;
  /** The job to run (prompt/tools/policy). Default: this example's
   *  Recovery job — existing callers are unchanged. */
  job?: JobSpec;
  /** Called with the assistant's reply as soon as the turn completes,
   *  BEFORE the anchoring flush — so callers can surface the reply even
   *  when anchoring subsequently fails. */
  onReply?: (reply: string) => void;
  /** Called for every audit record as it is hash-committed (allowed,
   *  blocked, and error records alike), BEFORE the flush — the seam the
   *  service mode streams live progress from. Purely observational: the
   *  committed bytes are unchanged. */
  onAuditEvent?: (event: InterchangeAnchorEvent) => void;
  /** Inject inference deps (used by the harness-driven tests). */
  deps?: CommonMainOptions["deps"];
}

export interface SessionOutcome {
  reply: string;
  /** provenance.close()'s receipts, keyed by audit session id. */
  receiptsBySession: Map<string, InclusionReceipt[]>;
  /** All receipts, flattened in session order. */
  receipts: InclusionReceipt[];
  /** The anchorer that produced them (already flushed; still usable
   *  for `bundle()`). */
  anchorer: Anchorer;
}

/**
 * Drive ONE agent session through the full anchored-audit composition:
 * persisted identity, SSH-signed git store, anchored audit store
 * decoration, one agent turn against `source`, then close — flushing
 * the audit records into git and the anchor batch into ONE checkpoint
 * write whose inclusion receipts are returned.
 *
 * Throws `AnchoringFailedError` when the flush fails; the git trail in
 * `contextDir` is intact in that case (the run itself succeeded).
 */
export async function runAnchoredSession(
  params: RunSessionParams,
): Promise<SessionOutcome> {
  const { prompt, source, env, contextDir } = params;
  mkdirSync(contextDir, { recursive: true });

  // ONE identity, both signatures: the CryptoProvider's signSSH half is
  // the store's CommitSigner (SSH-signed git commits — the binding
  // createIsogitStore's signer parameter exists for), and its raw-sign
  // half anchors (via signerFromCryptoProvider). No second key to
  // custody, and the claim "the key that signs the commits signs the
  // anchors" is wired, not narrated. The seed persists in identity.json
  // so re-runs anchor as the same producer.
  const identity = await createExampleIdentity(contextDir);
  const storage = await createIsogitStore(contextDir, (payload) =>
    identity.signSSH(payload),
  );

  const anchorer = createExampleAnchorer(contextDir, env, identity);

  // The integration: decorate the audit store. `mapPayload` here is
  // purely observational — it hands each record to the caller's
  // onAuditEvent and returns the payload unchanged, so the committed
  // bytes are byte-identical to the no-callback path.
  const onAuditEvent = params.onAuditEvent;
  const provenance = anchoredAuditStore(
    storage,
    anchorer,
    onAuditEvent !== undefined
      ? {
          mapPayload: (event) => {
            try {
              onAuditEvent(event);
            } catch {
              // A watching callback must never affect what is committed.
            }
            return event.payload;
          },
        }
      : {},
  );

  const job = params.job ?? RECOVERY_JOB;
  const def = defineAgent({
    id: job.id,
    systemPrompt: job.systemPrompt,
    tools: [toolsFactoryFor(job)],
    capabilities: [],
    inference: {
      sources: [{ provider: source.provider, model: source.model }],
    },
  });

  const agentEnv: BaseEnv = {
    sources: [source],
    defaultSource: source.id,
    storage,
    workdir: contextDir,
    audit: provenance,
    authorize: job.authorize,
    directors: createDefaultDirectorRegistry(),
    ...optional("deps", params.deps),
  };

  const agent = await createAgent(def, agentEnv);
  let reply: string;
  try {
    const result = await agent.send(prompt);
    if (result.type !== "reply") {
      throw new Error(
        `agent send suspended on correlationId ${result.correlationId}; this example drives a single prompt and has no resume path`,
      );
    }
    reply = result.reply;
    params.onReply?.(reply);
  } finally {
    await agent.close();
  }

  // agent.close() flushed the audit records into git (system of record)
  // and onto the anchorer's batch. Closing the decorated store flushes
  // the batch — ONE checkpoint write for the whole session — and
  // resolves every record's inclusion proof.
  //
  // The flush is the one step that needs the network. If the upload is
  // rejected (e.g. dev mode against an /anchor front that now requires
  // an API key), the run still succeeded as an audit trail: the records
  // are committed to the signed git store above.
  let receiptsBySession: Map<string, InclusionReceipt[]>;
  try {
    receiptsBySession = await provenance.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AnchoringFailedError(message, contextDir, { cause: err });
  }

  return {
    reply,
    receiptsBySession,
    receipts: [...receiptsBySession.values()].flat(),
    anchorer,
  };
}

// ---- assembling receipts back out of the retention trail -----------------

export interface ReceiptFilter {
  /** ISO 8601 lower bound (inclusive) on the envelope's signed_at. */
  since?: string;
  /** ISO 8601 upper bound (inclusive) on the envelope's signed_at. */
  until?: string;
  /** Keep only records whose committed session_id is in this set. */
  sessionIds?: readonly string[];
}

/**
 * Reconstruct `InclusionReceipt`s from the durable retention trail the
 * FsSink kept (`<contextDir>/anchor/proofs.jsonl`), joining each event
 * row's inclusion proof to its checkpoint row. Intent rows (events
 * offered but never resolved — e.g. a run whose upload was rejected)
 * have no proof and are correctly absent. Rows are last-writer-wins per
 * eventId/txId, per the sink's own read contract.
 *
 * `filter` narrows by signed_at window and/or committed session_id.
 */
export function loadReceiptsFromSink(
  contextDir: string,
  filter: ReceiptFilter = {},
): InclusionReceipt[] {
  const rows = FsSink.read(join(contextDir, "anchor", "proofs.jsonl"));

  const checkpoints = new Map<string, RetainedCheckpoint>();
  const events = new Map<string, RetainedEvent>();
  for (const row of rows) {
    if (row.type === "checkpoint")
      checkpoints.set(row.checkpoint.txId, row.checkpoint);
    else if (row.type === "event") events.set(row.event.eventId, row.event);
  }

  const since = filter.since !== undefined ? Date.parse(filter.since) : null;
  const until = filter.until !== undefined ? Date.parse(filter.until) : null;
  if (since !== null && Number.isNaN(since)) {
    throw new Error(`invalid \`since\` timestamp: ${filter.since}`);
  }
  if (until !== null && Number.isNaN(until)) {
    throw new Error(`invalid \`until\` timestamp: ${filter.until}`);
  }
  const sessions =
    filter.sessionIds !== undefined ? new Set(filter.sessionIds) : null;

  const out: InclusionReceipt[] = [];
  for (const event of events.values()) {
    if (event.proof.kind !== "inclusion") continue;
    const checkpoint = checkpoints.get(event.proof.checkpointTxId);
    if (checkpoint === undefined) continue;

    const signedAt = Date.parse(event.envelope.signed_at);
    if (since !== null && signedAt < since) continue;
    if (until !== null && signedAt > until) continue;
    if (sessions !== null) {
      const summary = summarizeReceiptBytes(event.recordBytes);
      if (summary?.sessionId == null || !sessions.has(summary.sessionId)) {
        continue;
      }
    }

    out.push({
      checkpointTxId: event.proof.checkpointTxId,
      checkpointEnvelope: checkpoint.envelope,
      checkpointRecordBytes: checkpoint.recordBytes,
      gatewayUrl: checkpoint.gatewayUrl,
      root: checkpoint.merkleRoot,
      leafHash: event.proof.leafHash,
      leafIndex: event.proof.leafIndex,
      leafCount: event.proof.leafCount,
      auditPath: [...event.proof.auditPath],
      eventId: event.eventId,
      contentHash: event.contentHash,
      envelope: event.envelope,
      // The sink durably retains the envelope as JSON, not as the exact
      // signed byte-string; re-encode for the type's sake. Nothing in
      // bundle assembly consumes envelopeBytes — verification recomputes
      // from `envelope` itself — so this reconstruction is inert.
      envelopeBytes: new TextEncoder().encode(JSON.stringify(event.envelope)),
      recordBytes: event.recordBytes,
      environment: event.envelope.environment,
      ...(event.contentStored !== undefined
        ? { contentStored: event.contentStored }
        : {}),
    });
  }

  // Deterministic assembly order: by signed_at, then eventId.
  out.sort((a, b) => {
    const t =
      Date.parse(a.envelope.signed_at) - Date.parse(b.envelope.signed_at);
    return t !== 0 ? t : a.eventId.localeCompare(b.eventId);
  });
  return out;
}

function summarizeReceiptBytes(recordBytes: Uint8Array): RecordSummary | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(recordBytes));
  } catch {
    return null;
  }
  const record = CommittedRecord(raw);
  if (record instanceof type.errors) return null;
  const m = record.metadata.interchange;
  return {
    eventType: record.event_type,
    tool: m.tool,
    seq: m.seq,
    blocked: m.blocked,
    sessionId: m.session_id ?? null,
  };
}
