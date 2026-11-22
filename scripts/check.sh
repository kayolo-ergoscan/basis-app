#!/bin/bash
# Type-check the whole app at low priority, one at a time (shares the build lock).
# Usage: scripts/check.sh            → tsc --noEmit on the project
#        scripts/check.sh test <dir> → vitest run <dir> (e.g. src/protocol)
set -euo pipefail
app=${BASIS_APP:-/root/basis/app}   # a worktree under /root/basis/app-wt/ also works (parallel agents)
case "$(realpath -m "$app")" in /root/basis/app|/root/basis/app-wt/*) ;; *) echo "BASIS_APP must be /root/basis/app or /root/basis/app-wt/<name>" >&2; exit 2 ;; esac
cd "$app"
exec 9>/root/basis/.build.lock
flock -w 1200 9
export NODE_OPTIONS=--max-old-space-size=3072
if [ "${1:-}" = "test" ]; then shift; exec nice -n 15 ionice -c3 npx vitest run "$@"; fi
exec nice -n 15 ionice -c3 npx tsc -p tsconfig.json --noEmit
