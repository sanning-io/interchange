// The estate: the Workbench's file-backed session store. One directory
// per anchored stage run, files not a database, so the estate survives
// restarts and the desk's evidence requests resolve against durable
// state:
//
//   <dataDir>/sessions/<sessionDir>/meta.json       — the row below
//   <dataDir>/sessions/<sessionDir>/timeline.json   — the streamed steps
//   <dataDir>/sessions/<sessionDir>/pack/bundle.json — the sealed pack
//
// The HTTP shapes these files serve are the SAME open estate contract
// the claims-demo Workbench exposed (`/api/estate/sessions`,
// `/sessions/<dir>/…`) — which is exactly why the Halden desk needs no
// new protocol to resolve evidence against this estate.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { type } from "arktype";

import type { EvidenceBundle } from "@sanning/anchor";

/** One timeline entry — the claims-demo capture shape, kept verbatim. */
export interface TimelineEntry {
  eventId: string;
  seq: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

const SessionMeta = type({
  sessionDir: "string",
  stageId: "string",
  category: "string",
  caseRef: "string",
  recordedAt: "string",
  agentName: "string",
  displayName: "string",
  environment: "string",
  decision: "string",
  blocked: "boolean",
  records: "number",
  checkpointTxIds: "string[]",
  gatewayUrls: "string[]",
});
export type SessionMeta = typeof SessionMeta.infer;

export class Estate {
  private readonly sessionsDir: string;

  constructor(dataDir: string) {
    this.sessionsDir = join(dataDir, "sessions");
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  /** A new session directory name: `wb-<stage>-<stamp>` — sortable, and
   *  self-describing in the desk's resolution log. */
  newSessionDir(stageId: string): string {
    const stamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "Z");
    return `wb-${stageId}-${stamp}`;
  }

  write(
    meta: SessionMeta,
    timeline: readonly TimelineEntry[],
    bundle: EvidenceBundle | null,
  ): void {
    const dir = join(this.sessionsDir, meta.sessionDir);
    mkdirSync(join(dir, "pack"), { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    writeFileSync(
      join(dir, "timeline.json"),
      JSON.stringify(timeline, null, 2) + "\n",
    );
    if (bundle !== null) {
      writeFileSync(
        join(dir, "pack", "bundle.json"),
        JSON.stringify(bundle, null, 2) + "\n",
      );
    }
  }

  /** Every session's meta, newest first. Unreadable directories are
   *  skipped, not fatal — a half-written session must not take the
   *  estate listing down. */
  list(): SessionMeta[] {
    const rows: SessionMeta[] = [];
    for (const name of readdirSync(this.sessionsDir)) {
      const metaPath = join(this.sessionsDir, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const parsed = SessionMeta(JSON.parse(readFileSync(metaPath, "utf8")));
        if (!(parsed instanceof type.errors)) rows.push(parsed);
      } catch {
        continue;
      }
    }
    return rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  /** A stored file under one session, or null. Only the estate's own
   *  fixed layout is reachable — the session dir and file name are
   *  matched against the known shapes, never joined from raw input. */
  readFile(
    sessionDir: string,
    file: "meta.json" | "timeline.json" | "pack/bundle.json",
  ): string | null {
    if (!/^wb-[a-z]+-[0-9TZ-]+$/.test(sessionDir)) return null;
    const path = join(this.sessionsDir, sessionDir, file);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  }
}
