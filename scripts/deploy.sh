#!/usr/bin/env bash
# Build, copy to /opt/basis/releases/<ts>, switch the /opt/basis/www symlink atomically (Caddy serves it),
# keep the last 5 releases. Rollback: ln -sfn /opt/basis/releases/<older> /opt/basis/www.tmp && mv -T /opt/basis/www.tmp /opt/basis/www
set -euo pipefail
/root/basis/app/scripts/build.sh
ts=$(date -u +%Y%m%d-%H%M%S)
mkdir -p /opt/basis/releases
cp -a /root/basis/app/dist "/opt/basis/releases/$ts"
[ -f "/opt/basis/releases/$ts/index.html" ] || { echo "no index.html in the build"; exit 1; }
ln -sfn "/opt/basis/releases/$ts" /opt/basis/www.tmp
mv -T /opt/basis/www.tmp /opt/basis/www
ls -dt /opt/basis/releases/* | tail -n +6 | xargs -r rm -rf
echo "release $ts"
curl -s -o /dev/null -w "https://basis.ergoscan.me/ %{http_code}\n" --max-time 20 https://basis.ergoscan.me/
