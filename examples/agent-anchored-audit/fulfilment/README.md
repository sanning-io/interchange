# Evidence fulfilment — the anchored-audit loop, closed

This directory closes the loop the rest of the example opens. The
example proves an agent's actions (and denials) can be **anchored** as
they happen; this adds the other half: an **approved evidence request**
arriving from outside is **fulfilled** — automatically, by an
Interchange workflow — with one signed, portable, independently
verifiable evidence pack.

Everything here is _customer code_: a tool package distributed through
the hub's package-registry asset, a workflow definition pushed to a
workflow asset, and two driver scripts that use only the hub's public
REST + git surfaces. No Interchange source is modified.

## The loop

```
                         ┌─ Sanning console ─┐
   auditor's request ───▶│ approval (human)  │        (bridge-stub.ts fakes
                         └───────┬───────────┘         this leg for now)
                                 │  {request_id, period_since, period_until}
                                 ▼
                  POST /workflows/:id/mail  (the workflow's mail trigger)
                                 │
                     ┌───────────▼───────────┐
                     │ fulfilment workflow    │  one step; the step agent is
                     │ (this directory)       │  told: call the assemble tool
                     └───────────┬───────────┘
                                 │  @intx/sanning-fulfilment/tools:assemble
                                 ▼
                  POST http://127.0.0.1:4610/assemble
                     ┌───────────▼───────────┐
                     │ agent service          │  the KEY-HOLDER: loads the
                     │ (../src/serve.ts)      │  retained receipts for the
                     └───────────┬───────────┘  window, signs ONE evidence
                                 │              pack with the same persisted
                                 ▼              identity that anchored them
                  evidence-pack-<stamp>.json  → path + sha256 + counts flow
                                                back up through the tool into
                                                the workflow's final output
```

The separation is the point: the **workflow** carries the request in and
the receipt out, but never sees a private key and never touches the
retained audit bytes. The **agent service** holds the identity and the
retention trail, and assembly is a purely local act — no model call, no
network write, no new anchors. Anyone holding the resulting pack runs

```bash
npx @ar.io/proof verify evidence-pack-<stamp>.json \
  https://arweave.net,https://permagate.io,https://console.sanning.io/read
```

and gets a verdict that depends on neither this machine nor its
operator.

## What's in here

| File             | Role                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool/`          | The tool package (`@intx/sanning-fulfilment@0.1.0`): `package.json` declares `interchange.tools`; `sidecar-bundle.js` exports the annotated tool factory whose one `assemble` tool forwards the request window to the agent service. Plain JS, zero dependencies — the loader imports it straight from the tarball.                                    |
| `workflow.json`  | The workflow definition: a mail trigger and one step whose agent is instructed to call the assemble tool with the trigger's JSON payload and report the returned path/sha256/counts. `deploy.ts` rewrites the trigger address to the target tenant's mail domain at deploy time.                                                                       |
| `deploy.ts`      | Deploy driver: packs `tool/` into an npm-style tarball, PUTs it into the tenant's `workspace-builtins` package-registry asset, pushes `workflow.json` to a workflow asset over the git smart-HTTP route, then deploys with `toolPackages: [{name, version}]` and an OpenRouter inference source (key read at runtime from `../.env`, never committed). |
| `bridge-stub.ts` | Stands in for the console-ledger poller (out of scope until a service account exists): forwards ONE faked approved request to the deployment's mail route and watches the run's event log to completion.                                                                                                                                               |

## The tool-package convention used

Tool packages are the hub's canonical way to give a workflow step a
custom tool (see `packages/tool-packaging/ASSET-LAYOUT.md`):

- the tarball's `package.json` carries `interchange.tools` pointing at
  a module that exports an `AnnotatedToolFactory`
  (`Object.assign(factory, { id, requires, definitions })`);
- the tarball is uploaded to a `package-registry` asset
  (`PUT …/assets/:id/tarballs/<name>-<version>.tgz`);
- the deploy body pins it (`toolPackages`), the hub resolves the
  closure against the registry, and the sidecar loader materializes and
  imports it; the model sees the tool as `<bundle-id>:assemble`.

One pragmatic choice to be explicit about: the package is named under
the **`@intx` scope** because the stock hub's scope routing resolves
only `@intx` pins against the `workspace-builtins` asset registry
(everything else goes to npmjs). Scope routing is hub _configuration_
(`apps/hub/src/index.ts`), not customer code — a production deployment
would add its own scope route or registry for customer packages rather
than borrow the builtins' scope.

## Running it

```bash
# 0. hub stack up (bin/dev), agent service up:
cd examples/agent-anchored-audit && bun run serve     # :4610

# 1. produce evidence (any number of anchored sessions):
curl -X POST localhost:4610/run

# 2. deploy the fulfilment workflow (from the repo root):
bun examples/agent-anchored-audit/fulfilment/deploy.ts

# 3. fulfil an approved request:
bun examples/agent-anchored-audit/fulfilment/bridge-stub.ts
```

The run's `StepCompleted` output carries the report (request id, pack
path, sha256, record/checkpoint counts); the pack lands in the agent
service's context directory, ready to hand to the auditor.
