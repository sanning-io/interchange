// halden-claims-desk, the desk itself: a small resident HTTP service
// that receives a recovery demand from ANOTHER company over dumb HTTP,
// verifies the attached evidence packs with the public kernels (no
// account, no credential — only the producer pays; anyone can check),
// and answers in Halden's voice. The surface is the Halden-branded
// page at GET /; the seam between companies is POST /file-demand.
//
//   GET  /                         → the desk page (latest case, live)
//   POST /fetch-demand             → pull Meridian's newest demand from the
//                                    Workbench, open a case identifier-only
//                                    (the page's "Incoming demand" button)
//   POST /file-demand              → {demandText, claimRef?, lossDate?} —
//                                    open a case by hand, identifier-only
//                                    (legacy packUrls[] still accepted,
//                                    deprecated — see README)
//   POST /request-evidence         → {file, claimRef, since, until, kinds[]}
//                                    — the evidence-request form: resolve
//                                    matching records on the Workbench and
//                                    start the examination
//   DELETE /case/:file             → remove a case and its files (admin)
//   GET  /case.json                → the latest case (or ?file=HIC-…)
//   GET  /stream                   → SSE: case snapshots as they change
//   GET  /gate                     → passcode preflight (204/401)
//   GET  /health                   → liveness + the desk's public key
//
// Start (from this example's directory — Bun auto-loads ./.env):
//
//   bun --conditions=intx-src run src/serve.ts     # listens on :4620
//
// Deploy knobs (all optional; unset = local behavior unchanged):
//   PORT                 the deploy platform's injected port (wins)
//   HALDEN_DESK_PORT     the example's own port override
//   SANNING_CONTEXT_DIR  where the desk's identity/cases/logbooks
//                        persist (default <repo-root>/tmp/
//                        halden-claims-desk/context); point it at a
//                        mounted volume on hosted deploys
//   MERIDIAN_WORKBENCH_URL  where the desk pulls demands from and
//                        resolves evidence requests against (default
//                        http://localhost:4601)
//   DEMO_PASSCODE        when set, the endpoints that mutate the desk
//                        (/fetch-demand, /file-demand, /request-evidence,
//                        DELETE /case/:file) require it — ?key= or an
//                        x-demo-key header

import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type } from "arktype";

import { defaultContextDir } from "@intx/example-agent-common";
import type { AuditRecord } from "@intx/types/audit";

import {
  createDeskIdentity,
  DESK_WORKER,
  EXAMPLE_NAME,
  openrouterSource,
  runDeskSession,
} from "./composition";
import {
  BLOCKED_TOOL,
  buildCasePrompt,
  buildDeskTools,
  INSURED,
  POLICY_ID,
  type DeskObservation,
} from "./job";
import {
  loadCases,
  newCase,
  packRef,
  parsePinnedReply,
  saveCase,
  type DeskCase,
  type StepEntry,
} from "./state";
import {
  EVIDENCE_KINDS,
  evidenceKind,
  extractClaimRef,
  extractLossDate,
  fetchLatestDemand,
  resolveEvidence,
  workbenchUrl,
  type ResolvedRecord,
} from "./workbench";
import { renderPageHtml } from "./page";

const DEFAULT_PORT = 4620;

// Railway (and most deploy platforms) inject PORT; the example's own
// HALDEN_DESK_PORT keeps working locally.
function envPort(env: NodeJS.ProcessEnv): number | null {
  for (const name of ["PORT", "HALDEN_DESK_PORT"]) {
    const raw = env[name];
    if (raw !== undefined && raw !== "") return Number.parseInt(raw, 10);
  }
  return null;
}

const ASSETS = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "assets",
);

// A demand is filed with its IDENTIFIERS — claim reference and loss
// date; evidence arrives separately, by request. `packUrls` is the
// deprecated legacy shape (kept for one release for the cloud smoke).
const FileDemandBody = type({
  demandText: "string > 0",
  "claimRef?": "string",
  "lossDate?": "string",
  "packUrls?": "string[]",
});

const RequestEvidenceBody = type({
  file: "string > 0",
  claimRef: "string > 0",
  since: /^\d{4}-\d{2}-\d{2}$/,
  until: /^\d{4}-\d{2}-\d{2}$/,
  kinds: "string[] > 0",
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface ServeOptions {
  port?: number;
  contextDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function serve(opts: ServeOptions = {}) {
  const env = opts.env ?? process.env;
  const contextDir =
    opts.contextDir ??
    (env["SANNING_CONTEXT_DIR"] !== undefined &&
    env["SANNING_CONTEXT_DIR"] !== ""
      ? resolve(env["SANNING_CONTEXT_DIR"])
      : defaultContextDir(EXAMPLE_NAME));
  const port = opts.port ?? envPort(env) ?? DEFAULT_PORT;

  // When DEMO_PASSCODE is set, every endpoint that mutates the desk —
  // /fetch-demand, /file-demand, /request-evidence, DELETE /case/:file —
  // requires it: `?key=` or an `x-demo-key` header. Unset = open, the
  // local default. Mirrors the claims-demo demo-server gate; GET /gate
  // is the cheap preflight the page uses to prompt once.
  const passcode = env["DEMO_PASSCODE"] ?? "";
  const gateOk = (req: Request, url: URL): boolean =>
    passcode === "" ||
    url.searchParams.get("key") === passcode ||
    req.headers.get("x-demo-key") === passcode;

  // Where demands are pulled from and evidence requests resolve against.
  const workbench = workbenchUrl(env);

  const pageHtml = renderPageHtml(
    readFileSync(join(ASSETS, "halden.css"), "utf8"),
    { insured: INSURED, policyId: POLICY_ID, kinds: EVIDENCE_KINDS },
  );

  // ---- case registry (persisted; newest last) -----------------------------
  const cases: DeskCase[] = loadCases(contextDir);
  const latest = (): DeskCase | null => cases[cases.length - 1] ?? null;

  // File references continue from the persisted record: HIC-2026-0412
  // is the desk's first file, per the house samples.
  let fileSeq = 411;
  for (const c of cases) {
    const m = c.fileRef.match(/^HIC-2026-(\d+)$/);
    if (m !== null)
      fileSeq = Math.max(fileSeq, Number.parseInt(m[1] ?? "0", 10));
  }
  const nextFileRef = (): string => {
    fileSeq += 1;
    return `HIC-2026-${String(fileSeq).padStart(4, "0")}`;
  };

  // ---- SSE fan-out ---------------------------------------------------------
  const listeners = new Set<(payload: string) => void>();
  const broadcast = (deskCase: DeskCase | null): void => {
    const payload = `data: ${JSON.stringify({ kind: "case", case: deskCase })}\n\n`;
    for (const write of listeners) write(payload);
  };
  const mutate = (deskCase: DeskCase): void => {
    saveCase(contextDir, deskCase);
    broadcast(deskCase);
  };

  const step = (
    deskCase: DeskCase,
    kind: StepEntry["kind"],
    text: string,
  ): void => {
    deskCase.steps.push({ at: new Date().toISOString(), kind, text });
    mutate(deskCase);
  };

  // ---- one case, worked ----------------------------------------------------

  const READ_LINES: Record<string, string> = {
    read_demand_letter: "The demand as received is read.",
    read_policy_certificate: `Policy ${POLICY_ID} is read.`,
    read_fnol_extract:
      "The sender's own first-notice and inspection language is read, from the verified record.",
    draft_response_letter: "The response is drafted.",
  };

  function handleObservation(deskCase: DeskCase, ev: DeskObservation): void {
    if (ev.kind === "tool_start") {
      const line = READ_LINES[ev.tool];
      if (line !== undefined) step(deskCase, "tool", line);
      return;
    }
    if (ev.kind === "pack_examining") {
      const ref = packRef(ev.packUrl);
      const pack = deskCase.packs.find((p) => p.ref === ref);
      if (pack !== undefined) pack.status = "examining";
      step(
        deskCase,
        "tool",
        `Evidence pack ${ref} under examination. Each record is checked against the public anchor, independently of the sender.`,
      );
      return;
    }
    if (ev.kind === "pack_verdict") {
      const ref = packRef(ev.packUrl);
      const pack = deskCase.packs.find((p) => p.ref === ref);
      const verified = ev.verdict === "verified";
      if (pack !== undefined) {
        pack.status = verified ? "verified" : "failed";
        pack.verdict = ev.verdict;
        pack.specVersion = ev.specVersion;
        pack.kernel = ev.kernel;
        pack.recordsVerified = ev.recordsVerified;
        pack.recordsFailed = ev.recordsFailed;
        pack.checkpointTxIds = ev.checkpointTxIds;
        pack.errors = ev.errors;
      }
      step(
        deskCase,
        "tool",
        verified
          ? `${ref}: ${String(ev.recordsVerified)} of ${String(
              ev.recordsVerified + ev.recordsFailed,
            )} records verify. Digest chain intact. The record is genuine and unaltered. What the record proves is a separate question.`
          : `${ref}: verification failed${
              ev.errors[0] !== undefined ? ` — ${ev.errors[0]}` : ""
            }. What does not verify is not evidence.`,
      );
      return;
    }
    // letter_filed — the case file's display copy cites records by
    // reference, never by URL: any pack URL the agent slipped into the
    // letter is replaced with the pack's record reference (the signed
    // logbook keeps the agent's raw output).
    let letterText = ev.text;
    for (const pack of deskCase.packs) {
      letterText = letterText
        .replaceAll(`${pack.url}/pack/bundle.json`, pack.ref)
        .replaceAll(pack.url, pack.ref);
    }
    deskCase.letter = {
      disposition: ev.disposition,
      senderRef: ev.senderRef,
      positionBy: ev.positionBy,
      text: letterText,
      filedAt: new Date().toISOString(),
    };
    step(
      deskCase,
      "tool",
      `Response filed — ${ev.disposition.toUpperCase()}. The letter commits Halden to ${ev.positionBy}.`,
    );
  }

  function handleAuditRecord(deskCase: DeskCase, record: AuditRecord): void {
    if (record.authz !== null && record.authz.blocked) {
      step(
        deskCase,
        "blocked",
        `Logbook: ${record.tool} attempted — denied by authorization. ` +
          `Admission is reserved to supervising counsel. The denial is committed like every other record.`,
      );
      return;
    }
    step(
      deskCase,
      "record",
      `Logbook: ${record.tool} committed (seq ${String(record.seq)}).`,
    );
  }

  async function workCase(deskCase: DeskCase): Promise<void> {
    const source = openrouterSource(env);
    if (source === null) {
      deskCase.status = "error";
      deskCase.error =
        "no inference source: set OPENROUTER_API_KEY (the desk runs via OpenRouter)";
      step(deskCase, "error", deskCase.error);
      return;
    }

    deskCase.status = "examining";
    step(
      deskCase,
      "desk",
      `The file passes to the desk agent (${DESK_WORKER}). Verification precedes reading.`,
    );

    try {
      await runDeskSession({
        prompt: buildCasePrompt({
          fileRef: deskCase.fileRef,
          receivedAt: deskCase.receivedAt,
          packs: deskCase.packs.map((p) => ({ ref: p.ref, url: p.url })),
        }),
        // One file, one fresh examination: each case gets its own
        // conversation + logbook dir, all signed by the desk's one
        // identity (identityDir). A shared dir would RESUME the prior
        // case's conversation — the runtime's resume feature — and leak
        // one case's letter into the next case's reasoning.
        contextDir: join(contextDir, "files", deskCase.fileRef),
        identityDir: contextDir,
        tools: buildDeskTools({
          fileRef: deskCase.fileRef,
          demandText: deskCase.demandText,
          observe: (ev) => handleObservation(deskCase, ev),
        }),
        source,
        onAuditRecord: (record) => handleAuditRecord(deskCase, record),
        onReply: (reply) => {
          deskCase.reply = reply;
          deskCase.decision = parsePinnedReply(reply);
          step(
            deskCase,
            "reply",
            deskCase.decision !== null
              ? `Examination complete. Decision: ${deskCase.decision.decision}.`
              : "Examination complete.",
          );
        },
      });
      deskCase.status = "concluded";
      mutate(deskCase);
    } catch (err) {
      deskCase.status = "error";
      deskCase.error = err instanceof Error ? err.message : String(err);
      step(deskCase, "error", `The examination failed: ${deskCase.error}`);
    }
  }

  // Cases serialize: the composition appends to one git logbook, so two
  // concurrent demands would interleave their flushes. A promise chain
  // is enough for a demo desk.
  let caseChain: Promise<unknown> = Promise.resolve();
  const queueWork = (deskCase: DeskCase): void => {
    caseChain = caseChain.then(() => workCase(deskCase)).catch(() => undefined);
  };

  // Open a case for a demand that arrives IDENTIFIER-ONLY: the letter,
  // its claim reference, its loss date. No evidence accompanies it; the
  // examination starts only when the evidence request resolves.
  const openIdentifierCase = (
    demandText: string,
    claimRef: string | null,
    lossDate: string | null,
  ): DeskCase => {
    const deskCase = newCase(nextFileRef(), demandText, { claimRef, lossDate });
    cases.push(deskCase);
    const cites = [
      ...(claimRef !== null ? [`claim ${claimRef}`] : []),
      ...(lossDate !== null ? [`loss date ${lossDate}`] : []),
    ];
    step(
      deskCase,
      "desk",
      `Receipt is acknowledged. File ${deskCase.fileRef} opened. ` +
        (cites.length > 0
          ? `The demand references ${cites.join(", ")}. `
          : `The demand carries no claim reference. `) +
        `No evidence accompanies the demand; the records will be requested. ` +
        `Acknowledgment is not an admission of liability.`,
    );
    return deskCase;
  };

  // Answer with links on the host the caller reached us at (a hosted
  // desk is not localhost); honor the proxy's scheme.
  const originOf = (req: Request, url: URL): string => {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    return proto !== undefined && proto !== ""
      ? `${proto}://${url.host}`
      : url.origin;
  };

  const filedResponse = (
    req: Request,
    url: URL,
    deskCase: DeskCase,
  ): Response => {
    const origin = originOf(req, url);
    return json(202, {
      fileRef: deskCase.fileRef,
      claimRef: deskCase.claimRef,
      lossDate: deskCase.lossDate,
      status: "received",
      desk: `${origin}/`,
      caseUrl: `${origin}/case.json?file=${deskCase.fileRef}`,
    });
  };

  const readBody = async (req: Request): Promise<unknown> => {
    const text = await req.text();
    if (text.trim() === "") return {};
    try {
      return JSON.parse(text);
    } catch {
      return new Error("request body is not valid JSON");
    }
  };

  const server = Bun.serve({
    port,
    // "::" = dual-stack: Railway private networking is IPv6-only, local stays IPv4-reachable
    hostname: "::",
    idleTimeout: 240, // a model turn can take a while
    async fetch(req) {
      const url = new URL(req.url);

      if (
        req.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/index.html")
      ) {
        return new Response(pageHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Preflight for the page: is a passcode needed, and is this one right?
      if (req.method === "GET" && url.pathname === "/gate") {
        return gateOk(req, url)
          ? new Response(null, { status: 204 })
          : json(401, { error: "passcode required" });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const identity = await createDeskIdentity(contextDir);
        return json(200, {
          ok: true,
          service: EXAMPLE_NAME,
          desk: DESK_WORKER,
          verifies:
            "sanning.* and ario.* evidence packs, public kernels, no account",
          anchors: false,
          blockedTool: BLOCKED_TOOL,
          publicKey: Buffer.from(identity.getPublicKey()).toString("hex"),
          contextDir,
        });
      }

      // The page's case switcher: every file on the desk, one line each.
      if (req.method === "GET" && url.pathname === "/cases.json") {
        return json(
          200,
          cases.map((c) => ({
            fileRef: c.fileRef,
            receivedAt: c.receivedAt,
            status: c.status,
            decision: c.decision?.decision ?? null,
          })),
        );
      }

      if (req.method === "GET" && url.pathname === "/case.json") {
        const fileParam = url.searchParams.get("file");
        const found =
          fileParam !== null
            ? (cases.find((c) => c.fileRef === fileParam) ?? null)
            : latest();
        if (found === null) {
          return json(404, { error: "no case on file" });
        }
        return json(200, found);
      }

      if (req.method === "GET" && url.pathname === "/stream") {
        const encoder = new TextEncoder();
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let write: (payload: string) => void = () => undefined;
        const teardown = (): void => {
          closed = true;
          listeners.delete(write);
          if (heartbeat !== null) clearInterval(heartbeat);
        };
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            write = (payload: string) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(payload));
              } catch {
                teardown();
              }
            };
            listeners.add(write);
            // The connecting page gets the current case immediately.
            write(
              `data: ${JSON.stringify({ kind: "case", case: latest() })}\n\n`,
            );
            heartbeat = setInterval(() => write(":hb\n\n"), 15_000);
          },
          cancel() {
            teardown();
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

      // The page's "Incoming demand" button: pull Meridian's newest
      // drafted demand from the Workbench server-side, extract its
      // identifiers, and open the case identifier-only. The whole demo
      // is drivable by a human with no terminal.
      if (req.method === "POST" && url.pathname === "/fetch-demand") {
        if (!gateOk(req, url)) {
          return json(401, { error: "passcode required" });
        }
        try {
          const fetched = await fetchLatestDemand(workbench);
          const deskCase = openIdentifierCase(
            fetched.demandText,
            fetched.claimRef,
            fetched.lossDate,
          );
          return filedResponse(req, url, deskCase);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json(502, {
            error: `the Workbench could not be read: ${message}`,
          });
        }
      }

      if (req.method === "POST" && url.pathname === "/file-demand") {
        if (!gateOk(req, url)) {
          return json(401, { error: "passcode required" });
        }
        const raw = await readBody(req);
        if (raw instanceof Error) return json(400, { error: raw.message });
        const body = FileDemandBody(raw);
        if (body instanceof type.errors) {
          return json(400, { error: body.summary });
        }

        // DEPRECATED legacy shape (one release): packs attached to the
        // filing itself. The examination starts immediately.
        const packUrls = body.packUrls ?? [];
        if (packUrls.length > 0) {
          const deskCase = newCase(nextFileRef(), body.demandText, {
            packUrls,
            claimRef: body.claimRef ?? extractClaimRef(body.demandText),
            lossDate: body.lossDate ?? extractLossDate(body.demandText),
          });
          cases.push(deskCase);
          step(
            deskCase,
            "desk",
            `Receipt is acknowledged. File ${deskCase.fileRef} opened. ` +
              `${String(deskCase.packs.length)} evidence pack(s) offered with the demand. ` +
              `Acknowledgment is not an admission of liability.`,
          );
          queueWork(deskCase);
          return filedResponse(req, url, deskCase);
        }

        const deskCase = openIdentifierCase(
          body.demandText,
          body.claimRef ?? extractClaimRef(body.demandText),
          body.lossDate ?? extractLossDate(body.demandText),
        );
        return filedResponse(req, url, deskCase);
      }

      // The evidence-request form: what records Halden wants, for which
      // claim, over which window. The desk resolves the request against
      // the Workbench's open session listing; the resolved packs start
      // the examination. Zero matches = an honest empty state, no run.
      if (req.method === "POST" && url.pathname === "/request-evidence") {
        if (!gateOk(req, url)) {
          return json(401, { error: "passcode required" });
        }
        const raw = await readBody(req);
        if (raw instanceof Error) return json(400, { error: raw.message });
        const body = RequestEvidenceBody(raw);
        if (body instanceof type.errors) {
          return json(400, { error: body.summary });
        }
        const kindLabels: string[] = [];
        for (const id of body.kinds) {
          const kind = evidenceKind(id);
          if (kind === null) {
            return json(400, { error: `unknown record kind: ${id}` });
          }
          kindLabels.push(kind.label);
        }
        const deskCase = cases.find((c) => c.fileRef === body.file);
        if (deskCase === undefined) {
          return json(404, { error: `no case on file: ${body.file}` });
        }
        if (deskCase.status !== "received" || deskCase.packs.length > 0) {
          return json(409, {
            error: `file ${deskCase.fileRef} is already under examination`,
          });
        }

        deskCase.request = {
          claimRef: body.claimRef,
          since: body.since,
          until: body.until,
          kinds: [...body.kinds],
          requestedAt: new Date().toISOString(),
          located: null,
        };
        step(
          deskCase,
          "desk",
          `Evidence is requested for claim ${body.claimRef} — ` +
            `${kindLabels.join(", ")}; window ${body.since} to ${body.until}.`,
        );

        let resolved: ResolvedRecord[];
        try {
          resolved = await resolveEvidence(workbench, {
            claimRef: body.claimRef,
            since: body.since,
            until: body.until,
            kinds: body.kinds,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          step(
            deskCase,
            "error",
            `The records service could not be read: ${message}. ` +
              `The request may be refiled.`,
          );
          return json(502, { error: message });
        }

        deskCase.request.located = resolved.length;
        if (resolved.length === 0) {
          step(
            deskCase,
            "desk",
            `No records are located for claim ${body.claimRef} in the ` +
              `window ${body.since} to ${body.until}. Nothing is examined. ` +
              `The request may be refiled with a corrected reference or window.`,
          );
          return json(200, { file: deskCase.fileRef, located: 0 });
        }

        deskCase.packs = resolved.map((r) => ({
          url: r.packUrl.replace(/\/+$/, ""),
          ref: r.sessionDir,
          status: "offered" as const,
          specVersion: null,
          kernel: null,
          verdict: null,
          recordsVerified: 0,
          recordsFailed: 0,
          checkpointTxIds: [],
          errors: [],
        }));
        step(
          deskCase,
          "desk",
          `${String(resolved.length)} record(s) located — ` +
            `${resolved.map((r) => `the ${r.label} (${r.sessionDir})`).join("; ")}. ` +
            `The file passes to examination.`,
        );
        queueWork(deskCase);
        return json(202, {
          file: deskCase.fileRef,
          located: resolved.length,
          records: resolved.map((r) => ({
            kind: r.kindId,
            ref: r.sessionDir,
          })),
        });
      }

      // Admin hygiene: remove a case and its files from the context dir.
      const caseMatch = url.pathname.match(/^\/case\/([A-Za-z0-9-]+)$/);
      if (req.method === "DELETE" && caseMatch !== null) {
        if (!gateOk(req, url)) {
          return json(401, { error: "passcode required" });
        }
        const fileRef = caseMatch[1] ?? "";
        const idx = cases.findIndex((c) => c.fileRef === fileRef);
        if (idx === -1) {
          return json(404, { error: `no case on file: ${fileRef}` });
        }
        if (cases[idx]?.status === "examining") {
          return json(409, {
            error: `file ${fileRef} is under examination; it cannot be removed now`,
          });
        }
        cases.splice(idx, 1);
        rmSync(join(contextDir, "cases", `${fileRef}.json`), { force: true });
        rmSync(join(contextDir, "files", fileRef), {
          recursive: true,
          force: true,
        });
        broadcast(latest());
        return json(200, { deleted: fileRef });
      }

      return json(404, { error: `no route: ${req.method} ${url.pathname}` });
    },
  });

  console.log(
    `[${EXAMPLE_NAME}] Halden Indemnity — Inward Claims desk on ` +
      `http://localhost:${String(server.port)} (contextDir: ${contextDir})`,
  );
  return server;
}

if (import.meta.main) {
  serve();
}
