# agent-anchored-audit

[`agent-audit-log`](../agent-audit-log/README.md) shows that the audit
trail is a real git repository — open format, standard tools. This
example adds the missing external leg: every audit record is **also
anchored to Arweave** via
[`@ar.io/anchor-interchange`](https://github.com/ar-io/ar-io-anchor/tree/main/packages/interchange),
so the trail is verifiable by someone who trusts **neither this
machine nor its operator**. A git history can be rewritten by whoever
holds the keys; an anchored checkpoint cannot.

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
`anthropic/claude-sonnet-4.6`; override with `OPENROUTER_MODEL` — pick a
tool-capable model, since the demo is two tool calls). `OPENROUTER_API_KEY`
wins when both are set. Bun also auto-loads a local `.env`, so dropping the
key in `examples/agent-anchored-audit/.env` works too.

The default prompt asks the agent to check disk usage and delete old
backups; the policy allows the check and denies the deletion. Output
ends with:

```
anchored audit trail (2 record(s), one checkpoint write):
  interchange.tool_call      check_disk_usage     seq 0
  interchange.tool_blocked   delete_all_backups   seq 1  <- the denial, provable
checkpoint: <txId>
  https://turbo-gateway.com/<txId>

portable evidence bundle: <contextDir>/trace-bundle.json
verify it anywhere — no repo access, no agent, no write SDK:
  npx @ar.io/proof verify <contextDir>/trace-bundle.json
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
inclusion and prints a per-record + rollup verdict. Now tamper with
anything — edit one byte of a record in the bundle, or of the
corresponding `state/audit/` file an operator would hand over — and
verification fails: the hash no longer binds.

This run uses `@ar.io/anchor`'s dev mode (auto-minted wallet, free
tier); the envelopes are permanently marked `environment: "dev"`
inside the signed bytes. Production requires an explicit signer and
funded wallet — see the adapter README.

> **Note:** `@ar.io/anchor-interchange` is consumed here from a
> vendored tarball (`vendor/`) while the package awaits its npm
> release; the dependency becomes a normal version range at that
> point.
