// Run with: node --test scripts/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, linksFor, groupMovies, moviePage, sitemap } from "../build-pages.mjs";

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
  assert.match(html, /<title>Avengers: Doomsday \(2026\) Trailer · Trailer Feed<\/title>/);
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
