#!/bin/sh
# Opens the Study Buddy window, starting Study Buddy with `biztel run` first if it isn't running.
# The window opens straight away; the page reloads itself once the server answers (src/lib/remote.ts).
# Extra arguments go to Chrome, e.g. --app-launch-url-for-shortcuts-menu-item=http://127.0.0.1:7314/#/library
DIR=$(cd "$(dirname "$0")/.." && pwd)
APP_ID=${STUDY_BUDDY_APP_ID:-mfemhkgammpchekfkcindllglgdddajg}
LOG=${XDG_STATE_HOME:-$HOME/.local/state}/study-buddy/run.log

if ! curl -fs -o /dev/null --max-time 1 "http://127.0.0.1:${PORT:-7314}/api/sidebar"; then
  mkdir -p "$(dirname "$LOG")"
  # Build only if something the app is built from changed since the last build, then run the built app
  # (~/.config/biztel/run.json, see the README). biztel refuses to start a second copy, so opening twice is harmless.
  cd "$DIR" && setsid sh -c '
    if [ ! -f dist/index.html ] ||
      [ -n "$(find src shared public index.html vite.config.ts tsconfig.json package-lock.json -newer dist/index.html -print -quit)" ]; then
      biztel compile || exit 1
    fi
    exec biztel start
  ' >"$LOG" 2>&1 </dev/null &
fi

exec google-chrome --profile-directory=Default --app-id="$APP_ID" "$@"
