#!/bin/sh
# Restore the agent's persisted identity from env on first boot.
# The identity key is unrecoverable if lost (producer rotation is terminal),
# so the volume is seeded from SANNING_IDENTITY_B64 / SANNING_WALLET_B64
# when empty — mirroring the Workbench's MERIDIAN_KEYS_B64 pattern.
# Existing files always win: env never overwrites a live volume.
set -e
DIR="${SANNING_CONTEXT_DIR:-/data}"
mkdir -p "$DIR"
if [ ! -f "$DIR/identity.json" ] && [ -n "$SANNING_IDENTITY_B64" ]; then
  printf '%s' "$SANNING_IDENTITY_B64" | base64 -d > "$DIR/identity.json"
  echo "[entrypoint] identity.json restored from SANNING_IDENTITY_B64"
fi
if [ ! -f "$DIR/wallet.json" ] && [ -n "$SANNING_WALLET_B64" ]; then
  printf '%s' "$SANNING_WALLET_B64" | base64 -d > "$DIR/wallet.json"
  echo "[entrypoint] wallet.json restored from SANNING_WALLET_B64"
fi
exec bun --conditions=intx-src run examples/agent-anchored-audit/src/serve.ts
