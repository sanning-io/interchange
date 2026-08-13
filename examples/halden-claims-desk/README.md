# halden-claims-desk

Chapter two of the claims-demo story — **the counterparty**.

[`agent-anchored-audit`](../agent-anchored-audit/README.md) hosts
Meridian Mutual's recovery specialist: it verifies the upstream
adjudication, decides to pursue, drafts a $46,500 demand against the
electrical contractor *Hollis & Verne Electrical* — and is denied the
send, which goes to supervising counsel. This example is the desk that
demand LANDS ON: the **Halden Indemnity Company** (Hartford, est.
1908), Hollis & Verne's commercial-liability insurer, receiving another
company's demand and another company's evidence.

## The point: only the producer pays; anyone can check

Halden holds **no Sanning account**. There is no `SANNING_API_KEY`
anywhere in this example, no credential of the sender's platform, no
registration, no fee. The evidence packs Meridian attaches are fetched
over plain HTTP and verified **locally** with the public verification
kernels — signatures, Merkle inclusion, disclosed-content hashes —
against the public anchor. Producing verifiable evidence is the paid
product; verifying it is free and open, for counterparties, auditors,
and courts alike. That asymmetry is the story: the two companies share
no platform, no login, and no trust — only math.

Two kernels, dispatched by each pack's own `spec_version`:

- `sanning.*` packs (the claims-demo estate) → the vendored
  [`@sanning/proof`](vendor/) 0.4.0 kernel
- `ario.*` packs (the Interchange-hosted recovery agent) → the
  published [`@ar.io/proof`](https://www.npmjs.com/package/@ar.io/proof)
  0.3.0 kernel from npm

Both imported programmatically (never `npx`: the two kernels claim the
same bin name).

## The job: Halden Indemnity — Inward Claims

Everything about the job lives in [`src/job.ts`](src/job.ts) and
[`fixtures/`](fixtures/); the voice and the visual identity are the
founder-approved Halden brand (grey until convinced: nothing on the
desk earns color until it verifies).

1. **Acknowledge.** Receipt is acknowledged on filing. Acknowledgment
   is not an admission of liability.
2. **Verify FIRST.** Every offered pack is verified before anything is
   read. On the desk page each pack is a still slate circle that fills
   **verdigris** when verification completes — or madder when it fails.
   A pack that does not verify is not evidence.
3. **Compare.** The demand's theory (negligent electrical work) is read
   against the sender's own verified record: Meridian's first notice of
   loss describes a *stovetop fire*, its field inspection recorded the
   wiring intact, and the junction-box refinement arrives only in a
   post-payment examination Meridian commissioned itself
   ([`fixtures/fnol-extract-FNOL-2026-3105.json`](fixtures/fnol-extract-FNOL-2026-3105.json)
   quotes the pack's own language). The policy on the desk is Hollis &
   Verne's CGL program with Halden
   ([`fixtures/policy-certificate-CGL-118-4720.json`](fixtures/policy-certificate-CGL-118-4720.json)).
4. **Decide and answer.** ACCEPT / DISPUTE / REQUEST-MORE, then
   `draft_response_letter` files Halden's position in the house
   register ("Acceptance of the record is not acceptance of
   liability"). The final message pins `DECISION:` / `BASIS:` /
   `RESPONSE:` lines.
5. **The gate.** The desk's authorize policy **denies
   `admit_liability`**: the agent may acknowledge, verify, accept
   payment, and dispute — it may never admit liability. Admission is
   reserved to supervising counsel, and an attempted admission lands in
   the logbook as a denied record like everything else.

Halden's own audit trail is Interchange's **plain git audit store** —
an SSH-signed logbook under the desk's persisted Ed25519 identity
(`<contextDir>/identity.json`). Halden is not a producer; nothing is
anchored. It runs the same runtime as the Meridian-side example minus
the anchoring adapter, which is exactly the asymmetry the story needs.

## Running

```bash
export OPENROUTER_API_KEY=sk-or-...    # or drop it in ./.env (Bun auto-loads)
cd examples/halden-claims-desk
bun run serve                          # the desk, on http://localhost:4620
```

Override the model with `OPENROUTER_MODEL` (default
`anthropic/claude-haiku-4.5`), the port with `HALDEN_DESK_PORT`.

### Environment

| Variable | Required | What it does |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | to work cases | the desk agent's inference source (a filed demand errors politely without it) |
| `OPENROUTER_MODEL` | no | model override (default `anthropic/claude-haiku-4.5`) |
| `PORT` | no | deploy platforms (Railway) inject it; wins over the next row |
| `HALDEN_DESK_PORT` | no | the example's own port override (default `4620`) |
| `SANNING_CONTEXT_DIR` | no | where persistent state lives — `identity.json`, `cases/`, `files/<ref>/` logbooks (default `<repo-root>/tmp/halden-claims-desk/context`); on hosted deploys point it at a mounted volume |
| `DEMO_PASSCODE` | no | when set, `POST /file-demand` (the one endpoint that starts a paid examination) requires it — `?key=` or an `x-demo-key` header; the page prompts once and keeps it for the tab session. Unset = open, the local default |

### Docker

[`Dockerfile.halden-desk`](../../Dockerfile.halden-desk) at the **repo
root** builds the desk (root context so the `@intx/*` workspace
packages resolve):

```bash
docker build -f Dockerfile.halden-desk -t halden-desk .   # from the repo root
docker run -p 4620:4620 -v halden-data:/data \
  -e OPENROUTER_API_KEY=... -e DEMO_PASSCODE=... halden-desk
```

The image sets `SANNING_CONTEXT_DIR=/data` — mount the volume there so
the desk's identity and case files outlive deploys.

The desk:

- `GET /` — the Halden-branded page: the demand as received, the
  examination panel (slate → verdigris / madder), the desk record
  stream, the decision, and the response letter as Halden
  correspondence. Light and dark themes both work (the day desk and
  the night desk); nothing pulses.
- `POST /file-demand` `{demandText, packUrls[]}` — a counterparty files
  a demand; the desk opens a file (`HIC-2026-…`), acknowledges,
  verifies, decides, and answers. Cases serialize on one logbook.
  Gated by `DEMO_PASSCODE` when set; the page's **File a demand**
  button (top right) drives the same endpoint and asks for the
  passcode once.
- `GET /gate` — passcode preflight: `204` when no passcode is set or
  the supplied one is right, `401` otherwise.
- `GET /case.json` — the latest case (or `?file=HIC-2026-0412`).
- `GET /stream` — SSE: case snapshots as they change (what the page
  listens to).
- `GET /health` — liveness, the desk's public key, and what it
  verifies.

### The handoff from Meridian

With the claims-demo Workbench on `:4601` (serving sessions) and the
desk on `:4620`:

```bash
bun run file-demand      # scripts/file-meridian-demand.ts
```

The script pulls the newest recovery session from the Workbench,
extracts the demand its agent drafted (issuance now signed off, in the
demo's fiction), takes the adjudication pack the payment rests on plus
the recovery session's own pack, and POSTs the lot to the desk. The
file travels over dumb HTTP; the trust arrives separately, when
Halden's own kernels finish with the packs. Overrides:
`MERIDIAN_WORKBENCH_URL`, `HALDEN_DESK_URL`, and `HALDEN_DESK_KEY`
(or `DEMO_PASSCODE`) when the hosted desk gates filing.

**Where the files land:** like every example, output goes to
`<repo-root>/tmp/halden-claims-desk/context/` — `identity.json` (the
desk's one persisted key), `cases/` (the desk page's case snapshots),
and `files/HIC-2026-…/` (each case's own conversation and SSH-signed
git logbook: one file, one fresh examination — a shared dir would
resume the previous case's conversation, which is the runtime's resume
feature and exactly what a claims desk must not do between demands).
`rm -rf ../../tmp/halden-claims-desk` starts the desk over.

## Temporary scaffolding

Two pieces of this example are interim stand-ins; each shrinks to
nothing when the product feature behind it lands:

- **The "issued by counsel" lift** in
  [`scripts/file-meridian-demand.ts`](scripts/file-meridian-demand.ts):
  the script promotes Meridian's drafted-but-denied demand to "issued
  by authority of supervising counsel" in the demo's fiction. Replaced
  by a real delivery step in the evidence-request flow — the
  fulfilment decision,
  [control-plane#68](https://github.com/sanning-io/control-plane/issues/68).
- **Raw hex pack links with no readable layer**: the demand carries
  bare pack URLs. Replaced by the four-layer evidence delivery once
  that shape is validated —
  [evidence-delivery-shape.md](https://github.com/sanning-io/knowledge-base/blob/claude/interchange-sprint-thread/research/evidence-delivery-shape.md)
  (knowledge-base; on its PR branch until
  [knowledge-base#50](https://github.com/sanning-io/knowledge-base/pull/50)
  merges).
