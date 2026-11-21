#!/usr/bin/env bash
# Build the Basis app under one lock, at low CPU/IO priority and with a capped Node heap, so the
# ErgoScan services on this machine never feel it. One build at a time (agents share this script).
set -euo pipefail
cd /root/basis/app
exec 9>/root/basis/.build.lock
flock -w 1200 9
export NODE_OPTIONS=--max-old-space-size=3072
nice -n 15 ionice -c3 npx tsc -p tsconfig.json
nice -n 15 ionice -c3 npx vite build
