import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, parseArticle } from '../server/articles.ts';

test('reading time counts article words, not page furniture', () => {
  const words = Array.from({ length: 460 }, (_, i) => `word${i}`).join(' ');
  const html = `<html><head><title>Ignored &amp; plain</title><meta property="og:title" content="Attention &amp; Transformers"></head>
    <body><nav>${'menu '.repeat(500)}</nav><script>var x = "${'code '.repeat(500)}"</script>
    <article><h1>Attention</h1><p>${words}</p></article><footer>${'footer '.repeat(300)}</footer></body></html>`;
  const a = parseArticle(html, 'https://example.com/a');
  assert.equal(a.title, 'Attention & Transformers');
  assert.equal(a.words, 461);
  assert.equal(a.readingS, 120);
});

test('short pages still take a minute, and fall back to the host for a title', () => {
  const a = parseArticle('<p>hi</p>', 'https://blog.example.org/x');
  assert.equal(a.title, 'blog.example.org');
  assert.equal(a.readingS, 60);
});

test('normalizeUrl drops tracking and fragments', () => {
  assert.equal(normalizeUrl('https://a.com/p?utm_source=x&id=2#top'), 'https://a.com/p?id=2');
  assert.equal(normalizeUrl('ftp://a.com'), null);
  assert.equal(normalizeUrl('nope'), null);
});
