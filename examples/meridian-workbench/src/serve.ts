// The Meridian Claims Workbench, Interchange-estate edition: the whole
// Meridian day — intake triage, claims adjudication, renewal review,
// recovery — run as anchored agent sessions INSIDE this estate, each
// stage riding the sibling example's anchored-audit composition (the
// embedded platform pattern; in-process anchoring under the hub needs
// core changes, so embedded is the idiom, deliberately).
//
// The estate's open HTTP contract is the same one claims-demo's
// Workbench exposed, which is what makes the Halden desk's evidence
// resolution work here with no new protocol:
//
//   GET  /                                → the Workbench page
//   GET  /api/estate/sessions             → { sessions: [meta…] } (newest first)
//   GET  /sessions/:dir/meta.json         → one session's meta
//   GET  /sessions/:dir/timeline.json     → the streamed step timeline
//   GET  /sessions/:dir/pack/bundle.json  → the sealed evidence pack
//   GET  /sessions/:dir/logs-mapping.json → 404, deliberately: packs
//        disclose record content in-body; there is no hand-decoded side
//        file (the convention leak that shipped hex logs — claims-demo#9)
//   POST /run-day  (?stream=1 → SSE)      → run the four-stage day
//   GET  /run-day?stream=1                → same run for EventSource
//   GET  /health · GET /gate              → liveness · passcode preflight
//
// Start (from this example's directory — Bun auto-loads ./.env):
//
//   bun --conditions=intx-src run src/serve.ts     # listens on :4630
//
// Knobs (all optional): PORT / MERIDIAN_WORKBENCH_PORT · MERIDIAN_DATA_DIR
// (estate + per-stage identities; default <repo>/tmp/meridian-workbench)
// · DEMO_PASSCODE (gates /run-day) · SANNING_API_KEY (production
// anchoring through the control plane; absent = dev mode) ·
// SANNING_DEV_UPLOAD_URL (dev-mode local upload mock) ·
// OPENROUTER_API_KEY (+ OPENROUTER_MODEL / OPENROUTER_BASE_URL).

import { join, resolve } from "node:path";

import {
  AnchoringFailedError,
  openrouterSource,
  runAnchoredSession,
  summarizeReceipt,
} from "@intx/example-agent-anchored-audit";
import { defaultContextDir } from "@intx/example-agent-common";

import { Estate, type SessionMeta, type TimelineEntry } from "./estate";
import { renderPageHtml } from "./page";
import { STAGES, type StageSpec } from "./stages";

export const EXAMPLE_NAME = "meridian-workbench";
const DEFAULT_PORT = 4630;

function envPort(env: NodeJS.ProcessEnv): number | null {
  for (const name of ["PORT", "MERIDIAN_WORKBENCH_PORT"]) {
    const raw = env[name];
    if (raw !== undefined && raw !== "") return Number.parseInt(raw, 10);
  }
  return null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- one stage run ---------------------------------------------------------

interface StageOutcome {
  meta: SessionMeta;
}

async function runStage(
  spec: StageSpec,
  opts: {
    env: NodeJS.ProcessEnv;
    dataDir: string;
    estate: Estate;
    packUrl?: string;
    emit?: (payload: Record<string, unknown>) => void;
  },
): Promise<StageOutcome> {
  const { env, dataDir, estate, emit } = opts;
  const source = openrouterSource(env);
  if (source === null) {
    throw new Error(
      "no inference source: set OPENROUTER_API_KEY (the Workbench runs via OpenRouter)",
    );
  }

  // Each stage is its OWN producer: its own persisted identity (fresh on
  // first run, never copied from anywhere) under the estate's data dir,
  // its own sealed subject name, its own roster display name.
  const contextDir = join(dataDir, "agents", spec.stageId);
  const stageEnv: NodeJS.ProcessEnv = {
    ...env,
    SANNING_AGENT_NAME: spec.agentName,
    SANNING_PRODUCER_ID: `meridian-workbench-${spec.stageId}`,
    SANNING_DISPLAY_NAME: spec.displayName,
  };
  const environment =
    env["SANNING_API_KEY"] !== undefined && env["SANNING_API_KEY"] !== ""
      ? "production"
      : "dev";

  const sessionDir = estate.newSessionDir(spec.stageId);
  const timeline: TimelineEntry[] = [];
  const entry = (
    seq: number,
    type_: string,
    payload: Record<string, unknown>,
    eventId: string = globalThis.crypto.randomUUID(),
  ): void => {
    const e: TimelineEntry = {
      eventId,
      seq,
      type: type_,
      at: new Date().toISOString(),
      payload,
    };
    timeline.push(e);
    emit?.({ kind: "step", stageId: spec.stageId, event: e });
  };

  emit?.({
    kind: "stage_start",
    stageId: spec.stageId,
    title: spec.title,
    name: spec.displayName,
    caseRef: spec.caseRef,
    model: source.model,
    environment,
  });
  entry(-2, "interchange.session_start", {
    caseRef: spec.caseRef,
    packUrl: opts.packUrl ?? null,
  });
  entry(-1, "interchange.turn_start", {});

  let lastSeq = -1;
  const outcome = await runAnchoredSession({
    prompt: spec.prompt({
      ...(opts.packUrl !== undefined ? { packUrl: opts.packUrl } : {}),
    }),
    source,
    env: stageEnv,
    contextDir,
    job: spec.job,
    onAuditEvent: (event) => {
      lastSeq = Math.max(lastSeq, event.seq);
      entry(event.seq, event.type, event.payload, event.eventId);
    },
    onReply: (r) => {
      entry(lastSeq + 1, "interchange.reply", { text: r });
      emit?.({ kind: "sealing", stageId: spec.stageId });
    },
  });

  const records = outcome.receipts
    .map(summarizeReceipt)
    .filter((r) => r !== null);
  const bundle =
    outcome.receipts.length > 0
      ? await outcome.anchorer.bundle(outcome.receipts, { disclose: true })
      : null;

  const meta: SessionMeta = {
    sessionDir,
    stageId: spec.stageId,
    category: spec.category,
    caseRef: spec.caseRef,
    recordedAt: new Date().toISOString(),
    agentName: spec.agentName,
    displayName: spec.displayName,
    environment,
    decision: outcome.reply,
    blocked: records.some((r) => r.blocked),
    records: outcome.receipts.length,
    checkpointTxIds: [
      ...new Set(outcome.receipts.map((r) => r.checkpointTxId)),
    ],
    gatewayUrls: [...new Set(outcome.receipts.map((r) => r.gatewayUrl))],
  };
  estate.write(meta, timeline, bundle);

  emit?.({
    kind: "stage_done",
    stageId: spec.stageId,
    sessionDir,
    records: meta.records,
    blocked: meta.blocked,
    txIds: meta.checkpointTxIds,
    decision: outcome.reply,
  });
  return { meta };
}

// ---- the whole day ---------------------------------------------------------

async function runDay(opts: {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  estate: Estate;
  selfBaseUrl: string;
  emit?: (payload: Record<string, unknown>) => void;
}): Promise<{ sessions: SessionMeta[] }> {
  const sessions: SessionMeta[] = [];
  let adjudicationDir: string | null = null;
  for (const spec of STAGES) {
    // The recovery referral carries the URL of the day's OWN sealed
    // adjudication pack — verify-first works against this estate, no
    // cross-repo seam.
    const packUrl =
      spec.stageId === "recovery" && adjudicationDir !== null
        ? `${opts.selfBaseUrl}/sessions/${adjudicationDir}`
        : undefined;
    const { meta } = await runStage(spec, {
      env: opts.env,
      dataDir: opts.dataDir,
      estate: opts.estate,
      ...(packUrl !== undefined ? { packUrl } : {}),
      ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
    });
    sessions.push(meta);
    if (spec.stageId === "adjudication") adjudicationDir = meta.sessionDir;
  }
  opts.emit?.({
    kind: "day_done",
    sessions: sessions.map((s) => s.sessionDir),
  });
  return { sessions };
}

// ---- the service -----------------------------------------------------------

export interface ServeOptions {
  port?: number;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function serve(opts: ServeOptions = {}) {
  const env = opts.env ?? process.env;
  const dataDir =
    opts.dataDir ??
    (env["MERIDIAN_DATA_DIR"] !== undefined && env["MERIDIAN_DATA_DIR"] !== ""
      ? resolve(env["MERIDIAN_DATA_DIR"])
      : defaultContextDir(EXAMPLE_NAME));
  const port = opts.port ?? envPort(env) ?? DEFAULT_PORT;
  const estate = new Estate(dataDir);
  const selfBaseUrl = `http://localhost:${String(port)}`;

  const passcode = env["DEMO_PASSCODE"] ?? "";
  const gateOk = (req: Request, url: URL): boolean =>
    passcode === "" ||
    url.searchParams.get("key") === passcode ||
    req.headers.get("x-demo-key") === passcode;

  // Day runs serialize — each stage appends to per-stage retention
  // trails, and the recovery referral needs the day's adjudication pack
  // written before it starts.
  let runChain: Promise<unknown> = Promise.resolve();

  const server = Bun.serve({
    port,
    hostname: "::",
    idleTimeout: 240,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(renderPageHtml(passcode !== ""), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/gate") {
        return gateOk(req, url)
          ? new Response(null, { status: 204 })
          : json(401, { error: "passcode required" });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(200, {
          ok: true,
          service: EXAMPLE_NAME,
          stages: STAGES.map((s) => s.stageId),
          mode:
            env["SANNING_API_KEY"] !== undefined &&
            env["SANNING_API_KEY"] !== ""
              ? "production"
              : "dev",
          dataDir,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/estate/sessions") {
        return json(200, { sessions: estate.list() });
      }

      const sessionMatch = /^\/sessions\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (req.method === "GET" && sessionMatch !== null) {
        const dir = decodeURIComponent(sessionMatch[1] ?? "");
        const file = sessionMatch[2] ?? "";
        if (file === "logs-mapping.json") {
          return json(404, {
            error:
              "no logs mapping: packs disclose record content in-body; verify from bundle.json alone",
          });
        }
        if (
          file === "meta.json" ||
          file === "timeline.json" ||
          file === "pack/bundle.json"
        ) {
          const body = estate.readFile(dir, file);
          if (body === null) {
            return json(404, { error: `no ${file} for session ${dir}` });
          }
          return new Response(body, {
            headers: { "Content-Type": "application/json" },
          });
        }
        return json(404, { error: `no route: GET ${url.pathname}` });
      }

      const isRunDay =
        url.pathname === "/run-day" &&
        (req.method === "POST" ||
          (req.method === "GET" && url.searchParams.get("stream") === "1"));
      if (isRunDay) {
        if (!gateOk(req, url)) {
          return json(401, { error: "passcode required" });
        }
        const streaming = url.searchParams.get("stream") === "1";

        if (!streaming) {
          const work = runChain.then(() =>
            runDay({ env, dataDir, estate, selfBaseUrl }),
          );
          runChain = work.catch(() => undefined);
          try {
            return json(200, await work);
          } catch (err) {
            if (err instanceof AnchoringFailedError) {
              return json(502, {
                error: `anchoring failed: ${err.message}`,
                note: `the signed git audit trail is intact in ${err.contextDir}`,
              });
            }
            const message = err instanceof Error ? err.message : String(err);
            return json(500, { error: message });
          }
        }

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
              runDay({ env, dataDir, estate, selfBaseUrl, emit: send }),
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
                send({ kind: "day_error", message });
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

      return json(404, { error: `no route: ${req.method} ${url.pathname}` });
    },
  });

  // eslint-disable-next-line no-console -- service startup banner, the examples' convention
  console.log(
    `[${EXAMPLE_NAME}] on http://localhost:${String(server.port)} ` +
      `(dataDir: ${dataDir})`,
  );
  return server;
}

if (import.meta.main) {
  serve();
}
