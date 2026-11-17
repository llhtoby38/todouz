#!/bin/sh
# Seed the mounted data volume from the repo snapshot on FIRST boot only.
# A marker file (not emptiness) decides, so an intentionally-emptied volume
# doesn't get silently re-seeded.
set -e

if [ ! -f /app/data/.seeded ] && [ -d /app/data-seed ]; then
  echo "todouz: seeding /app/data from repo snapshot…"
  cp -R /app/data-seed/. /app/data/
  # never carry a stale sqlite index into a fresh environment
  rm -f /app/data/state/index.db /app/data/state/index.db-shm /app/data/state/index.db-wal
  touch /app/data/.seeded
fi

exec "$@"
