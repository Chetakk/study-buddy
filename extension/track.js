// Runs on youtube.com/watch pages. Records which seconds of the video you actually play (skipping ads and seeks)
// and sends them to Study Buddy through the background worker every few seconds. Videos that aren't in
// Study Buddy are ignored by the server.
(() => {
  const FLUSH_EVERY_S = 10;
  let videoId = null;
  let listId = '';
  let pending = [];
  let playedS = 0;
  let lastT = null;
  let lastWall = 0;
  let sinceFlush = 0;

  // Same rule as shared/segments.ts isPlayback: a forward step no bigger than real time × speed is playback.
  const isPlayback = (dt, elapsedS, rate) => dt > 0 && dt <= elapsedS * rate + 1.5;

  const current = () => {
    const u = new URL(location.href);
    return u.pathname === '/watch' ? { v: u.searchParams.get('v'), list: u.searchParams.get('list') ?? '' } : null;
  };

  function flush(video) {
    if (!videoId || (!pending.length && playedS < 1)) return;
    const body = {
      videoId,
      listId,
      segments: pending,
      positionS: video?.currentTime ?? 0,
      durationS: video && Number.isFinite(video.duration) ? video.duration : 0,
      playedS: Math.floor(playedS),
    };
    pending = [];
    playedS -= body.playedS;
    sinceFlush = 0;
    try {
      chrome.runtime.sendMessage({ type: 'track', body });
    } catch {
      // The extension was reloaded; this page's script is orphaned until the tab reloads.
    }
  }

  setInterval(() => {
    const video = document.querySelector('#movie_player video, video.html5-main-video');
    const here = current();
    if (here?.v !== videoId) {
      flush(video);
      videoId = here?.v ?? null;
      listId = here?.list ?? '';
      lastT = null;
    }
    if (!videoId || !video) return;
    const ad = document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
    if (video.paused || video.ended || ad) {
      lastT = null;
      if (sinceFlush > 0 && (video.paused || video.ended)) flush(video);
      return;
    }
    const t = video.currentTime;
    const wall = performance.now();
    if (lastT !== null) {
      const elapsed = (wall - lastWall) / 1000;
      if (isPlayback(t - lastT, elapsed, video.playbackRate)) pending.push([lastT, t]);
      playedS += Math.min(elapsed, 5);
    }
    lastT = t;
    lastWall = wall;
    if (++sinceFlush >= FLUSH_EVERY_S) flush(video);
  }, 1000);

  addEventListener('pagehide', () => flush(document.querySelector('video')));
})();
