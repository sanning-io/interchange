// The shared composition for halden-claims-desk: identity, storage, and
// the one agent session the desk drives per demand. Deliberately
// SIMPLER than the Meridian-side example (agent-anchored-audit): Halden
// does not anchor. Its audit trail is Interchange's plain git audit
// store — a logbook whose commits are SSH-signed by the desk's own
// persisted Ed25519 identity — and the Sanning surface it touches is
// the free, open verification kernels alone. Only the producer pays;
// anyone can check. There is no SANNING_API_KEY anywhere in this
// example, on purpose.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

import {
  createAgent,
  createDefaultDirectorRegistry,
  createToolRunner,
  defineAgent,
  defineTool,
  type AgentTool,
  type BaseEnv,
} from "@intx/agent";
import { createEd25519Crypto, generateKeyPair } from "@intx/crypto";
import { optional, type CommonMainOptions } from "@intx/example-agent-common";
import { createIsogitStore } from "@intx/storage-isogit";
import type { AuditRecord, ErrorRecord } from "@intx/types/audit";
import type {
  AuditStore,
  CryptoProvider,
  InferenceSource,
  KeyPair,
} from "@intx/types/runtime";

import { deskAuthorize, SYSTEM_PROMPT } from "./job";

export const EXAMPLE_NAME = "halden-claims-desk";

/** The worker name, per the house convention. */
export const DESK_WORKER = "Halden-Indemnity.Inward-Claims";

// OpenRouter rides Interchange's OpenAI-compatible adapter: same wire
// format, different baseURL — identical to the sibling examples.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";

export function openrouterSource(
  env: NodeJS.ProcessEnv,
): InferenceSource | null {
  const apiKey = env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;
  const model = env["OPENROUTER_MODEL"] ?? DEFAULT_OPENROUTER_MODEL;
  return {
    id: `openrouter:${model}`,
    provider: "openai",
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    model,
  };
}

// ---- persisted identity ---------------------------------------------------

const hexEncode = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function hexDecode(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const StoredIdentity = type({
  privateKey: /^[0-9a-f]{64}$/,
  publicKey: /^[0-9a-f]{64}$/,
});

async function loadOrCreateIdentity(path: string): Promise<KeyPair> {
  if (existsSync(path)) {
    const parsed = StoredIdentity(JSON.parse(readFileSync(path, "utf8")));
    if (parsed instanceof type.errors) {
      throw new Error(`${path}: ${parsed.summary}`);
    }
    return {
      privateKey: hexDecode(parsed.privateKey),
      publicKey: hexDecode(parsed.publicKey),
    };
  }
  const pair = await generateKeyPair();
  writeFileSync(
    path,
    JSON.stringify(
      {
        privateKey: hexEncode(pair.privateKey),
        publicKey: hexEncode(pair.publicKey),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return pair;
}

/**
 * The desk's persisted identity: ONE Ed25519 key whose signSSH half
 * signs every commit in the git logbook. The seed lives in
 * `<contextDir>/identity.json`, created on the first case and reused
 * after — every case is signed by the SAME desk.
 */
export async function createDeskIdentity(
  contextDir: string,
): Promise<CryptoProvider> {
  mkdirSync(contextDir, { recursive: true });
  return createEd25519Crypto(
    await loadOrCreateIdentity(join(contextDir, "identity.json")),
  );
}

// ---- the observed audit store ---------------------------------------------

/**
 * Decorate the plain git AuditStore so the desk surface can watch
 * records as they are committed — the same seam the anchored sibling's
 * adapter uses, minus the anchoring. Git stays the system of record:
 * delegate FIRST, and only observe what was actually persisted. The
 * observer is purely observational; its failures never reach the store.
 */
export function observedAuditStore(
  inner: AuditStore,
  onRecord: (record: AuditRecord) => void,
  onError?: (record: ErrorRecord) => void,
): AuditStore {
  const watch = (fn: (() => void) | undefined): void => {
    try {
      fn?.();
    } catch {
      // A watching surface must never affect what is committed.
    }
  };
  return {
    async commitAudit(records, signal) {
      await inner.commitAudit(records, signal);
      for (const record of records) watch(() => onRecord(record));
    },
    async loadAudit(sessionId, signal) {
      return inner.loadAudit(sessionId, signal);
    },
    async commitErrors(records, signal) {
      await inner.commitErrors(records, signal);
      if (onError !== undefined) {
        for (const record of records) watch(() => onError(record));
      }
    },
  };
}

// ---- one desk session -----------------------------------------------------

export interface RunDeskSessionParams {
  prompt: string;
  tools: AgentTool[];
  source: InferenceSource;
  /** The conversation + logbook for THIS case. One file, one fresh
   *  examination: an @intx/agent contextDir resumes its previous
   *  conversation (that is the runtime's resume feature), so distinct
   *  demands get distinct dirs — a prior case's letter must never leak
   *  into the next case's reasoning. */
  contextDir: string;
  /** Where the desk's ONE persisted identity lives (defaults to
   *  `contextDir`). Every case's logbook is signed by the same key. */
  identityDir?: string;
  /** Called for every audit record as it lands in the signed logbook —
   *  allowed and blocked alike. */
  onAuditRecord?: (record: AuditRecord) => void;
  /** Called with the agent's final message as soon as the turn completes. */
  onReply?: (reply: string) => void;
  /** Inject inference deps (harness-driven tests). */
  deps?: CommonMainOptions["deps"];
}

/**
 * Drive ONE inward-claims session: persisted identity, SSH-signed git
 * logbook (`createIsogitStore`'s signer parameter — the plain audit
 * store, observed but not anchored), one agent turn, close. The close
 * flushes the audit records into git; there is no anchoring flush,
 * because Halden is not a producer — it only verifies.
 */
export async function runDeskSession(
  params: RunDeskSessionParams,
): Promise<{ reply: string }> {
  const { prompt, source, contextDir } = params;
  mkdirSync(contextDir, { recursive: true });

  const identity = await createDeskIdentity(params.identityDir ?? contextDir);
  const storage = await createIsogitStore(contextDir, (payload) =>
    identity.signSSH(payload),
  );

  const audit =
    params.onAuditRecord !== undefined
      ? observedAuditStore(storage, params.onAuditRecord)
      : storage;

  const toolsFactory = defineTool({
    id: `@intx/example-${EXAMPLE_NAME}/tools`,
    definitions: params.tools.map((t) => ({ name: t.definition.name })),
    factory: () => {
      const runner = createToolRunner(params.tools);
      return {
        definitions: runner.definitions,
        run: (call, signal) => runner.run(call, signal),
      };
    },
  });

  const def = defineAgent({
    id: EXAMPLE_NAME,
    systemPrompt: SYSTEM_PROMPT,
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
    audit,
    authorize: deskAuthorize,
    directors: createDefaultDirectorRegistry(),
    ...optional("deps", params.deps),
  };

  const agent = await createAgent(def, agentEnv);
  try {
    const result = await agent.send(prompt);
    if (result.type !== "reply") {
      throw new Error(
        `agent send suspended on correlationId ${result.correlationId}; this example drives a single prompt and has no resume path`,
      );
    }
    params.onReply?.(result.reply);
    return { reply: result.reply };
  } finally {
    await agent.close();
  }
}
