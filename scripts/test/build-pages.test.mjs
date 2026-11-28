// Run with: node --test scripts/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, linksFor, groupMovies, moviePage, sitemap, trimDesc, hubPage, rssFeed, SECTIONS, trailerType, weekOf, weekPage, comingSoonPage, factsLine, pageModel } from "../build-pages.mjs";

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

test("trailerType reads the kind of video from its title", () => {
  assert.equal(trailerType("Avengers: Doomsday | Final Trailer | In Theaters December 18"), "Final trailer");
  assert.equal(trailerType("Dune: Part Three - Exclusive Teaser Trailer (2026)"), "Teaser");
  assert.equal(trailerType("Lil Kev | Season 2 Official Trailer | Paramount+"), "Season 2 trailer");
  assert.equal(trailerType("Fortnite Treasure Hunters | Week 4 Gameplay Trailer"), "Gameplay trailer");
  assert.equal(trailerType("Superman - Official Trailer 2 (2025)"), "Trailer 2");
  assert.equal(trailerType("The Trust | Official Trailer | Netflix"), "Official trailer");
  assert.equal(trailerType("Mr. Irrelevant | New Trailer (2026 Movie)"), "Trailer");
});

test("weekOf returns the Monday of the week", () => {
  assert.equal(weekOf("2026-11-29T23:00:00Z"), "2026-11-23");
  assert.equal(weekOf("2026-11-23T00:00:00Z"), "2026-11-23");
  assert.equal(weekOf("2026-11-22T12:00:00Z"), "2026-11-16");
});

test("title page: facts line, labels, notes and breadcrumbs", () => {
  const e = { slug: "the-trust", name: "The Trust", summary: "A heist.", releaseDate: "2026-11-20", trailers: [
    { id: "n1", title: "The Trust | Official Trailer | Netflix", channelTitle: "Netflix", publishedAt: "2026-11-10T00:00:00Z", thumbnail: "t1.jpg" },
    { id: "n2", title: "The Trust | Teaser | Netflix", channelTitle: "Netflix", publishedAt: "2026-10-01T00:00:00Z", thumbnail: "t2.jpg" } ] };
  const m = { ...pageModel(e), config };
  assert.equal(m.main.id, "n1");
  assert.equal(factsLine(m, SECTIONS[0], config, now), "Watch The Trust on Netflix. There are 2 official trailers for The Trust below, newest first.");
  const html = moviePage(m, { siteUrl: "https://site.example", now, notes: "First para.\n\nSecond <para>." });
  assert.match(html, /<meta name="description" content="Watch the official trailer for The Trust\. Watch The Trust on Netflix\. A heist\.">/);
  assert.match(html, /Teaser: The Trust \| Teaser \| Netflix/);
  assert.match(html, /<h2>About The Trust<\/h2>/);
  assert.match(html, /<p>Second &lt;para&gt;\.<\/p>/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  const theatrical = factsLine({ name: "Dune", releaseDate: "2026-12-18", trailers: [{}], main: { channelTitle: "IGN" } }, SECTIONS[0], config, now);
  assert.equal(theatrical, "Dune opens in theaters on December 18, 2026.");
});

test("weekly roundup and coming-soon pages", () => {
  const t = { id: "a", title: "Dune: Part Three - Teaser Trailer", channelTitle: "Warner Bros.", publishedAt: "2026-11-24T17:00:00Z", thumbnail: "d.jpg", views: 5 };
  const html = weekPage(SECTIONS[0], { week: "2026-11-23", items: [{ trailer: t, slug: "dune-part-three", name: "Dune: Part Three" }] }, { siteUrl: "https://site.example", prev: "2026-11-16" });
  assert.match(html, /<title>New movie trailers, week of Nov 23, 2026 · Trailerfeed<\/title>/);
  assert.match(html, /1 new official movie trailer came out between November 23, 2026 and November 29, 2026, including Dune: Part Three\./);
  assert.match(html, /href="..\/..\/dune-part-three\/"/);
  assert.match(html, /href="..\/2026-11-16\/">← Week of Nov 16, 2026/);
  assert.match(html, /<link rel="canonical" href="https:\/\/site.example\/movies\/week\/2026-11-23\/">/);
  assert.match(html, /href="https:\/\/site.example\/movies\/feed.xml"/);

  const soon = comingSoonPage(SECTIONS[0], [
    { slug: "b", name: "Later", thumbnail: "b.jpg", releaseDate: "2027-01-09" },
    { slug: "a", name: "Sooner", thumbnail: "a.jpg", releaseDate: "2026-12-18" },
    { slug: "c", name: "Old", thumbnail: "c.jpg", releaseDate: "2026-01-01" },
  ], { siteUrl: "https://site.example", now });
  assert.match(soon, /<h2>December 2026<\/h2>[\s\S]*Sooner[\s\S]*<h2>January 2027<\/h2>[\s\S]*Later/);
  assert.doesNotMatch(soon, /Old/);
  assert.match(soon, /In theaters December 18, 2026/);
});

test("groupMovies never gives a title a reserved folder name", () => {
  const [m] = groupMovies([{ id: "w", title: "Week - Official Trailer", channelTitle: "A24", publishedAt: "2026-11-24T00:00:00Z" }]);
  assert.equal(m.slug, "week-2");
});
