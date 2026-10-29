import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutChanged, parseDuration, parsePlaylistId, parsePlaylistPage } from '../server/youtube.ts';

const page = (data: unknown) =>
  `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>"INNERTUBE_API_KEY":"k","INNERTUBE_CLIENT_VERSION":"2.0"</script>`;

const lockup = (id: string, title: string, badge: string) => ({
  lockupViewModel: {
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentId: id,
    contentImage: { thumbnailBadgeViewModel: { text: badge } },
    metadata: { lockupMetadataViewModel: { title: { content: title } } },
  },
});

test('parses the current lockup layout and the older renderer layout', () => {
  const p = parsePlaylistPage(
    page({
      metadata: { playlistMetadataRenderer: { title: 'Course' } },
      header: { avatarStackViewModel: { text: { content: 'by Someone' } } },
      contents: [
        lockup('aaaaaaaaaaa', 'Intro', '1:02:03'),
        { playlistVideoRenderer: { videoId: 'bbbbbbbbbbb', title: { runs: [{ text: 'Old' }] }, lengthSeconds: '61' } },
        { continuationCommand: { token: 'next' } },
      ],
    }),
  );
  assert.equal(p.title, 'Course');
  assert.equal(p.channel, 'Someone');
  assert.deepEqual(
    p.videos.map((v) => [v.videoId, v.title, v.durationS]),
    [
      ['aaaaaaaaaaa', 'Intro', 3723],
      ['bbbbbbbbbbb', 'Old', 61],
    ],
  );
  assert.equal(p.token, 'next');
  assert.equal(p.apiKey, 'k');
});

test('reports a layout change instead of importing nothing', () => {
  assert.throws(() => parsePlaylistPage('<html>nothing here</html>'), LayoutChanged);
  assert.throws(
    () => parsePlaylistPage(page({ metadata: { playlistMetadataRenderer: { title: 'X' } }, contents: [{ somethingNew: {} }] })),
    LayoutChanged,
  );
});

test('private or missing playlists get a plain message', () => {
  assert.throws(() => parsePlaylistPage(page({ alerts: [{}] })), /not found or private/);
});

test('parsePlaylistId and parseDuration', () => {
  assert.equal(parsePlaylistId('https://www.youtube.com/watch?v=x&list=PLabcdefghijkl'), 'PLabcdefghijkl');
  assert.equal(parsePlaylistId('PLabcdefghijkl'), 'PLabcdefghijkl');
  assert.equal(parsePlaylistId('not a link'), null);
  assert.equal(parseDuration('4:05'), 245);
  assert.equal(parseDuration('LIVE'), 0);
});
