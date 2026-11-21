#!/bin/bash
# One shared Vite dev server for every agent: http://127.0.0.1:5180 (HMR, /v1 → :4401).
# Idempotent: if it already answers, do nothing. Never start a second one; never bind 0.0.0.0.
set -u
cd /root/basis/app
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:5180/; then echo "dev server already up: http://127.0.0.1:5180"; exit 0; fi
exec 8>/root/basis/.dev.lock
if ! flock -n 8; then echo "another dev.sh is starting it; wait 10 s and curl again"; exit 0; fi
NODE_OPTIONS=--max-old-space-size=2048 nohup nice -n 10 npx vite --host 127.0.0.1 --port 5180 --strictPort > /root/basis/qa/dev-server.log 2>&1 &
echo $! > /root/basis/qa/dev-server.pid
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 http://127.0.0.1:5180/ && { echo "dev server up: http://127.0.0.1:5180 (pid $(cat /root/basis/qa/dev-server.pid))"; exit 0; }; sleep 0.5; done
echo "dev server did not answer; see /root/basis/qa/dev-server.log"; exit 1
