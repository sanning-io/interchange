# agent-anchored-audit

[`agent-audit-log`](../agent-audit-log/README.md) shows that the audit
trail is a real git repository — open format, standard tools. This
example adds the missing external leg: every audit record is **also
anchored to Arweave** via
[`@ar.io/anchor-interchange`](https://github.com/sanning-io/anchor/tree/main/packages/interchange),
so the trail is verifiable by someone who trusts **neither this
machine nor its operator**. A git history can be rewritten by whoever
holds the keys; an anchored checkpoint cannot.

## The job: Meridian Mutual — Recovery

The agent this example hosts is a **real insurance worker**: Meridian
Mutual's recovery (subrogation) specialist, stage four of the
claims-demo fire-claim journey (claim `CLM-2026-3105`, paid $45,500).
Everything about the job lives in [`src/job.ts`](src/job.ts) and
[`fixtures/`](fixtures/):

1. **`verify_evidence_pack` — the handoff moment.** Before doing any
   work, the specialist fetches the upstream adjudication's sealed
   evidence pack (produced by the claims-demo estate on the `sanning.*`
   wire IDs) and verifies it **programmatically** with the vendored
   `@sanning/proof` 0.4.0 kernel — signatures, Merkle inclusion,
   disclosed-content hashes, all offline. No pack, or any verdict other
   than `verified` → the specialist **refuses to proceed** and says why.
   The refusal is anchored evidence too.
2. **The casefile** (deterministic reads over fixtures): the
   cause-and-origin investigation report (faulty rewiring by the
   fictional contractor *Hollis & Verne Electrical* caused the fire),
   the policy's subrogation clause, and the payout record.
3. **Decide, draft, and be denied.** The specialist decides
   PURSUE/DECLINE per the clause, drafts the demand letter
   (`draft_demand_letter`, allowed) — and its attempt to
   `send_demand_letter` is **denied by the authorize policy**: issuance
   is reserved for supervising counsel. The denial becomes an anchored
   `interchange.tool_blocked` record.

The final message pins `DECISION:` / `AMOUNT:` / `TARGET:` /
`RATIONALE:` lines — the shape the Meridian Workbench reads its outcome
badges from.

## What it shows

- **One-line integration.** The store you already pass as `env.audit`
  is wrapped: `audit: anchoredAuditStore(storage, anchorer)`. Nothing
  else in the composition changes; git remains the system of record
  and every anchor happens _behind_ the git commit.
- **The agent's own identity signs the anchors.**
  `signerFromCryptoProvider(createEd25519Crypto(keyPair))` reuses the
  `@intx/crypto` surface — no second key to custody.
- **Denials are as provable as actions.** The example's authorize
  policy blocks the destructive tool. The blocked call becomes an
  `interchange.tool_blocked` record in the same tamper-evident,
  per-session chain as the allowed calls.
- **One write per session.** Records are Merkle-batched: the whole run
  is a single Arweave transaction, but every record keeps its own
  standalone inclusion proof.
- **Nothing semantic leaves the process.** Records are hashed locally;
  the on-chain envelope carries only hashes (`ario.events/v1`, Minimal
  disclosure).

## Running

```bash
export ANTHROPIC_API_KEY=sk-...        # or: export OPENROUTER_API_KEY=sk-or-...
cd examples/agent-anchored-audit
bun run start
```

With `OPENROUTER_API_KEY` set, the run goes through OpenRouter's
OpenAI-compatible endpoint instead of Anthropic directly (default model
`anthropic/claude-haiku-4.5`; override with `OPENROUTER_MODEL` — pick a
tool-capable model, since the demo is two tool calls). `OPENROUTER_API_KEY`
wins when both are set. Bun also auto-loads a local `.env`, so dropping the
key in `examples/agent-anchored-audit/.env` works too.

### Service mode

The same composition also runs as a small resident HTTP service
(`bun run serve`, port `4610`, override with
`SANNING_AGENT_SERVICE_PORT`):

- `POST /run` `{caseRef?, packUrl?, prompt?}` — one anchored recovery
  session, exactly the CLI's composition (`src/composition.ts` is
  shared by both entry points), returning the session id, receipt count
  and a decision summary. `packUrl` is the upstream adjudication pack
  the specialist verifies first; absent → the run is the refusal path.
- `POST /run?stream=1` — the same run as **SSE**, one JSON frame per
  event in the Meridian Workbench's vocabulary (`agent_start` → `step`
  per anchored audit record → `sealing` → `anchored` with
  txIds/gatewayUrls → `pack` with the decision; `agent_error` on
  failure), so the claims-demo relay passes frames through near-verbatim.
- `GET /timeline/:sessionId` — the streamed run's step timeline (held
  in memory for the service's lifetime).
- `GET /pack/:sessionId` — that session's own evidence pack (fresh runs
  from memory; older sessions reassembled from the durable retention
  trail — the pack outlives the process).
- `POST /assemble` `{since?, until?, sessionIds?}` — no model, no new
  anchors: reconstructs the inclusion receipts for the requested window
  from the durable retention trail (`anchor/proofs.jsonl` +
  `anchor/logs/`), has the persisted identity sign ONE
  `ario.evidence/v1` pack (`evidence-pack-<stamp>.json`, raw records
  disclosed in-body), and returns its path, sha256 and counts. This is
  the key-holder fulfilling an evidence request **after the fact** —
  the sessions that produced the evidence are long gone.
- `GET /gate` — passcode preflight: `204` when no passcode is set or
  the supplied one is right, `401` otherwise.
- `GET /health` — liveness, mode, producer, public key.

#### Service-mode environment

| Variable | Required | What it does |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | for `POST /run` | service mode's inference source (the CLI also accepts `ANTHROPIC_API_KEY`; the service is OpenRouter-only) |
| `OPENROUTER_MODEL` | no | model override (default `anthropic/claude-haiku-4.5`) |
| `PORT` | no | deploy platforms (Railway) inject it; wins over the next row |
| `SANNING_AGENT_SERVICE_PORT` | no | the example's own port override (default `4610`) |
| `SANNING_CONTEXT_DIR` | no | where persistent state lives — `identity.json`, `wallet.json`, the `anchor/` retention trail (default `<repo-root>/tmp/agent-anchored-audit/context`); on hosted deploys point it at a mounted volume |
| `DEMO_PASSCODE` | no | when set, `POST /run` and `POST /assemble` require it (`?key=` or an `x-demo-key` header); unset = open, the local default |
| `SANNING_API_KEY` | no | production anchoring via the control plane (unset = dev mode; see below) |
| `SANNING_DEV_UPLOAD_URL` | no | dev-mode mock upload front for a fully local loop |
| `SANNING_PRODUCER_ID` · `SANNING_AGENT_NAME` · `SANNING_DISPLAY_NAME` · `SANNING_CONTROL_PLANE_URL` | no | keyed-mode extras (see “Anchoring modes”) |

#### Docker

[`Dockerfile.recovery-agent`](../../Dockerfile.recovery-agent) at the
**repo root** builds this service (root context so the `@intx/*`
workspace packages resolve):

```bash
docker build -f Dockerfile.recovery-agent -t recovery-agent .   # from the repo root
docker run -p 4610:4610 -v recovery-data:/data \
  -e OPENROUTER_API_KEY=... -e DEMO_PASSCODE=... recovery-agent
```

The image sets `SANNING_CONTEXT_DIR=/data` — mount the volume there so
the identity and the retention trail outlive deploys.

[`fulfilment/`](fulfilment/README.md) closes the loop: an Interchange
workflow (customer code — a tool package + workflow definition) that
receives an approved evidence request on its mail trigger and calls
`/assemble` to fulfil it.

### Anchoring modes

`SANNING_API_KEY` switches how the anchors leave the machine:

- **Unset — dev mode.** Envelopes are permanently marked
  `environment: "dev"`. Uploads go unauthenticated to the default
  `/anchor` front, which may reject them (HTTP 401); the example then
  warns and finishes — the signed git audit trail is intact either way.
  For a fully local loop, set `SANNING_DEV_UPLOAD_URL` to a mock front
  (`POST <url>/v1/tx → { id }`) and the whole flow — receipts, packs,
  the service endpoints — works without spending an anchor.
- **Set — production via the Sanning control plane.** Uploads go through
  `<SANNING_CONTROL_PLANE_URL>/anchor` (default
  `https://console.sanning.io`) with the key, and the signing identity
  auto-registers on the fleet roster on first anchor.

Optional, keyed mode only: `SANNING_PRODUCER_ID` (identity on the
roster, default `interchange-audit-demo`), `SANNING_AGENT_NAME`
(subject name sealed into the evidence — this deployment's history is
`Meridian-Mutual.Subrogation`, kept for continuity),
`SANNING_DISPLAY_NAME` (the roster-only display name Fleet shows;
default `Meridian Mutual — Recovery` — a rename shows up in the console
immediately and never rewrites what past envelopes were signed saying),
`SANNING_CONTROL_PLANE_URL`.

> **Two kernels, deliberately.** This agent's OWN anchors are `ario.*`
> wire IDs (the vendored `@ar.io/anchor` 0.2.0) — its packs verify with
> the published `npx @ar.io/proof`. The claims-demo packs it VERIFIES
> are `sanning.*` — those go through the vendored `@sanning/proof`
> 0.4.0 kernel, imported programmatically in the verify tool (never
> `npx`: both kernels claim the bin name `proof`).

### Persisted identity

The agent's Ed25519 seed lives in `<contextDir>/identity.json`, created
on the first run and reused after — every run signs commits and anchors
as the **same** producer. Keyed mode also keeps a separate data-item
wallet keypair in `<contextDir>/wallet.json`. Deleting the context dir
(below) mints a fresh identity.

The default one-shot prompt is the recovery referral WITHOUT a pack
URL — the refusal path (the specialist must decline, and the refusal
is anchored). A full run through service mode with a verified pack
ends with something like:

```
anchored audit trail (6 record(s), one checkpoint write):
  interchange.tool_call      verify_evidence_pack        seq 0
  interchange.tool_call      read_investigation_report   seq 1
  interchange.tool_call      read_policy_recovery_clause seq 2
  interchange.tool_call      read_payout_record          seq 3
  interchange.tool_call      draft_demand_letter         seq 4
  interchange.tool_blocked   send_demand_letter          seq 5  <- the denial, provable
checkpoint: <txId>
  https://console.sanning.io/read/<txId>

portable evidence bundle: <contextDir>/trace-bundle.json
  (6/6 records disclosed in-body, each bound to its committed hash)
verify it anywhere — no repo access, no agent, no write SDK:
  npx @ar.io/proof verify <contextDir>/trace-bundle.json
```

**Where the files land:** not in this folder — like every agent-*
example, output goes to `<repo-root>/tmp/agent-anchored-audit/context/`
(the run prints the full path). In there: `state/audit/` (the git
logbook), `anchor/` (durable proofs + retained bytes),
`identity.json` / `wallet.json` (the persisted keys), and
`trace-bundle.json` (the file you hand to an auditor).

To start over:

```bash
rm -rf ../../tmp/agent-anchored-audit
```

## The auditor's side

Copy `trace-bundle.json` to any machine — no Interchange, no agent, no
access to the git repo — and run the read-only verifier:

```bash
npx @ar.io/proof verify trace-bundle.json
# optionally re-fetch the checkpoint on-chain to confirm it's anchored:
npx @ar.io/proof verify trace-bundle.json https://arweave.net,https://permagate.io
```

It recomputes every record's signature, payload binding, and Merkle
inclusion — and, because the bundle **discloses the raw records
in-body**, it also recomputes each disclosed record's `SHA-256` against
the committed `content_hash` (the `logs ✓` marks, `@ar.io/proof` ≥
0.3.0). The auditor doesn't just verify *that* two tool calls happened;
they read *what* the calls were — the blocked deletion included — and
every byte of it is bound to the on-chain checkpoint. Drag-and-drop
bundle viewers built on `verifyEvidenceBundle` show the same thing with
full content coverage.

Disclosure is opt-in: `anchorer.bundle(receipts, { disclose: true })`
embeds every record the anchorer's `logStore` retained (pass a per-event
map instead for selective disclosure). Delete `disclose` and the same
bundle verifies hash-only — auditors confirm integrity without reading
a single tool call.

Now tamper with anything — edit one byte of a record in the bundle, or
of the corresponding `state/audit/` file an operator would hand over —
and verification fails: the hash no longer binds.

## Retention is the SDK's job

The run also leaves a durable retention trail under
`<contextDir>/anchor/`, injected once on the anchorer (`FsSink` +
`FsLogStore` — the adapter inherits both untouched): `proofs.jsonl`
holds one proof row per event and checkpoint, and `logs/` holds the
exact committed bytes, content-addressed. Everything the bundle
disclosed came from that store — no second copy of the truth.

Without `SANNING_API_KEY` this run uses `@ar.io/anchor`'s dev mode; the
envelopes are permanently marked `environment: "dev"` inside the signed
bytes. With the key set, envelopes are `environment: "production"`,
signed by the persisted identity and uploaded with the persisted wallet
signer — see the adapter README.

> **Note:** `@ar.io/anchor` and `@ar.io/anchor-interchange` are
> consumed from vendored tarballs (`vendor/`) ahead of their npm
> release. Both become normal version ranges once published.

## Temporary scaffolding

Three pieces of this example are interim stand-ins for product
features in flight; each shrinks to nothing when its feature lands:

- **The fulfilment bridge stub**
  ([`fulfilment/bridge-stub.ts`](fulfilment/bridge-stub.ts)) fakes the
  console-approval leg of an evidence request. Replaced by the console
  pushing a signed notice plus machine access to requests —
  [control-plane#68](https://github.com/sanning-io/control-plane/issues/68).
- **The `/assemble` endpoint** ([`src/serve.ts`](src/serve.ts)) is a
  hand-rolled stand-in for the SDK's official assemble verb —
  [control-plane#69](https://github.com/sanning-io/control-plane/issues/69),
  decision at
  [control-plane#61](https://github.com/sanning-io/control-plane/issues/61).
- **Two SDK workarounds** in
  [`src/composition.ts`](src/composition.ts): the wrap that catches
  the session-close crash when the upload is rejected at `close()`,
  and the subject name-format lift. Both go away with the SDK fixes
  in [anchor#15](https://github.com/sanning-io/anchor/issues/15).
