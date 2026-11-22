#!/usr/bin/env bash
# Build, copy to /opt/basis/releases/<ts>, switch the /opt/basis/www symlink atomically (Caddy serves it),
# keep the last 5 releases. Old hashed assets are carried over (no overwrite) so tabs opened on the previous
# release can still lazy-load their chunks after the switch.
# Rollback: ln -sfn /opt/basis/releases/<older> /opt/basis/www.tmp && mv -T /opt/basis/www.tmp /opt/basis/www
set -euo pipefail
[ "${SKIP_BUILD:-0}" = 1 ] || /root/basis/app/scripts/build.sh
ts=$(date -u +%Y%m%d-%H%M%S)
mkdir -p /opt/basis/releases
cp -a /root/basis/app/dist "/opt/basis/releases/$ts"
[ -f "/opt/basis/releases/$ts/index.html" ] || { echo "no index.html in the build"; exit 1; }
prev=$(readlink -f /opt/basis/www || true)
if [ -n "$prev" ] && [ -d "$prev/assets" ]; then cp -an "$prev/assets/." "/opt/basis/releases/$ts/assets/" 2>/dev/null || true; fi
chmod -R a+rX "/opt/basis/releases/$ts"
ln -sfn "/opt/basis/releases/$ts" /opt/basis/www.tmp
mv -T /opt/basis/www.tmp /opt/basis/www
ls -dt /opt/basis/releases/*/ | grep -v placeholder | tail -n +6 | xargs -r rm -rf
echo "release $ts (previous: ${prev:-none})"
curl -s -o /dev/null -w "https://basis.ergoscan.me/ %{http_code}\n" --max-time 20 https://basis.ergoscan.me/
