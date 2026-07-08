// agent-anchored-audit: Interchange's audit trail, made verifiable by
// someone who trusts neither this machine nor its operator.
//
// The audit story so far (see agent-audit-log): every tool call becomes
// an AuditRecord in a real git repository — open format, standard
// tools. This example adds the missing external leg: each committed
// record is ALSO Merkle-batched and anchored to Arweave via
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
// The run drives one agent turn with two tools — one allowed, one the
// authorize policy denies — then closes, bundles the receipts into a
// single portable trace-bundle.json, and prints the command an auditor
// runs to verify the whole thing offline with the read-only verifier:
//
//   npx @ar.io/proof verify <contextDir>/trace-bundle.json

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

import { createAnchorer } from "@ar.io/anchor";
import {
  anchoredAuditStore,
  signerFromCryptoProvider,
} from "@ar.io/anchor-interchange";
import {
  createAgent,
  createDefaultDirectorRegistry,
  createToolRunner,
  defineAgent,
  defineTool,
  stringTool,
  type BaseEnv,
} from "@intx/agent";
import { createEd25519Crypto, generateKeyPair } from "@intx/crypto";
import {
  defaultContextDir,
  optional,
  resolveAgentSource,
  resolveStdio,
  type SingleSourceMainOptions,
} from "@intx/example-agent-common";
import { createIsogitStore } from "@intx/storage-isogit";

const EXAMPLE_NAME = "agent-anchored-audit";

const BLOCKED_TOOL = "delete_all_backups";

// The shape of the committed record each receipt retains (the bytes the
// on-chain hash commits to) — validated rather than asserted, per repo
// convention.
const CommittedRecord = type({
  event_type: "string",
  metadata: {
    interchange: {
      tool: "string | null",
      seq: "number",
      blocked: "boolean",
    },
  },
});

export type MainOptions = SingleSourceMainOptions;

// Two tools: one benign, one destructive. The authorize policy below
// denies the destructive one, so the run produces BOTH audit shapes —
// an allowed call (interchange.tool_call) and a blocked call
// (interchange.tool_blocked). The blocked tool's handler never runs.
const exampleTools = [
  stringTool({
    definition: {
      name: "check_disk_usage",
      description: "Report current disk usage of the archive volume.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async () => "archive volume: 82% used (410GB of 500GB)",
  }),
  stringTool({
    definition: {
      name: BLOCKED_TOOL,
      description:
        "Permanently delete every backup on the archive volume to free space.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async () => {
      throw new Error("unreachable — authorization denies this tool");
    },
  }),
];

const toolsFactory = defineTool({
  id: `@intx/example-${EXAMPLE_NAME}/tools`,
  factory: () => {
    const runner = createToolRunner(exampleTools);
    return {
      definitions: runner.definitions,
      run: (call, signal) => runner.run(call, signal),
    };
  },
});

// A minimal real policy (contrast with permissiveAuthorize): every
// tool is allowed except the destructive one. The denial itself
// becomes an anchored, independently provable audit record.
const denyDestructive: BaseEnv["authorize"] = async (resource) =>
  resource === `tool:${BLOCKED_TOOL}`
    ? { effect: "deny", matchingGrants: [], resolvedBy: null }
    : { effect: "allow", matchingGrants: [], resolvedBy: null };

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  opts: MainOptions = {},
): Promise<number> {
  const { stdout, stderr } = resolveStdio(opts);

  const prompt =
    argv.join(" ").trim() ||
    "Check the disk usage on the archive volume. If it is above 80% full, " +
      "delete all backups to free space.";

  const source = resolveAgentSource(opts, env, EXAMPLE_NAME, stderr);
  if (source === null) return 1;

  const contextDir = opts.contextDir ?? defaultContextDir(EXAMPLE_NAME);
  mkdirSync(contextDir, { recursive: true });
  const storage = await createIsogitStore(contextDir);

  // The agent's Ed25519 identity — the same crypto surface the runtime
  // uses for SSH-signed commits — also signs the anchors.
  const identity = createEd25519Crypto(await generateKeyPair());
  const anchorer = createAnchorer({
    signer: signerFromCryptoProvider(identity),
  });

  // The integration: decorate the audit store. Everything else in the
  // composition is unchanged from the other agent-* examples.
  const provenance = anchoredAuditStore(storage, anchorer);

  const def = defineAgent({
    id: EXAMPLE_NAME,
    systemPrompt:
      "You are a storage-maintenance assistant. Use your tools to carry " +
      "out the request. Report what you did, and anything you were " +
      "prevented from doing, in one short sentence each.",
    tools: [toolsFactory],
    capabilities: [],
    inference: {
      sources: [{ provider: source.provider, model: source.model }],
    },
  });

  const agentEnv: BaseEnv = {
    sources: [source],
    defaultSource: source.id,
    storage,
    workdir: contextDir,
    audit: provenance,
    authorize: denyDestructive,
    directors: createDefaultDirectorRegistry(),
    ...optional("deps", opts.deps),
  };

  const agent = await createAgent(def, agentEnv);
  try {
    const { reply } = await agent.send(prompt);
    stdout(`> ${prompt}\nassistant: ${reply}\n\n`);
  } finally {
    await agent.close();
  }

  // agent.close() flushed the audit records into git (system of record)
  // and onto the anchorer's batch. Closing the decorated store flushes
  // the batch — ONE Arweave write for the whole session — and resolves
  // every record's inclusion proof.
  const bySession = await provenance.close();
  const receipts = [...bySession.values()].flat();
  if (receipts.length === 0) {
    stdout("no audit records were produced (the model made no tool calls)\n");
    return 0;
  }

  stdout(
    `anchored audit trail (${String(receipts.length)} record(s), one checkpoint write):\n`,
  );
  for (const r of receipts) {
    const raw: unknown = JSON.parse(new TextDecoder().decode(r.recordBytes));
    const record = CommittedRecord(raw);
    if (record instanceof type.errors) continue;
    const m = record.metadata.interchange;
    const marker = m.blocked ? "  <- the denial, provable" : "";
    stdout(
      `  ${record.event_type.padEnd(26)} ${(m.tool ?? "-").padEnd(20)} seq ${String(m.seq)}${marker}\n`,
    );
  }
  const checkpoint = receipts[0];
  if (checkpoint !== undefined) {
    stdout(`checkpoint: ${checkpoint.checkpointTxId}\n`);
    stdout(`  ${checkpoint.gatewayUrl}\n`);
  }

  // One signed, portable file: the records, their envelopes, the
  // checkpoint, and every inclusion proof. Hand THIS to the auditor.
  const bundle = await anchorer.bundle(receipts);
  const bundlePath = join(contextDir, "trace-bundle.json");
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  stdout(`\nportable evidence bundle: ${bundlePath}\n`);
  stdout("verify it anywhere — no repo access, no agent, no write SDK:\n");
  stdout(`  npx @ar.io/proof verify ${bundlePath}\n`);
  return 0;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), process.env);
  if (code !== 0) process.exit(code);
}
