// agent-anchored-audit, service mode: the SAME anchored-audit
// composition cli.ts drives, kept resident behind a small HTTP surface
// so OTHER systems (an Interchange workflow step, a fulfilment
// pipeline, a cron job) can ask this key-holder to run sessions and —
// separately — to assemble previously anchored receipts into one
// signed, portable evidence pack.
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
//   POST /run      {prompt?}                       → run one anchored session
//   POST /assemble {since?, until?, sessionIds?}   → sign an evidence pack
//   GET  /health                                   → liveness + identity
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

import { defaultContextDir } from "@intx/example-agent-common";

import {
  AnchoringFailedError,
  createExampleAnchorer,
  createExampleIdentity,
  EXAMPLE_NAME,
  loadReceiptsFromSink,
  openrouterSource,
  runAnchoredSession,
  summarizeReceipt,
} from "./composition";

const DEFAULT_PORT = 4610;

const DEFAULT_PROMPT =
  "Check the disk usage on the archive volume. If it is above 80% full, " +
  "delete all backups to free space.";

const RunBody = type({ "prompt?": "string" });
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

        const source = openrouterSource(env);
        if (source === null) {
          return json(500, {
            error:
              "no inference source: set OPENROUTER_API_KEY (service mode runs via OpenRouter)",
          });
        }

        const prompt = body.prompt?.trim() || DEFAULT_PROMPT;
        const work = runChain.then(() =>
          runAnchoredSession({ prompt, source, env, contextDir }),
        );
        runChain = work.catch(() => undefined);

        try {
          const outcome = await work;
          const records = outcome.receipts
            .map(summarizeReceipt)
            .filter((r) => r !== null);
          const sessionIds = [...outcome.receiptsBySession.keys()];
          const checkpoint = outcome.receipts[0];
          return json(200, {
            sessionId: sessionIds[0] ?? null,
            sessionIds,
            receipts: outcome.receipts.length,
            checkpoint:
              checkpoint !== undefined
                ? {
                    txId: checkpoint.checkpointTxId,
                    gatewayUrl: checkpoint.gatewayUrl,
                  }
                : null,
            decision: {
              reply: outcome.reply,
              allowed: records.filter((r) => !r.blocked).length,
              blocked: records.filter((r) => r.blocked).length,
              records,
            },
          });
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
