// agent-anchored-audit, service mode: the SAME anchored-audit
// composition cli.ts drives, kept resident behind a small HTTP surface
// so OTHER systems (the Meridian Claims Workbench, an Interchange
// workflow step, a cron job) can ask this key-holder to run recovery
// sessions and — separately — to assemble previously anchored receipts
// into one signed, portable evidence pack.
//
// The split matters: RUNNING a session needs the model and anchors new
// records; ASSEMBLING evidence needs neither. Assembly reads the
// durable retention trail (`anchor/proofs.jsonl` + `anchor/logs/`),
// reconstructs the inclusion receipts for the requested window, and
// has the persisted identity sign one `ario.evidence/v1` bundle — no
// model call, no network write, no new anchors. That is what lets an
// approved evidence request be fulfilled long after the sessions that
// produced the evidence are gone.
//
//   POST /run      {caseRef?, packUrl?, prompt?}    → run one anchored session
//                  ?stream=1                        → same run, streamed as SSE
//                  in the Workbench vocabulary (agent_start / step / sealing /
//                  anchored / pack / agent_error)
//   GET  /timeline/:sessionId                       → the run's step timeline
//   GET  /pack/:sessionId                           → the run's evidence pack
//   POST /assemble {since?, until?, sessionIds?}    → sign an evidence pack
//   GET  /health                                    → liveness + identity
//
// Start (from this example's directory — Bun auto-loads ./.env):
//
//   bun --conditions=intx-src run src/serve.ts     # listens on :4610
//
// Port override: SANNING_AGENT_SERVICE_PORT.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

import type { EvidenceBundle } from "@ar.io/anchor";
import type { InterchangeAnchorEvent } from "@ar.io/anchor-interchange";
import { defaultContextDir } from "@intx/example-agent-common";

import {
  AnchoringFailedError,
  buildRunPrompt,
  createExampleAnchorer,
  createExampleIdentity,
  DEFAULT_CASE_REF,
  EXAMPLE_NAME,
  loadReceiptsFromSink,
  openrouterSource,
  rosterDisplayName,
  runAnchoredSession,
  summarizeReceipt,
} from "./composition";

const DEFAULT_PORT = 4610;

const RunBody = type({
  "prompt?": "string",
  "caseRef?": "string",
  "packUrl?": "string",
});
const AssembleBody = type({
  "since?": "string",
  "until?": "string",
  "sessionIds?": "string[]",
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseBody<T>(
  req: Request,
  schema: (data: unknown) => T | type.errors,
): Promise<T | Response> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      return json(400, { error: "request body is not valid JSON" });
    }
  }
  const parsed = schema(raw);
  if (parsed instanceof type.errors) {
    return json(400, { error: parsed.summary });
  }
  return parsed;
}

// ---- per-run session record (timeline + pack), served back to callers ----

// The Workbench-facing timeline entry — the same shape claims-demo's
// capture.timeline uses ({eventId, seq, type, at, payload}), so the
// Workbench relay can write our timeline to disk verbatim.
interface TimelineEntry {
  eventId: string;
  seq: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

interface StoredRun {
  sessionId: string;
  caseRef: string;
  timeline: TimelineEntry[];
  bundle: EvidenceBundle | null;
}

// In-memory, newest-last, bounded. The Workbench fetches timeline+pack
// right after the run it just streamed; packs for OLDER sessions remain
// recoverable from the durable retention trail (see GET /pack).
const MAX_STORED_RUNS = 32;
const runsBySession = new Map<string, StoredRun>();

function storeRun(run: StoredRun): void {
  runsBySession.set(run.sessionId, run);
  while (runsBySession.size > MAX_STORED_RUNS) {
    const oldest = runsBySession.keys().next().value;
    if (oldest === undefined) break;
    runsBySession.delete(oldest);
  }
}

// ---- one run, shared by the plain and streaming paths ---------------------

interface RunOutcomeSummary {
  sessionId: string | null;
  sessionIds: string[];
  caseRef: string;
  receipts: number;
  checkpoint: { txId: string; gatewayUrl: string } | null;
  txIds: string[];
  gatewayUrls: string[];
  decision: {
    reply: string;
    allowed: number;
    blocked: number;
    records: ReturnType<typeof summarizeReceipt>[];
  };
}

async function executeRun(
  body: { prompt?: string; caseRef?: string; packUrl?: string },
  env: NodeJS.ProcessEnv,
  contextDir: string,
  emit?: (payload: Record<string, unknown>) => void,
): Promise<RunOutcomeSummary> {
  const source = openrouterSource(env);
  if (source === null) {
    throw new Error(
      "no inference source: set OPENROUTER_API_KEY (service mode runs via OpenRouter)",
    );
  }

  const caseRef = body.caseRef?.trim() || DEFAULT_CASE_REF;
  const prompt =
    body.prompt?.trim() ||
    buildRunPrompt({
      caseRef,
      ...(body.packUrl !== undefined && body.packUrl !== ""
        ? { packUrl: body.packUrl }
        : {}),
    });
  const environment =
    env["SANNING_API_KEY"] !== undefined && env["SANNING_API_KEY"] !== ""
      ? "production"
      : "dev";

  const timeline: TimelineEntry[] = [];
  const entry = (
    seq: number,
    type_: string,
    payload: Record<string, unknown>,
    eventId: string = globalThis.crypto.randomUUID(),
  ): TimelineEntry => {
    const e: TimelineEntry = {
      eventId,
      seq,
      type: type_,
      at: new Date().toISOString(),
      payload,
    };
    timeline.push(e);
    emit?.({ kind: "step", event: e });
    return e;
  };

  emit?.({
    kind: "agent_start",
    name: rosterDisplayName(env),
    producerId: env["SANNING_PRODUCER_ID"] ?? "interchange-audit-demo",
    caseRef,
    model: source.model,
    environment,
  });
  // Two synthetic (session-record, not anchored) entries open the
  // timeline: the referral's arrival and the turn beginning. Anchored
  // entries carry the audit records themselves.
  entry(-2, "interchange.session_start", {
    caseRef,
    packUrl: body.packUrl ?? null,
  });
  entry(-1, "interchange.turn_start", {});

  let lastSeq = -1;
  let reply = "";
  const outcome = await runAnchoredSession({
    prompt,
    source,
    env,
    contextDir,
    onAuditEvent: (event: InterchangeAnchorEvent) => {
      lastSeq = Math.max(lastSeq, event.seq);
      entry(event.seq, event.type, event.payload, event.eventId);
    },
    onReply: (r) => {
      reply = r;
      entry(lastSeq + 1, "interchange.reply", { text: r });
      emit?.({ kind: "sealing" });
    },
  });

  const records = outcome.receipts
    .map(summarizeReceipt)
    .filter((r) => r !== null);
  const sessionIds = [...outcome.receiptsBySession.keys()];
  const txIds = [...new Set(outcome.receipts.map((r) => r.checkpointTxId))];
  const gatewayUrls = [...new Set(outcome.receipts.map((r) => r.gatewayUrl))];
  emit?.({
    kind: "anchored",
    events: outcome.receipts.length,
    txIds,
    gatewayUrls,
  });

  // Seal this session's own evidence pack (raw records disclosed
  // in-body, each bound to its committed hash) and keep it servable.
  const sessionId = sessionIds[0] ?? globalThis.crypto.randomUUID();
  let bundle: EvidenceBundle | null = null;
  if (outcome.receipts.length > 0) {
    bundle = await outcome.anchorer.bundle(outcome.receipts, {
      disclose: true,
    });
  }
  storeRun({ sessionId, caseRef, timeline, bundle });

  emit?.({
    kind: "pack",
    sessionId,
    decision: outcome.reply,
    records: outcome.receipts.length,
  });

  const checkpoint = outcome.receipts[0];
  return {
    sessionId: sessionIds[0] ?? null,
    sessionIds,
    caseRef,
    receipts: outcome.receipts.length,
    checkpoint:
      checkpoint !== undefined
        ? { txId: checkpoint.checkpointTxId, gatewayUrl: checkpoint.gatewayUrl }
        : null,
    txIds,
    gatewayUrls,
    decision: {
      reply: outcome.reply || reply,
      allowed: records.filter((r) => !r.blocked).length,
      blocked: records.filter((r) => r.blocked).length,
      records,
    },
  };
}

export interface ServeOptions {
  port?: number;
  contextDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function serve(opts: ServeOptions = {}) {
  const env = opts.env ?? process.env;
  const contextDir = opts.contextDir ?? defaultContextDir(EXAMPLE_NAME);
  const port =
    opts.port ??
    (env["SANNING_AGENT_SERVICE_PORT"] !== undefined &&
    env["SANNING_AGENT_SERVICE_PORT"] !== ""
      ? Number.parseInt(env["SANNING_AGENT_SERVICE_PORT"], 10)
      : DEFAULT_PORT);

  // Sessions serialize: the composition appends to one retention trail
  // and one git store, so two concurrent /run bodies would interleave
  // their flushes. A promise chain is enough for a demo service.
  let runChain: Promise<unknown> = Promise.resolve();

  const server = Bun.serve({
    port,
    idleTimeout: 240, // a model turn can take a while
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        const identity = await createExampleIdentity(contextDir);
        return json(200, {
          ok: true,
          service: EXAMPLE_NAME,
          producer: env["SANNING_PRODUCER_ID"] ?? "interchange-audit-demo",
          displayName: rosterDisplayName(env),
          mode:
            env["SANNING_API_KEY"] !== undefined &&
            env["SANNING_API_KEY"] !== ""
              ? "production"
              : "dev",
          publicKey: Buffer.from(identity.getPublicKey()).toString("hex"),
          contextDir,
        });
      }

      if (req.method === "POST" && url.pathname === "/run") {
        const body = await parseBody(req, RunBody);
        if (body instanceof Response) return body;

        const streaming = url.searchParams.get("stream") === "1";

        if (!streaming) {
          const work = runChain.then(() => executeRun(body, env, contextDir));
          runChain = work.catch(() => undefined);
          try {
            return json(200, await work);
          } catch (err) {
            if (err instanceof AnchoringFailedError) {
              return json(502, {
                error: `anchoring failed: ${err.message}`,
                note: `the signed git audit trail is intact in ${contextDir}`,
              });
            }
            const message = err instanceof Error ? err.message : String(err);
            return json(500, { error: message });
          }
        }

        // SSE: the run's progress in the Workbench vocabulary, one JSON
        // `data:` frame per event, comment heartbeats so proxies keep the
        // stream open across a slow model turn.
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false;
            const write = (s: string) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(s));
              } catch {
                closed = true;
              }
            };
            const send = (payload: Record<string, unknown>) =>
              write(`data: ${JSON.stringify(payload)}\n\n`);
            const heartbeat = setInterval(() => write(":hb\n\n"), 15_000);
            const finish = () => {
              clearInterval(heartbeat);
              if (!closed) {
                closed = true;
                try {
                  controller.close();
                } catch {
                  // already gone
                }
              }
            };

            const work = runChain.then(() =>
              executeRun(body, env, contextDir, send),
            );
            runChain = work.catch(() => undefined);
            work
              .then(() => finish())
              .catch((err: unknown) => {
                const message =
                  err instanceof AnchoringFailedError
                    ? `anchoring failed: ${err.message} (the signed git audit trail is intact)`
                    : err instanceof Error
                      ? err.message
                      : String(err);
                send({ kind: "agent_error", message });
                finish();
              });
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // The run's step timeline, exactly as streamed — the Workbench
      // writes this to the session dir verbatim.
      if (req.method === "GET" && url.pathname.startsWith("/timeline/")) {
        const sessionId = decodeURIComponent(
          url.pathname.slice("/timeline/".length),
        );
        const run = runsBySession.get(sessionId);
        if (run === undefined) {
          return json(404, {
            error: `no timeline for session ${sessionId} (timelines live for the service's lifetime; packs outlive it — see /pack)`,
          });
        }
        return json(200, run.timeline);
      }

      // The run's own evidence pack. Served from memory for fresh runs;
      // reassembled from the durable retention trail for anything older
      // — the pack outlives the process that produced it.
      if (req.method === "GET" && url.pathname.startsWith("/pack/")) {
        const sessionId = decodeURIComponent(
          url.pathname.slice("/pack/".length),
        );
        const run = runsBySession.get(sessionId);
        if (run?.bundle != null) return json(200, run.bundle);
        try {
          const receipts = loadReceiptsFromSink(contextDir, {
            sessionIds: [sessionId],
          });
          if (receipts.length === 0) {
            return json(404, { error: `no anchored receipts for session ${sessionId}` });
          }
          const identity = await createExampleIdentity(contextDir);
          const anchorer = createExampleAnchorer(contextDir, env, identity);
          const bundle = await anchorer.bundle(receipts, { disclose: true });
          return json(200, bundle);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(500, { error: message });
        }
      }

      if (req.method === "POST" && url.pathname === "/assemble") {
        const body = await parseBody(req, AssembleBody);
        if (body instanceof Response) return body;

        try {
          const receipts = loadReceiptsFromSink(contextDir, {
            ...(body.since !== undefined ? { since: body.since } : {}),
            ...(body.until !== undefined ? { until: body.until } : {}),
            ...(body.sessionIds !== undefined
              ? { sessionIds: body.sessionIds }
              : {}),
          });
          if (receipts.length === 0) {
            return json(404, {
              error:
                "no anchored receipts match the requested window/sessions",
            });
          }

          // The key-holder assembling: the SAME persisted identity that
          // signed the anchors signs the pack. Constructing the anchorer
          // is side-effect-free; bundle() only reads the logStore (for
          // in-body disclosure) and signs locally.
          const identity = await createExampleIdentity(contextDir);
          const anchorer = createExampleAnchorer(contextDir, env, identity);
          const bundle = await anchorer.bundle(receipts, { disclose: true });

          const stamp = new Date()
            .toISOString()
            .replaceAll(":", "-")
            .replace(/\.\d+Z$/, "Z");
          const packPath = join(contextDir, `evidence-pack-${stamp}.json`);
          const bytes = JSON.stringify(bundle, null, 2);
          writeFileSync(packPath, bytes);
          const sha256 = createHash("sha256").update(bytes).digest("hex");

          const disclosed = bundle.body.events.filter(
            (e) => e.content !== undefined,
          ).length;
          return json(200, {
            path: packPath,
            sha256,
            records: receipts.length,
            disclosed,
            checkpoints: bundle.body.checkpoints.length,
            issuer: bundle.issuer,
            window: {
              since: body.since ?? null,
              until: body.until ?? null,
              sessionIds: body.sessionIds ?? null,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(500, { error: message });
        }
      }

      return json(404, { error: `no route: ${req.method} ${url.pathname}` });
    },
  });

  console.log(
    `[${EXAMPLE_NAME}] service mode on http://localhost:${String(server.port)} ` +
      `(contextDir: ${contextDir})`,
  );
  return server;
}

if (import.meta.main) {
  serve();
}
