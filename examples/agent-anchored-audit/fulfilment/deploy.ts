// Deploy the Sanning evidence-fulfilment workflow onto a local
// Interchange hub — entirely through the hub's public REST + git
// surfaces (the same ones an operator's own tooling would use; no
// Interchange source is touched, no internal APIs called).
//
// What it does, in order:
//
//   1. Signs in as the dev-seed admin (alice@example.com).
//   2. Packs ./tool/ into an npm-style tarball and PUTs it into the
//      tenant's `workspace-builtins` package-registry asset — the
//      registry the stock hub's `@intx` scope routing resolves pins
//      against. (Routing scopes to registries is hub CONFIG, not
//      customer code; riding the preconfigured scope is what keeps this
//      loop config-free. A production hub would add its own scope
//      route or registry for customer packages.)
//   3. Creates a workflow asset, pushes ./workflow.json to it over the
//      asset smart-HTTP git route (trigger address rewritten to the
//      tenant's real mail domain).
//   4. Deploys it: POST /workflows/instances with the tool-package pin
//      and an OpenRouter inference source whose API key is read at
//      RUNTIME from ../.env (never committed anywhere).
//
// It writes the deployment coordinates to
// `<repo>/tmp/sanning-fulfilment-deploy.json` for ./bridge-stub.ts.
//
// Run from the repo root:
//
//   bun examples/agent-anchored-audit/fulfilment/deploy.ts

import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BASE = process.env["HUB_URL"] ?? "http://localhost:3000";
const EMAIL = process.env["HUB_ADMIN_EMAIL"] ?? "alice@example.com";
const PASSWORD = process.env["HUB_ADMIN_PASSWORD"] ?? "password123";
const TENANT_SLUG = process.env["HUB_TENANT_SLUG"] ?? "acme";

const REGISTRY_ASSET = "workspace-builtins";
const PKG_NAME = "@intx/sanning-fulfilment";
const PKG_VERSION = "0.1.0";
const TARBALL_NAME = "@intx-sanning-fulfilment-0.1.0.tgz";
const MAIL_LOCAL_PART = "sanning-fulfilment";
const MODEL = "anthropic/claude-haiku-4.5";

function fail(msg: string, data?: unknown): never {
  console.error(`FAIL: ${msg}`);
  if (data !== undefined) console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

// -- tiny .env reader (the key never lands in a committed file) ------------
function readDotEnvKey(path: string, key: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m === null || m[1] !== key) continue;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

// -- cookie-jar HTTP -------------------------------------------------------
let cookies: string[] = [];
async function api(
  method: string,
  path: string,
  body?: unknown,
  contentType = "application/json",
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = contentType;
  if (cookies.length > 0) headers["Cookie"] = cookies.join("; ");
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body =
      contentType === "application/json"
        ? JSON.stringify(body)
        : (body as BodyInit);
  }
  const res = await fetch(`${BASE}${path}`, init);
  for (const sc of res.headers.getSetCookie()) {
    const pair = sc.split(";")[0]!;
    const name = pair.split("=")[0]!;
    cookies = cookies.filter((c) => !c.startsWith(`${name}=`));
    cookies.push(pair);
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, data };
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; status: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Uint8Array) => {
      stdout += new TextDecoder().decode(c);
    });
    child.stderr.on("data", (c: Uint8Array) => {
      stderr += new TextDecoder().decode(c);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout, stderr, status: code ?? -1 }),
    );
  });
}

// -- 0. The OpenRouter key, read at runtime from the example's .env --------
const openrouterKey =
  process.env["OPENROUTER_API_KEY"] ??
  readDotEnvKey(join(HERE, "..", ".env"), "OPENROUTER_API_KEY");
if (openrouterKey === null || openrouterKey === "") {
  fail(
    "OPENROUTER_API_KEY not found (env or examples/agent-anchored-audit/.env)",
  );
}

// -- 1. Sign in ------------------------------------------------------------
const signIn = await api("POST", "/api/auth/sign-in/email", {
  email: EMAIL,
  password: PASSWORD,
});
if (signIn.status !== 200) fail("sign-in", signIn);
console.log(`OK sign-in as ${EMAIL}`);

// -- 2. Resolve the tenant -------------------------------------------------
const prinRes = await api("GET", "/api/me/principals?limit=50");
if (prinRes.status !== 200) fail("list principals", prinRes);
const prinBody = prinRes.data as { data?: unknown[] } | unknown[];
const principals = (
  Array.isArray(prinBody) ? prinBody : (prinBody.data ?? [])
) as { tenantId?: string; tenantSlug?: string; tenantName?: string }[];
const prin = principals.find(
  (p) =>
    p.tenantSlug === TENANT_SLUG ||
    String(p.tenantName ?? "")
      .toLowerCase()
      .includes(TENANT_SLUG),
);
if (!prin?.tenantId) fail(`tenant ${TENANT_SLUG} not found`, principals);
const TENANT = prin.tenantId;
const tenantRes = await api("GET", `/api/tenants/${TENANT}`);
if (tenantRes.status !== 200) fail("get tenant", tenantRes);
const DOMAIN =
  (tenantRes.data as { domain?: string }).domain ?? "acme.localhost";
console.log(`OK tenant ${TENANT} (domain ${DOMAIN})`);

// -- 3. Pack ./tool and publish it into the package registry ---------------
const staging = mkdtempSync(join(tmpdir(), "sanning-fulfilment-pack-"));
try {
  const pkgDir = join(staging, "package");
  mkdirSync(pkgDir, { recursive: true });
  cpSync(join(HERE, "tool", "package.json"), join(pkgDir, "package.json"));
  cpSync(
    join(HERE, "tool", "sidecar-bundle.js"),
    join(pkgDir, "sidecar-bundle.js"),
  );
  const tarRes = await run("tar", ["-czf", "out.tgz", "package"], staging);
  if (tarRes.status !== 0) fail(`tar: ${tarRes.stderr}`);
  const tarballBytes = readFileSync(join(staging, "out.tgz"));

  const listRes = await api(
    "GET",
    `/api/tenants/${TENANT}/assets?kind=package-registry&inherited=false`,
  );
  if (listRes.status !== 200) fail("list package-registry assets", listRes);
  const registries = listRes.data as { id: string; name: string }[];
  let registry = registries.find((r) => r.name === REGISTRY_ASSET);
  if (registry === undefined) {
    const createRes = await api("POST", `/api/tenants/${TENANT}/assets`, {
      kind: "package-registry",
      name: REGISTRY_ASSET,
    });
    if (createRes.status !== 201) fail("create registry asset", createRes);
    registry = createRes.data as { id: string; name: string };
  }

  const putRes = await api(
    "PUT",
    `/api/tenants/${TENANT}/assets/${registry.id}/tarballs/${encodeURIComponent(TARBALL_NAME)}`,
    new Uint8Array(tarballBytes),
    "application/octet-stream",
  );
  if (putRes.status !== 200) fail("upload tool tarball", putRes);
  console.log(
    `OK published ${PKG_NAME}@${PKG_VERSION} -> asset ${registry.id} (${JSON.stringify(putRes.data)})`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// -- 4. Author the workflow asset ------------------------------------------
const definition = JSON.parse(
  readFileSync(join(HERE, "workflow.json"), "utf8"),
) as {
  triggers: { type: string; to: string }[];
};
const mailAddress = `${MAIL_LOCAL_PART}@${DOMAIN}`;
definition.triggers = definition.triggers.map((t) =>
  t.type === "mail" ? { ...t, to: mailAddress } : t,
);
const workflowJson = JSON.stringify(definition, null, 2);

const assetName = `sanning-fulfilment-${Date.now().toString(36)}`;
const assetRes = await api("POST", `/api/tenants/${TENANT}/assets`, {
  kind: "workflow",
  name: assetName,
});
if (assetRes.status !== 201) fail("create workflow asset", assetRes);
const assetId = (assetRes.data as { id: string }).id;
console.log(`OK workflow asset ${assetName} -> ${assetId}`);

const tokRes = await api("POST", `/api/tenants/${TENANT}/git-tokens`, {
  name: "sanning-fulfilment-push",
  resource: "asset:*",
  refPattern: "**",
  actions: ["can_read", "can_push"],
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
});
if (tokRes.status !== 201) fail("mint git token", tokRes);
const tokenSecret = (tokRes.data as { secret: string }).secret;

const work = mkdtempSync(join(tmpdir(), "sanning-fulfilment-wf-"));
try {
  const repoDir = join(work, "repo");
  const askpass = join(work, "askpass.sh");
  writeFileSync(askpass, `#!/bin/sh\nprintf '%s\\n' '${tokenSecret}'\n`);
  chmodSync(askpass, 0o755);
  const gitEnv = {
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Sanning Fulfilment",
    GIT_AUTHOR_EMAIL: "fulfilment@sanning.local",
    GIT_COMMITTER_NAME: "Sanning Fulfilment",
    GIT_COMMITTER_EMAIL: "fulfilment@sanning.local",
  };
  const remote = `${BASE}/api/tenants/${TENANT}/assets/workflow/${assetName}.git`;
  const authRemote = remote.replace(
    "http://",
    `http://x-access-token:${tokenSecret}@`,
  );
  const clone = await run(
    "git",
    ["-c", "credential.helper=", "clone", authRemote, repoDir],
    work,
    gitEnv,
  );
  if (clone.status !== 0) fail(`asset clone: ${clone.stderr}`);
  writeFileSync(join(repoDir, "workflow.json"), workflowJson);
  for (const g of [
    ["add", "workflow.json"],
    ["commit", "-m", "Sanning evidence-fulfilment workflow"],
    ["-c", "credential.helper=", "push", authRemote, "HEAD:main"],
  ]) {
    const r = await run("git", g, repoDir, gitEnv);
    if (r.status !== 0) fail(`git ${g[0]}: ${r.stderr || r.stdout}`);
  }
  console.log(`OK workflow.json pushed to ${remote}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// -- 5. Deploy with the tool-package pin -----------------------------------
const source = {
  id: `openai:${MODEL}`,
  provider: "openai",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openrouterKey,
  model: MODEL,
};
const deployRes = await api(
  "POST",
  `/api/tenants/${TENANT}/workflows/instances`,
  {
    assetId,
    sources: [source],
    defaultSource: source.id,
    toolPackages: [{ name: PKG_NAME, version: PKG_VERSION }],
  },
);
if (deployRes.status !== 201) fail("deploy workflow", deployRes);
const deploymentId = (deployRes.data as { id: string }).id;
console.log(`OK deployed: deploymentId=${deploymentId}`);

const coords = {
  base: BASE,
  tenantId: TENANT,
  deploymentId,
  mailAddress,
  assetId,
  deployedAt: new Date().toISOString(),
};
const coordsPath = join(REPO_ROOT, "tmp", "sanning-fulfilment-deploy.json");
mkdirSync(dirname(coordsPath), { recursive: true });
writeFileSync(coordsPath, JSON.stringify(coords, null, 2) + "\n");
console.log(`OK coordinates written to ${coordsPath}`);
console.log(JSON.stringify(coords, null, 2));
