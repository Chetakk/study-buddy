#!/bin/sh
# Builds the app only if something it is built from changed since the last build, then starts the server.
# `biztel run` runs this (~/.config/biztel/run.json); the server itself is never built, so changes to it need no build.
cd "$(dirname "$0")/.." || exit 1
if [ ! -f dist/index.html ] ||
  [ -n "$(find src shared public index.html vite.config.ts tsconfig.json package-lock.json -newer dist/index.html -print -quit)" ]; then
  npm run build || exit 1
fi
exec npm start
