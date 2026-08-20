# meridian-workbench — the Meridian day, run entirely on this estate

The complete Meridian Mutual story — a fire FNOL triaged, the claim it
became adjudicated, the household's renewal reviewed, and the paid
claim's recovery worked — as **four anchored agent sessions on the
Interchange platform**, each stage riding the published Sanning SDK
(`@sanning/anchor` 0.4.0 / `@sanning/proof` 0.4.1 from npm) through the
sibling example's anchored-audit composition (the embedded platform
pattern). Together with [`halden-claims-desk`](../halden-claims-desk/),
this makes the **whole two-company demonstration self-contained in this
repo**: Meridian runs its day here, Halden receives the demand and
verifies the packs here, and nothing depends on the claims-demo estate.

The same demonstration also exists natively on Meridian's own stack —
the [claims-demo](https://github.com/sanning-io/claims-demo) estate.
Same story, two independent platforms; a pack exported from either
verifies at the other, because a pack is just a file.

## Run it

```bash
bun install                                   # once, repo root

# zero-spend (mock model + mock dev upload):
bun run mock &                                # :4680
OPENROUTER_API_KEY=mock \
OPENROUTER_BASE_URL=http://localhost:4680 \
SANNING_DEV_UPLOAD_URL=http://localhost:4680 bun run serve   # :4630

# live model (real reasoning; anchoring per your env):
bun run serve                                 # needs OPENROUTER_API_KEY in .env
```

Open http://localhost:4630 and press **Run the day** — four stages
stream live, the recovery stage verifies the day's own adjudication
pack before acting, and its `send_demand_letter` attempt is
policy-denied: the **BLOCKED — escalated to counsel** state, anchored
as an `interchange.tool_blocked` record like everything else.

Then start the desk (`bun run serve` in `examples/halden-claims-desk`,
:4620) and press **Incoming demand — Meridian**: the desk pulls the
demand from THIS estate, requests evidence, locates the sessions, and
verifies the packs with the published kernels and **no Sanning
account**.

The full pipeline check (day → packs → desk-style verification →
demand → evidence resolution) runs with zero spend:

```bash
bun run smoke
```

## Anchoring modes

- `SANNING_API_KEY` set → **production**: anchors go through the Sanning
  control plane (`SANNING_CONTROL_PLANE_URL`, default
  `https://console.sanning.io`), each stage auto-registering as its own
  producer on first anchor.
- unset → **dev**: proofs are permanently marked `environment:"dev"`
  inside the signed bytes. `SANNING_DEV_UPLOAD_URL` points dev uploads
  at a local mock so nothing needs the network.

Each stage is its own producer with its own persisted Ed25519 identity
(fresh on first run, under the data dir — never copied from another
estate): `Meridian-Mutual.Intake-Triage` · `.Claims-Adjudication` ·
`.Policy-Renewal` · `.Subrogation`.

## The estate contract

The open HTTP surface a counterparty resolves evidence against — the
same contract the claims-demo Workbench exposes, which is why the desk
speaks to either without a new protocol:

```
GET /api/estate/sessions              { sessions: [ …meta ] }, newest first
GET /sessions/<dir>/meta.json         one session's meta
GET /sessions/<dir>/timeline.json     the streamed step timeline
GET /sessions/<dir>/pack/bundle.json  the sealed evidence pack
```

Packs disclose record content **in-body** (`disclose: true`); there is
deliberately no `logs-mapping.json` side file. Verify any pack
yourself, offline:

```bash
npx @sanning/proof verify <bundle.json>
```

(If that reports `unsupported evidence spec_version` on a machine with
an old npx cache, clear it — `rm -rf ~/.npm/_npx` — or run the CLI from
a fresh `npm i @sanning/proof`.)

## Honest labels

The demand Halden receives is **scripted fiction** — the recovery
agent's send is policy-denied, and the "issued by counsel" lift is the
desk's demo convention. There is **no machine request lane** (a real
evidence request through the console is
[control-plane#68](https://github.com/sanning-io/control-plane/issues/68))
and **no authorisation layer** — nothing proves who is asking or that
they are allowed. Verification is the real, shipped part; the
connective tissue between the companies is demo wiring, and says so.

## Knobs

`PORT` / `MERIDIAN_WORKBENCH_PORT` (default 4630) ·
`MERIDIAN_DATA_DIR` (estate + identities; default
`<repo>/tmp/meridian-workbench`) · `DEMO_PASSCODE` (gates `/run-day`)
· `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` / `OPENROUTER_BASE_URL` ·
`SANNING_API_KEY` / `SANNING_CONTROL_PLANE_URL` /
`SANNING_DEV_UPLOAD_URL`.
