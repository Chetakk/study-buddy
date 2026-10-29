# Study Buddy

A personal study tracker. Put YouTube playlists into groups (ML, Python, LeetCode, or whatever you study), watch them inside the app, and see exactly how much of each playlist and group is done.

## Run it

```sh
npm install
npm run build
npm start          # http://127.0.0.1:7314
```

`npm test` runs the tests (watch-time maths and the API against a throwaway database).

While developing, `npm run dev` runs the API (restarting on changes) and Vite with hot reload at http://localhost:5173.

### Install it as an app

Open http://127.0.0.1:7314 in Chrome or Edge and click **Install app** at the bottom of the sidebar (or the install icon in the address bar). Study Buddy then opens in its own window from your app launcher, with its own icon.

To keep the server running in the background and start it when you log in:

```sh
cp scripts/study-buddy.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now study-buddy
```

After pulling changes, run `npm run build` and `systemctl --user restart study-buddy`. The app icons are drawn by `scripts/make-icons.py`.

### Import many playlists at once (Chrome extension)

The extension in `extension/` reads every playlist on a YouTube page and imports the ones you tick, one after another, into the group you pick.

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
2. On YouTube, open your saved playlists (You → Playlists, or youtube.com/feed/playlists), a channel's Playlists tab, or a search filtered to playlists.
3. Click the Study Buddy icon. Use **Find more** to scroll the page so YouTube loads everything, tick what you want, choose a group (or type a new one) and click **Import**. You can close the popup while it runs.

Playlists already in Study Buddy are marked and skipped. Private playlists can't be imported, because the server reads YouTube without your login. The server only accepts the extension with the fixed ID from the `key` in `extension/manifest.json`, so keep that key if you edit the manifest.

Needs Node 22.13 or newer. It uses Node's built-in SQLite, so there are no native modules to build. No YouTube API key is needed.

Data is stored in `~/.local/share/study-buddy/study.db`. A snapshot is saved to `backups/` next to it once a day (the last 7 are kept), and **Library → Your data** exports or imports everything as one JSON file. Set `STUDY_BUDDY_DB` to use a different file, or `PORT` to change the port.

## What's in Phase 1

- **Groups.** You create, rename, recolour, reorder and delete groups. A group holds one or more playlists.
- **Playlist import.** Paste a playlist link and every video is imported with its duration, including playlists with more than 100 videos. The refresh button picks up new uploads.
- **Watch page.** An embedded player that records which seconds you actually played. Skipping ahead doesn't count. A video is marked done once 90% has been watched, or you can mark it by hand.
  - The strip under the player shows the watched parts. Click it to seek.
  - Notes are stamped with the video time (<kbd>N</kbd>). Focus mode (<kbd>F</kbd>) hides everything except the video.
  - <kbd>K</kbd> or <kbd>Space</kbd> plays and pauses, <kbd>J</kbd>/<kbd>L</kbd> jump 10 seconds, <kbd>&lt;</kbd>/<kbd>&gt;</kbd> change speed. The speed is remembered for each playlist.
  - It picks up where you left off, and plays the next video automatically.
- **Today.** The video to pick up (with the parts you've watched and what comes after it), today's study time, streak and overall progress, a Flashcards slot, and a tile for each group you've chosen with **Choose groups**. Tiles are in the order to do them: your order, except groups you've already studied today move down and finished ones go last. Click a tile to open its group. Hover a tile to rename it, change its colour, remove it from Today, delete it, or drag it to reorder.
- **Group pages.** Every group has its own page (click it in the sidebar or on Today). A video group shows its next five videos and its playlists, partly-watched first. A problem group like LeetCode shows the next problem, solved counts by difficulty, and every pattern in sheet order with the current one open, plus search and difficulty and status filters. **On Today** adds or removes the group from the Today page.
- **Playlist pages.** Reach a playlist from its group page, or from the Watch page (the Group › Playlist links under the title, or the bar above the playlist on the right).
- **Problem sheets.** Paste a public Google Sheet of coding problems (in Library, same box as playlists) and each pattern becomes a list in the group: problems with difficulty, sub-topic, the problem link and any explanation videos. Tick problems off as you solve them; a solved problem counts toward your streak. The refresh button re-reads the sheet for new problems and keeps your ticks.
- **Sidebar.** Your groups with their progress, your streak and the theme toggle. Press <kbd>[</kbd> to collapse it to icons, and <kbd>Ctrl</kbd>+<kbd>K</kbd> to search every group, playlist and video. On a phone it becomes a bottom tab bar.
- **Notes.** Every note in one place, grouped by video and searchable. Click a time to open the video at that moment. Notes support **bold**, *italic*, `code`, links and `- ` lists, and <kbd>Ctrl</kbd>+<kbd>K</kbd> finds them too.
- **Progress.** Overall numbers, a year-long study heatmap, the last 7 days by group (as a chart or a table), and per-playlist breakdowns.

## Layout

```
server/      Node API: index.ts (routes), db.ts (schema), youtube.ts (playlist import), backup.ts
shared/      Code used by both server and UI (watch-time maths)
test/        node:test tests
src/         React UI: pages/, components/, lib/
```

## Next phases

2. Flashcards: cards linked to timestamps, review with FSRS spaced repetition, piles (New / Learning / Review / Mastered / Struggling)
3. AI-drafted cards from transcripts (free model: Gemini free tier or Ollama), approved in a "Pending review" inbox
4. Daily planner with a time budget per group, and carry-over of unfinished items
5. Articles (LeetCode problem sheets are done)
6. Chrome extension: done for bulk playlist import (see above); tracking while you watch on youtube.com is still to do
