// Run with: node --test scripts/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, linksFor, groupMovies, moviePage, sitemap, trimDesc, hubPage, rssFeed, SECTIONS } from "../build-pages.mjs";

const config = {
  tickets: { enabled: true, label: "Get tickets", url: "https://tickets.example/?q={query}", showFromDaysBeforeRelease: 60, showUntilDaysAfterRelease: 75 },
  streaming: { Netflix: { label: "Watch on Netflix", url: "https://netflix.example/?q={query}" } },
  whereToWatch: { enabled: true, label: "Where to watch", url: "https://jw.example/?q={query}" },
};
const now = new Date("2026-11-27T12:00:00Z");

test("slugify makes clean URL slugs", () => {
  assert.equal(slugify("Avengers: Doomsday"), "avengers-doomsday");
  assert.equal(slugify("Amélie & Friends!"), "amelie-and-friends");
});

test("linksFor picks tickets, streaming or where-to-watch", () => {
  const soon = linksFor({ title: "Avengers: Doomsday | Final Trailer", channelTitle: "Marvel Entertainment", releaseDate: "2026-12-18" }, config, now);
  assert.deepEqual(soon.map((l) => l.label), ["Get tickets"]);
  assert.equal(soon[0].url, "https://tickets.example/?q=Avengers%3A%20Doomsday");
  const far = linksFor({ title: "Far Film | Teaser", channelTitle: "A24", releaseDate: "2027-09-01" }, config, now);
  assert.deepEqual(far, []);
  const out = linksFor({ title: "Paper Tiger - Trailer", channelTitle: "NEON", releaseDate: "2026-11-13" }, config, now);
  assert.deepEqual(out.map((l) => l.label), ["Get tickets", "Where to watch"]);
  const old = linksFor({ title: "Old One - Trailer", channelTitle: "NEON", releaseDate: "2026-01-01" }, config, now);
  assert.deepEqual(old.map((l) => l.label), ["Where to watch"]);
  const nf = linksFor({ title: "The Trust | Official Trailer | Netflix", channelTitle: "Netflix" }, config, now);
  assert.deepEqual(nf.map((l) => l.label), ["Watch on Netflix"]);
});

test("groupMovies joins trailers of one movie and builds a page with SEO tags", () => {
  const trailers = [
    { id: "a", title: "Avengers: Doomsday | Final Trailer", channelTitle: "Marvel Entertainment", publishedAt: "2026-11-23T14:00:00Z", views: 9, thumbnail: "https://i.ytimg.com/a.jpg", tmdbId: 1, movieTitle: "Avengers: Doomsday", summary: "Doom <arrives>.", releaseDate: "2026-12-18" },
    { id: "b", title: "Avengers: Doomsday | Official Trailer", channelTitle: "Marvel Entertainment", publishedAt: "2026-10-01T14:00:00Z", views: 5, thumbnail: "https://i.ytimg.com/b.jpg", tmdbId: 1, movieTitle: "Avengers: Doomsday" },
    { id: "c", title: "Paper Tiger - Final Trailer", channelTitle: "NEON", publishedAt: "2026-11-24T00:00:00Z", views: 1, thumbnail: "https://i.ytimg.com/c.jpg" },
  ];
  const movies = groupMovies(trailers);
  assert.deepEqual(movies.map((m) => [m.slug, m.trailers.length]), [["avengers-doomsday", 2], ["paper-tiger", 1]]);
  const m = movies[0]; m.config = config;
  const html = moviePage(m, { siteUrl: "https://site.example", now });
  assert.match(html, /<title>Avengers: Doomsday \(2026\) Trailer · Trailerfeed<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/site.example\/movies\/avengers-doomsday\/">/);
  assert.match(html, /og:image" content="https:\/\/i.ytimg.com\/a.jpg"/);
  assert.match(html, /Doom &lt;arrives&gt;\./);
  assert.match(html, /"@type":"Movie"/);
  assert.match(html, /youtube-nocookie.com\/embed\/a\?/);
  assert.match(html, /More Avengers: Doomsday trailers/);
  assert.match(html, /rel="sponsored noopener">Get tickets</);
  assert.match(html, /class="disclosure">We may earn a commission/);
  assert.match(html, /href="..\/..\/privacy\/">Privacy policy</);
  assert.match(html, /not endorsed or certified by TMDB/);
  assert.match(html, /<script src="..\/..\/analytics.js" defer>/);
  const xml = sitemap(movies, "https://site.example", "2026-11-27T00:00:00Z");
  assert.match(xml, /<loc>https:\/\/site.example\/privacy\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/site.example\/movies\/paper-tiger\/<\/loc><lastmod>2026-11-27<\/lastmod>/);
});

test("trimDesc cuts at a word boundary near 155 characters", () => {
  assert.equal(trimDesc("Short one."), "Short one.");
  const long = "word ".repeat(60);
  const d = trimDesc(long);
  assert.ok(d.length <= 155, d.length);
  assert.match(d, /word…$/);
});

test("groupMovies keeps a known title's slug", () => {
  const t = [{ id: "z", title: "Paper Tiger - Final Trailer", channelTitle: "NEON", publishedAt: "2026-11-24T00:00:00Z", tmdbId: 7, movieTitle: "Paper Tiger" }];
  assert.equal(groupMovies(t, { "tmdb:7": "paper-tiger-2" })[0].slug, "paper-tiger-2");
  assert.equal(groupMovies(t, { "tmdb:9": "paper-tiger" })[0].slug, "paper-tiger-2");
});

test("hub page, related links, RSS feed and sitemap dates", () => {
  const section = SECTIONS[0];
  const entries = [
    { slug: "dune-part-three", name: "Dune: Part Three", thumbnail: "https://i.ytimg.com/d.jpg", lastmod: "2026-11-24", releaseDate: "2026-12-18" },
    { slug: "paper-tiger", name: "Paper Tiger", thumbnail: "https://i.ytimg.com/p.jpg", lastmod: "2026-11-20", releaseDate: "2026-11-13" },
  ];
  const hub = hubPage(section, entries, { siteUrl: "https://site.example", now });
  assert.match(hub, /<link rel="canonical" href="https:\/\/site.example\/movies\/">/);
  assert.match(hub, /<h1>New movie trailers<\/h1>/);
  assert.match(hub, /href="dune-part-three\/"/);
  assert.match(hub, /In theaters December 18, 2026/);
  assert.match(hub, /"@type":"CollectionPage"/);

  const [m] = groupMovies([{ id: "c", title: "Paper Tiger - Final Trailer", channelTitle: "NEON", publishedAt: "2026-11-24T00:00:00Z", thumbnail: "https://i.ytimg.com/c.jpg" }]);
  m.config = config;
  const page = moviePage(m, { siteUrl: "https://site.example", now, related: entries.slice(0, 1) });
  assert.match(page, /More new movie trailers/);
  assert.match(page, /href="..\/dune-part-three\/"/);
  assert.match(page, /application\/rss\+xml/);

  const rss = rssFeed([{ trailer: m.main, section, slug: m.slug, summary: "A <b>tiger</b>." }], { siteUrl: "https://site.example", selfPath: "feed.xml", title: "T", description: "D" });
  assert.match(rss, /<link>https:\/\/site.example\/movies\/paper-tiger\/<\/link>/);
  assert.match(rss, /<guid isPermaLink="false">youtube:c<\/guid>/);
  assert.match(rss, /<pubDate>Tue, 24 Nov 2026 00:00:00 GMT<\/pubDate>/);
  assert.doesNotMatch(rss, /<b>/);

  const xml = sitemap([{ dir: "movies", slug: "paper-tiger", lastmod: "2026-11-20" }], "https://site.example", "2026-11-27T00:00:00Z", ["movies"]);
  assert.match(xml, /<loc>https:\/\/site.example\/movies\/<\/loc><lastmod>2026-11-27<\/lastmod>/);
  assert.match(xml, /paper-tiger\/<\/loc><lastmod>2026-11-20<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/site.example\/about\/<\/loc><\/url>/);
});
