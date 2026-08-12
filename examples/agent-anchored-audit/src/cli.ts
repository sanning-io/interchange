// agent-anchored-audit: Interchange's audit trail, made verifiable by
// someone who trusts neither this machine nor its operator.
//
// The audit story so far (see agent-audit-log): every tool call becomes
// an AuditRecord in a real git repository — open format, standard
// tools. This example adds the missing external leg: each committed
// record is ALSO Merkle-batched and anchored via
// @ar.io/anchor-interchange, so every record — including the calls
// authorization BLOCKED — gets a standalone inclusion proof that lives
// outside the repo it attests to. A git history can be rewritten by
// whoever holds the keys; the anchored checkpoint cannot.
//
// The integration is one line: wrap the store you already pass as
// `env.audit`. The agent's own Ed25519 identity (from @intx/crypto)
// signs the anchors — no second key to custody. Records are hashed
// locally; nothing semantic leaves the process (the on-chain envelope
// carries only hashes).
//
// The identity PERSISTS across runs: the Ed25519 seed lives in
// `<contextDir>/identity.json` (created on first run), so every run of
// this example anchors as the same producer. In keyed mode (see below)
// a second, separate data-item wallet keypair persists in
// `<contextDir>/wallet.json`.
//
// Two anchoring modes, switched by SANNING_API_KEY:
//
//   - unset  → dev mode, unchanged from the original example: proofs
//     are permanently marked environment:"dev"; upload failures warn
//     and the run continues.
//   - set    → production mode through the Sanning control plane:
//     uploads go via `<SANNING_CONTROL_PLANE_URL>/anchor` with the key,
//     and the signing key auto-registers on the fleet roster under
//     SANNING_PRODUCER_ID (default "interchange-audit-demo").
//
// The job is Meridian Mutual's RECOVERY specialist (see ./job): verify
// the upstream adjudication's evidence pack, work the recovery casefile,
// draft the demand — and be denied the send by the authorize policy.
// The run drives one agent turn, then closes, bundles the receipts into
// a single portable trace-bundle.json, and prints the command an auditor
// runs to verify the whole thing offline with the read-only verifier:
//
//   npx @ar.io/proof verify <contextDir>/trace-bundle.json
//
// The full composition (identity, retention, anchorer, agent, tools,
// policy) lives in ./composition — shared with the service mode
// (./serve), so the one-shot CLI and the long-running server drive the
// SAME code path.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultContextDir,
  resolveAgentSource,
  resolveStdio,
  type SingleSourceMainOptions,
} from "@intx/example-agent-common";

import {
  AnchoringFailedError,
  buildRunPrompt,
  EXAMPLE_NAME,
  openrouterSource,
  runAnchoredSession,
  summarizeReceipt,
  type SessionOutcome,
} from "./composition";

export type MainOptions = SingleSourceMainOptions;

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  opts: MainOptions = {},
): Promise<number> {
  const { stdout, stderr } = resolveStdio(opts);

  // The default one-shot run is the recovery referral WITHOUT a pack
  // URL — the refusal path: the specialist must decline, and the
  // refusal itself is anchored. Pass a prompt (see ./job's
  // buildRunPrompt) or use service mode to hand it a pack to verify.
  const prompt = argv.join(" ").trim() || buildRunPrompt();

  // Test seam first, then OpenRouter, then the ANTHROPIC_API_KEY path
  // the sibling examples use.
  const source =
    opts.sourceOverride ??
    openrouterSource(env) ??
    resolveAgentSource(opts, env, EXAMPLE_NAME, stderr);
  if (source === null) {
    stderr(
      "(or: export OPENROUTER_API_KEY=sk-or-... to run via OpenRouter instead)\n",
    );
    return 1;
  }

  const contextDir = opts.contextDir ?? defaultContextDir(EXAMPLE_NAME);

  let outcome: SessionOutcome;
  try {
    outcome = await runAnchoredSession({
      prompt,
      source,
      env,
      contextDir,
      onReply: (reply) => stdout(`> ${prompt}\nassistant: ${reply}\n\n`),
      ...(opts.deps !== undefined ? { deps: opts.deps } : {}),
    });
  } catch (err) {
    if (err instanceof AnchoringFailedError) {
      stderr(`\nanchoring failed: ${err.message}\n`);
      stderr(
        `the signed git audit trail is intact in ${contextDir} (git log there\n` +
          "shows every record, blocked calls included). Set SANNING_API_KEY to anchor\n" +
          "through the Sanning control plane and get inclusion proofs.\n",
      );
      return 0;
    }
    throw err;
  }

  const { receipts, anchorer } = outcome;
  if (receipts.length === 0) {
    stdout("no audit records were produced (the model made no tool calls)\n");
    return 0;
  }

  stdout(
    `anchored audit trail (${String(receipts.length)} record(s), one checkpoint write):\n`,
  );
  for (const r of receipts) {
    const record = summarizeReceipt(r);
    if (record === null) continue;
    const marker = record.blocked ? "  <- the denial, provable" : "";
    stdout(
      `  ${record.eventType.padEnd(26)} ${(record.tool ?? "-").padEnd(20)} seq ${String(record.seq)}${marker}\n`,
    );
  }
  const checkpoint = receipts[0];
  if (checkpoint !== undefined) {
    stdout(`checkpoint: ${checkpoint.checkpointTxId}\n`);
    stdout(`  ${checkpoint.gatewayUrl}\n`);
  }

  // One signed, portable file: the records, their envelopes, the
  // checkpoint, every inclusion proof — AND the raw records themselves,
  // auto-disclosed in-body from the anchorer's logStore. The SDK asserts
  // each disclosed byte-string against the committed content_hash before
  // signing, so a wrong copy throws here instead of shipping. Auditors
  // verify not just THAT something happened but WHAT happened.
  // (Delete `disclose` for the hash-only privacy mode.)
  const bundle = await anchorer.bundle(receipts, { disclose: true });
  const bundlePath = join(contextDir, "trace-bundle.json");
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  const disclosed = bundle.body.events.filter(
    (e) => e.content !== undefined,
  ).length;
  stdout(`\nportable evidence bundle: ${bundlePath}\n`);
  stdout(
    `  (${String(disclosed)}/${String(receipts.length)} records disclosed in-body, each bound to its committed hash)\n`,
  );
  stdout("verify it anywhere — no repo access, no agent, no write SDK:\n");
  stdout(`  npx @ar.io/proof verify ${bundlePath}\n`);
  return 0;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), process.env);
  if (code !== 0) process.exit(code);
}
