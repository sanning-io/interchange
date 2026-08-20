# halden-claims-desk

Chapter two of the claims-demo story — **the counterparty**.

[`agent-anchored-audit`](../agent-anchored-audit/README.md) hosts
Meridian Mutual's recovery specialist: it verifies the upstream
adjudication, decides to pursue, drafts a $46,500 demand against the
electrical contractor _Hollis & Verne Electrical_ — and is denied the
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

- `sanning.*` packs (the claims-demo estate and the Interchange-hosted
  recovery agent) → the published
  [`@sanning/proof`](https://www.npmjs.com/package/@sanning/proof)
  kernel from npm
- `ario.*` packs (legacy anchors from before the `sanning.*` rename) →
  the published
  [`@ar.io/proof`](https://www.npmjs.com/package/@ar.io/proof)
  0.3.0 kernel from npm

Both imported programmatically (never `npx`: the two kernels claim the
same bin name).

## The job: Halden Indemnity — Inward Claims

Everything about the job lives in [`src/job.ts`](src/job.ts) and
[`fixtures/`](fixtures/); the voice and the visual identity are the
founder-approved Halden brand (grey until convinced: nothing on the
desk earns color until it verifies).

1. **Acknowledge.** The demand arrives **identifier-only** — the
   letter, its claim reference (`CLM-2026-3105`), its loss date. No
   evidence travels with it; no pack URL appears anywhere a human sees.
   Receipt is acknowledged on filing. Acknowledgment is not an
   admission of liability.
2. **Request the evidence.** Act II on the desk page is the
   evidence-request form: the claim reference (pre-filled from the
   demand), a time window around the loss date, and which records are
   wanted (the adjudication record, the recovery working record).
   Submitting it is what fetches evidence: the desk resolves the
   request against the Workbench's open session listing — newest
   matching session per requested kind — and the located records
   become the case's packs. Zero matches is an honest "no records
   located" state, and nothing runs.
3. **Verify FIRST.** Every located pack is verified before anything is
   read. On the desk page each pack is a still slate circle that fills
   **verdigris** when verification completes — or madder when it fails.
   A pack that does not verify is not evidence.
4. **Compare.** The demand's theory (negligent electrical work) is read
   against the sender's own verified record: Meridian's first notice of
   loss describes a _stovetop fire_, its field inspection recorded the
   wiring intact, and the junction-box refinement arrives only in a
   post-payment examination Meridian commissioned itself
   ([`fixtures/fnol-extract-FNOL-2026-3105.json`](fixtures/fnol-extract-FNOL-2026-3105.json)
   quotes the pack's own language). The policy on the desk is Hollis &
   Verne's CGL program with Halden
   ([`fixtures/policy-certificate-CGL-118-4720.json`](fixtures/policy-certificate-CGL-118-4720.json)).
5. **Decide and answer.** ACCEPT / DISPUTE / REQUEST-MORE, then
   `draft_response_letter` files Halden's position in the house
   register ("Acceptance of the record is not acceptance of
   liability"). The final message pins `DECISION:` / `BASIS:` /
   `RESPONSE:` lines.
6. **The gate.** The desk's authorize policy **denies
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

| Variable                 | Required      | What it does                                                                                                                                                                                                                                                      |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`     | to work cases | the desk agent's inference source (a filed demand errors politely without it)                                                                                                                                                                                     |
| `OPENROUTER_MODEL`       | no            | model override (default `anthropic/claude-haiku-4.5`)                                                                                                                                                                                                             |
| `PORT`                   | no            | deploy platforms (Railway) inject it; wins over the next row                                                                                                                                                                                                      |
| `HALDEN_DESK_PORT`       | no            | the example's own port override (default `4620`)                                                                                                                                                                                                                  |
| `SANNING_CONTEXT_DIR`    | no            | where persistent state lives — `identity.json`, `cases/`, `files/<ref>/` logbooks (default `<repo-root>/tmp/halden-claims-desk/context`); on hosted deploys point it at a mounted volume                                                                          |
| `MERIDIAN_WORKBENCH_URL` | no            | where the desk pulls incoming demands from and resolves evidence requests against (default `http://localhost:4630`, the in-estate `meridian-workbench` example — the two-company story needs nothing outside this repo); point it at any workbench speaking the same open estate contract, a hosted claims-demo included                                                          |
| `DEMO_PASSCODE`          | no            | when set, the endpoints that mutate the desk (`/fetch-demand`, `/file-demand`, `/request-evidence`, `DELETE /case/:file`) require it — `?key=` or an `x-demo-key` header; the page prompts once and keeps it for the tab session. Unset = open, the local default |

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

The desk (mutating endpoints gated by `DEMO_PASSCODE` when set):

- `GET /` — the Halden-branded page, composed as a case file: the
  demand with its identifiers, the evidence-request form (Act II), the
  examination panel (slate → verdigris / madder), the desk record
  stream, the decision, and the response letter as Halden
  correspondence. Light and dark themes both work (the day desk and
  the night desk); nothing pulses.
- `POST /fetch-demand` — pull the newest recovery demand from the
  Workbench (`MERIDIAN_WORKBENCH_URL`), server-side, and open a case
  **identifier-only** (claim reference + loss date, no pack URLs). The
  page's **Incoming demand — Meridian** button (top right) drives it;
  so does [`scripts/file-meridian-demand.ts`](scripts/file-meridian-demand.ts).
- `POST /file-demand` `{demandText, claimRef?, lossDate?}` — file a
  demand by hand, identifier-only; the page's **File a demand** form
  drives it. The legacy shape `{demandText, packUrls[]}` — evidence
  attached to the filing itself — still works for one release and is
  **deprecated**: evidence belongs to the request flow.
- `POST /request-evidence` `{file, claimRef, since, until, kinds[]}` —
  the evidence-request form's endpoint: resolve the request against
  the Workbench (kinds: `adjudication`, `recovery-working`), attach
  the located records to the case, and start the verify-first
  examination. Zero matches leaves an honest "no records located"
  state and runs nothing.
- `DELETE /case/:file` — admin hygiene: remove a case and its files
  from the context dir.
- `GET /gate` — passcode preflight: `204` when no passcode is set or
  the supplied one is right, `401` otherwise.
- `GET /case.json` — the latest case (or `?file=HIC-2026-0412`).
- `GET /stream` — SSE: case snapshots as they change (what the page
  listens to).
- `GET /health` — liveness, the desk's public key, and what it
  verifies.

### The handoff from Meridian

With the in-estate Meridian Workbench on `:4630` (serving sessions — `bun run serve` in `examples/meridian-workbench`; `MERIDIAN_WORKBENCH_URL` overrides for a claims-demo estate on `:4601`) and the
desk on `:4620`, the whole story is drivable from the page alone:
**Incoming demand — Meridian** (top right) pulls the demand, Act II's
form requests the evidence, and the examination runs to a position.
From a terminal, the same handoff:

```bash
bun run file-demand      # scripts/file-meridian-demand.ts
```

The script is a thin caller of `POST /fetch-demand` — the desk itself
pulls the newest recovery session from its Workbench, lifts the
drafted demand to "issued by counsel" (the demo's fiction), and opens
the case identifier-only. What crosses the company seam is the letter
and its identifiers; the evidence is fetched later, by the desk's own
request, and the trust arrives last — when Halden's kernels finish
with the located packs. Overrides: `HALDEN_DESK_URL` and
`HALDEN_DESK_KEY` (or `DEMO_PASSCODE`) when the hosted desk gates its
endpoints. Which Workbench the demand comes from is the **desk's**
`MERIDIAN_WORKBENCH_URL`, not the script's.

**Where the files land:** like every example, output goes to
`<repo-root>/tmp/halden-claims-desk/context/` — `identity.json` (the
desk's one persisted key), `cases/` (the desk page's case snapshots),
and `files/HIC-2026-…/` (each case's own conversation and SSH-signed
git logbook: one file, one fresh examination — a shared dir would
resume the previous case's conversation, which is the runtime's resume
feature and exactly what a claims desk must not do between demands).
`rm -rf ../../tmp/halden-claims-desk` starts the desk over.

## Temporary scaffolding

Three pieces of this example are interim stand-ins; each shrinks to
nothing when the product feature behind it lands:

- **The "issued by counsel" lift** in
  [`src/workbench.ts`](src/workbench.ts): the desk promotes Meridian's
  drafted-but-denied demand to "issued by authority of supervising
  counsel" in the demo's fiction. Replaced by a real delivery step in
  the evidence-request flow — the fulfilment decision,
  [control-plane#68](https://github.com/sanning-io/control-plane/issues/68).
- **The resolver against open session listings** (also
  [`src/workbench.ts`](src/workbench.ts)): the evidence request
  resolves by querying the Workbench's open estate APIs and matching
  caseRef / window / agent category. Itself interim — the product
  version is a **console evidence request** served by the control
  plane, [control-plane#68](https://github.com/sanning-io/control-plane/issues/68).
  The durable part is the seam: demands carry identifiers; evidence
  arrives by request.
- **The deprecated `packUrls[]` filing shape**: evidence attached
  directly to `POST /file-demand`, kept one release for the cloud
  smoke and back-compat. Replaced by the request flow above, and by
  the four-layer evidence delivery once that shape is validated —
  [evidence-delivery-shape.md](https://github.com/sanning-io/knowledge-base/blob/claude/interchange-sprint-thread/research/evidence-delivery-shape.md)
  (knowledge-base; on its PR branch until
  [knowledge-base#50](https://github.com/sanning-io/knowledge-base/pull/50)
  merges).
