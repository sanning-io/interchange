// @intx/sanning-fulfilment — the fulfilment workflow's one tool.
//
// This is CUSTOMER code: it ships as a tool-package tarball through the
// hub's package-registry asset (see ../README.md) and is loaded by the
// production tool-package loader on the sidecar. No Interchange source
// is modified anywhere in this loop.
//
// The tool is deliberately thin: it forwards an approved evidence
// request's window to the agent-anchored-audit service's POST /assemble
// (the KEY-HOLDER — only that service has the persisted identity that
// signs evidence packs) and returns the service's answer to the model,
// which reports it as the workflow's final output. The workflow never
// sees a private key and never touches the retained audit bytes; it
// only carries the request in and the {path, sha256, counts} receipt
// out.
//
// Plain JS on purpose: the tool-package loader imports this file as-is
// from the tarball (no build step), and it depends on nothing but
// global fetch — the closure is the package itself.

const SERVICE_URL =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.SANNING_AGENT_SERVICE_URL) ||
  "http://127.0.0.1:4610";

const factory = () => ({
  definitions: [
    {
      name: "assemble",
      description:
        "Fulfil an APPROVED evidence request: ask the Sanning anchored-audit " +
        "agent service to assemble a signed, portable evidence pack covering " +
        "the request's period. Returns JSON with the pack's path, sha256, and " +
        "record/checkpoint counts. Pass the request fields through unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "The approved evidence request's id.",
          },
          period_since: {
            type: "string",
            description:
              "ISO 8601 lower bound (inclusive) of the evidence window.",
          },
          period_until: {
            type: "string",
            description:
              "ISO 8601 upper bound (inclusive) of the evidence window.",
          },
        },
        required: ["request_id"],
      },
    },
  ],
  run: async (call, signal) => {
    const args = call.arguments ?? {};
    const requestId =
      typeof args.request_id === "string" ? args.request_id : null;
    const body = {};
    if (typeof args.period_since === "string" && args.period_since !== "") {
      body.since = args.period_since;
    }
    if (typeof args.period_until === "string" && args.period_until !== "") {
      body.until = args.period_until;
    }

    let res;
    try {
      res = await fetch(`${SERVICE_URL}/assemble`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      return {
        callId: call.id,
        content: `assemble failed: agent service unreachable at ${SERVICE_URL} (${err instanceof Error ? err.message : String(err)})`,
        isError: true,
      };
    }
    const text = await res.text();
    if (!res.ok) {
      return {
        callId: call.id,
        content: `assemble failed (HTTP ${res.status}): ${text}`,
        isError: true,
      };
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return {
        callId: call.id,
        content: `assemble returned non-JSON: ${text.slice(0, 500)}`,
        isError: true,
      };
    }
    return {
      callId: call.id,
      content: JSON.stringify({
        request_id: requestId,
        path: result.path,
        sha256: result.sha256,
        records: result.records,
        disclosed: result.disclosed,
        checkpoints: result.checkpoints,
        issuer: result.issuer,
        window: result.window,
      }),
    };
  },
});

export const fulfilment = Object.assign(factory, {
  id: "@intx/sanning-fulfilment/tools",
  requires: [],
  definitions: [{ name: "assemble" }],
});
