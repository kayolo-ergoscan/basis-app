#!/bin/bash
# Type-check the whole app at low priority, one at a time (shares the build lock).
# Usage: scripts/check.sh            → tsc --noEmit on the project
#        scripts/check.sh test <dir> → vitest run <dir> (e.g. src/protocol)
set -euo pipefail
cd /root/basis/app
exec 9>/root/basis/.build.lock
flock -w 1200 9
export NODE_OPTIONS=--max-old-space-size=3072
if [ "${1:-}" = "test" ]; then shift; exec nice -n 15 ionice -c3 npx vitest run "$@"; fi
exec nice -n 15 ionice -c3 npx tsc -p tsconfig.json --noEmit
