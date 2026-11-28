// Run with: node --test scripts/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTrailers, merge, isTrailer } from "../fetch-trailers.mjs";

const now = new Date("2026-11-27T12:00:00Z");
const cfg = { channels: [], searchWindowDays: 7, keepDays: 60, minViews: 100000, maxItems: 120, regionCode: "US", queries: ["official trailer"] };

function mockFetch(searchItems, videoItems) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const body = url.pathname.endsWith("/search") ? { items: searchItems } : { items: videoItems.filter((v) => url.searchParams.get("id").split(",").includes(v.id)) };
    return { ok: true, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const s = (id, title, channelTitle = "Studio") => ({ id: { videoId: id }, snippet: { title, channelTitle } });
const v = (id, title, views, publishedAt = "2026-11-26T15:00:00Z", embeddable = true) => ({
  id, snippet: { title, channelTitle: "Studio", publishedAt, thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
  statistics: { viewCount: String(views), likeCount: "10" }, status: { embeddable },
});

test("isTrailer keeps official trailers and drops reactions, games and fan edits", () => {
  assert.ok(isTrailer({ title: "The Hunger Games: Sunrise on the Reaping | Official Trailer", channelTitle: "Lionsgate" }));
  assert.ok(isTrailer({ title: "DUNE: PART THREE – Official Teaser", channelTitle: "Warner Bros." }));
  assert.ok(!isTrailer({ title: "Reacting to the Official Trailer", channelTitle: "x" }));
  assert.ok(!isTrailer({ title: "Fan Made Trailer", channelTitle: "x" }));
  assert.ok(!isTrailer({ title: "Gameplay Trailer | PS5", channelTitle: "x" }));
  assert.ok(!isTrailer({ title: "Behind the scenes", channelTitle: "x" }));
});

test("findTrailers filters by popularity, embeddability and title, and sends the key", async () => {
  const fetchFn = mockFetch(
    [s("a", "Movie A | Official Trailer"), s("b", "Movie B Official Trailer"), s("c", "Trailer REACTION"), s("d", "Movie D | Teaser Trailer")],
    [v("a", "Movie A | Official Trailer", 2_000_000), v("b", "Movie B Official Trailer", 5_000), v("d", "Movie D | Teaser Trailer", 900_000, undefined, false)],
  );
  const out = await findTrailers({ apiKey: "KEY", fetchFn, now, config: cfg });
  assert.deepEqual(out.map((t) => t.id), ["a"]);
  assert.equal(out[0].views, 2_000_000);
  const search = fetchFn.calls[0];
  assert.equal(search.searchParams.get("key"), "KEY");
  assert.equal(search.searchParams.get("order"), "viewCount");
  assert.equal(search.searchParams.get("publishedAfter"), "2026-11-20T12:00:00.000Z");
  assert.equal(fetchFn.calls[1].searchParams.get("id"), "a,b,d"); // reaction never looked up
});

test("findTrailers surfaces API errors clearly", async () => {
  const fetchFn = async () => ({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ error: { message: "quotaExceeded" } }) });
  await assert.rejects(findTrailers({ apiKey: "K", fetchFn, now, config: cfg }), /search failed \(403\): quotaExceeded/);
});

test("merge refreshes view counts, drops expired trailers and sorts newest first", () => {
  const existing = [
    { id: "old", title: "Old | Official Trailer", publishedAt: "2026-08-01T00:00:00Z", views: 9 },
    { id: "a", title: "Alpha | Official Trailer", publishedAt: "2026-11-20T00:00:00Z", views: 100 },
  ];
  const fresh = [
    { id: "a", title: "Alpha | Official Trailer", publishedAt: "2026-11-20T00:00:00Z", views: 500, embeddable: true },
    { id: "b", title: "Bravo | Official Trailer", publishedAt: "2026-11-26T00:00:00Z", views: 300, embeddable: true },
  ];
  const out = merge(existing, fresh, { now, config: cfg });
  assert.deepEqual(out.map((t) => t.id), ["b", "a"]);
  assert.equal(out[1].views, 500);
  assert.equal("embeddable" in out[0], false);
});

import { isEnglish, movieKey, dedupe } from "../fetch-trailers.mjs";

test("isTrailer drops fan commentary, clickbait, games and music", () => {
  for (const title of [
    "Marvel is hiding someone in Doomsday trailer!",
    "SPIDER-MAN HIDDEN IN AVENGERS DOOMSDAY FINAL TRAILER🔥😱",
    "ANÁLISE DO TRAILER FINAL DE VINGADORES DOOMSDAY",
    "TOP FAN REACTIONS | AVENGERS DOOMSDAY FINAL TRAILER",
    "Barkley | Poppy Playtime Chapter 6 Teaser Trailer",
    "LNGSHOT - 'Beep Beep' Official MV Teaser",
    "OFFICIAL TEASER | Magic Lover Series",
    "Inji Vellam - Notion Trailer | Vijay Sethupathi",
  ]) assert.ok(!isTrailer({ title, channelTitle: "x" }), title);
  assert.ok(isTrailer({ title: "Avengers: Doomsday | Final Trailer | In Theaters December 18", channelTitle: "Marvel Entertainment" }));
});

test("isEnglish requires a listed channel, then checks language, title and channel", () => {
  const studios = { channels: ["marvel entertainment", "netflix"] };
  assert.ok(isEnglish({ title: "Avengers: Doomsday | Final Trailer", channelTitle: "Marvel Entertainment", audioLanguage: "en" }, studios));
  assert.ok(!isEnglish({ title: "Cosmic Samson Trailer", channelTitle: "Think Music India", audioLanguage: "en" }, studios));
  assert.ok(!isEnglish({ title: "Vrushakarma Official Trailer", channelTitle: "Sri Venkateswara Creations" }, studios));
  assert.ok(isEnglish({ title: "Anything", audioLanguage: "en-US" }, { channels: [] }));
  assert.ok(!isEnglish({ title: "Vrushakarma Official Trailer", audioLanguage: "te" }, { channels: [] }));
  assert.ok(isEnglish({ title: "Dune: Part Three - Exclusive Teaser Trailer (2026)", channelTitle: "IGN" }, { channels: [] }));
  assert.ok(isEnglish({ title: "Avengers: Doomsday | Final Trailer", channelTitle: "Marvel Entertainment" }, { channels: [] }));
  assert.ok(!isEnglish({ title: "Vingadores - Doutor Destino | Trailer Final Dublado", channelTitle: "ingresso.com" }, { channels: [] }));
  assert.ok(!isEnglish({ title: "K-POP: THE DEBUT | Official Trailer 케이팝 슈퍼스타 | 공식 예고편", channelTitle: "Paramount" }, { channels: [] }));
  assert.ok(!isEnglish({ title: "Cosmic Samson Trailer", channelTitle: "Think Music India" }, { channels: [] }));
});

test("dedupe collapses re-uploads of one trailer but keeps new versions", () => {
  assert.equal(movieKey("Avengers: Doomsday | Final Trailer | In Cinemas December 17"), "avengers doomsday");
  assert.equal(movieKey("Official Trailer - Chaalchitro: The Ekchala Murders | Tota"), "chaalchitro the ekchala murders");
  const list = [
    { id: "a", title: "Avengers: Doomsday | Final Trailer | Marvel BE", views: 800, publishedAt: "2026-11-23T15:00:00Z" },
    { id: "b", title: "Avengers: Doomsday | Final Trailer | In Theaters December 18", views: 66000, publishedAt: "2026-11-23T14:00:00Z" },
    { id: "c", title: "AVENGERS 5: DOOMSDAY Official Final Trailer (2026) Marvel", views: 500, publishedAt: "2026-11-24T09:00:00Z" },
    { id: "d", title: "Hail Mary - Official Trailer", views: 10, publishedAt: "2026-11-23T00:00:00Z" },
    { id: "e", title: "Project Hail Mary | Official Trailer", views: 20, publishedAt: "2026-11-23T00:00:00Z" },
    { id: "f", title: "Avengers: Doomsday | Official Trailer", views: 90000, publishedAt: "2026-10-20T14:00:00Z" },
  ];
  assert.deepEqual(dedupe(list, { sameTrailerDays: 3 }).map((t) => t.id), ["b", "d", "e", "f"]);
});

import { movieName, summaryFromDescription, addSummaries } from "../fetch-trailers.mjs";

test("movieName pulls the movie out of a trailer title", () => {
  assert.equal(movieName("Avengers: Doomsday | Final Trailer | In Theaters December 18"), "Avengers: Doomsday");
  assert.equal(movieName("Dune: Part Three - Exclusive Teaser Trailer (2026) Timothée Chalamet"), "Dune: Part Three");
  assert.equal(movieName("Mr. Irrelevant | New Trailer (2026 Movie) - David Corenswet"), "Mr. Irrelevant");
});

test("summaryFromDescription keeps the plot paragraph and drops promo lines", () => {
  const d = "The end is near.\n\nIn a world shattered by Doctor Doom, the Avengers must reunite to stop a threat to every reality.\n\nSubscribe: https://youtube.com/x\n#Avengers";
  assert.equal(summaryFromDescription(d), "In a world shattered by Doctor Doom, the Avengers must reunite to stop a threat to every reality.");
  assert.equal(summaryFromDescription("Watch now! https://x.com #movie"), "");
  assert.equal(summaryFromDescription("Netflix is one of the world’s leading entertainment services with over 300 million paid memberships in over 190 countries."), "");
});

test("addSummaries uses TMDB once per movie, then falls back to the description", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    const q = url.searchParams.get("query");
    if (url.pathname.endsWith("/tv")) {
      return { ok: true, json: async () => ({ results: q === "The Murder Case" ? [{ name: "The Murder Case", first_air_date: "2026-11-30" }] : [] }) };
    }
    calls.push(q);
    const results = q === "Avengers: Doomsday"
      ? [{ id: 1, title: "Avengers: Doomsday", overview: "Doom arrives.", release_date: "2026-12-18", popularity: 99 },
         { id: 2, title: "Avengers: Doomsday Fan Cut", overview: "x", release_date: "2026-01-01", popularity: 1 }]
      : [];
    return { ok: true, json: async () => ({ results }) };
  };
  const trailers = [
    { id: "a", title: "Avengers: Doomsday | Final Trailer", descriptionSummary: "Desc A." },
    { id: "b", title: "Avengers: Doomsday | Official Trailer", descriptionSummary: "Desc B." },
    { id: "c", title: "Paper Tiger - Final Trailer", descriptionSummary: "Two brothers chase a dream." },
    { id: "d", title: "The Murder Case | Official Trailer", descriptionSummary: "Netflix boilerplate." },
    { id: "e", title: "TIMBERLAKE — Official Trailer", movieTitle: "Justin Timberlake: Iconic", tmdbId: 9, summary: "Wrong film." },
  ];
  await addSummaries(trailers, { tmdbKey: "k", fetchFn, now: new Date("2026-11-27") });
  assert.deepEqual(calls, ["Avengers: Doomsday", "Paper Tiger", "The Murder Case", "TIMBERLAKE"]);
  assert.equal(trailers[3].isTv, true);
  assert.equal(trailers[4].tmdbId, undefined); // stale fuzzy match cleared
  assert.equal(trailers[4].summary, undefined);
  assert.equal(trailers[0].summary, "Doom arrives.");
  assert.equal(trailers[1].releaseDate, "2026-12-18");
  assert.equal(trailers[2].summary, "Two brothers chase a dream.");
  const noKey = [{ id: "d", title: "X | Trailer", descriptionSummary: "Fallback." }];
  await addSummaries(noKey, {});
  assert.equal(noKey[0].summary, "Fallback.");
});

import { CATEGORIES, dropWrongFeed, lookupMovie } from "../fetch-trailers.mjs";

test("each feed keeps its own kind of trailer", () => {
  const ok = (title, channelTitle, cat) => isTrailer({ title, channelTitle }, CATEGORIES[cat]);
  assert.ok(ok("The Bear Season 5 | Official Trailer", "FX Networks", "tv"));
  assert.ok(!ok("The Bear Season 5 | Official Trailer", "FX Networks", "movies"));
  assert.ok(ok("Marvel 1943 - Official Gameplay Trailer | PS5 Games", "PlayStation", "games"));
  assert.ok(!ok("Marvel 1943 - Official Gameplay Trailer | PS5 Games", "PlayStation", "tv"));
  // IGN posts everything, so in the TV and game feeds its titles must say what they are.
  assert.ok(!ok("Dune: Part Three - Exclusive Teaser Trailer", "IGN", "games"));
  assert.ok(!ok("Dune: Part Three - Exclusive Teaser Trailer", "IGN", "tv"));
  assert.ok(ok("Ghost of Yotei - Official Launch Trailer", "IGN", "games"));
  assert.ok(ok("Dune: Part Three - Exclusive Teaser Trailer", "IGN", "movies"));
  assert.equal(movieName("The Bear Season 5 | Official Trailer"), "The Bear");
  assert.equal(movieName("Tuesday Morning - Release Date Reveal Trailer | PS5 Games"), "Tuesday Morning");
  assert.equal(movieName("KuloNiku: Bowl Up! – Launch Trailer – Nintendo Switch 2"), "KuloNiku: Bowl Up!");
  assert.equal(movieName("Tuesday Morning - Official Release Date Trailer"), "Tuesday Morning");
});

test("dropWrongFeed removes TV from movies, non-English originals and unknown streamer titles", () => {
  const list = () => [
    { id: "a", channelTitle: "Marvel Entertainment", tmdbId: 1, originalLanguage: "en" },
    { id: "b", channelTitle: "Netflix", isTv: true },
    { id: "c", channelTitle: "Netflix", tmdbId: 2, originalLanguage: "hi" },
    { id: "d", channelTitle: "Netflix" },
    { id: "e", channelTitle: "NEON" },
  ];
  assert.deepEqual(dropWrongFeed(list(), CATEGORIES.movies, "key").map((t) => t.id), ["a", "e"]);
  assert.deepEqual(dropWrongFeed(list(), CATEGORIES.movies, "").map((t) => t.id), ["a", "c", "d", "e"]);
  assert.deepEqual(dropWrongFeed([{ id: "f", isMovie: true }], CATEGORIES.tv, "key"), []);
});

test("TV lookups use TMDB's TV search and flag films", async () => {
  const fetchFn = async (url) => ({ ok: true, json: async () => ({ results: url.pathname.endsWith("/tv")
    ? (url.searchParams.get("query") === "The Bear" ? [{ id: 7, name: "The Bear", overview: "A chef.", first_air_date: "2022-06-23", original_language: "en" }] : [])
    : [{ id: 8, title: "Some Film", overview: "x", release_date: "2026-05-01" }] }) });
  const show = await lookupMovie("The Bear", { tmdbKey: "k", fetchFn, now: new Date("2026-11-27"), type: "tv" });
  assert.deepEqual(show, { movieTitle: "The Bear", summary: "A chef.", releaseDate: "2022-06-23", tmdbId: 7, originalLanguage: "en" });
  assert.deepEqual(await lookupMovie("Some Film", { tmdbKey: "k", fetchFn, now: new Date("2026-11-27"), type: "tv" }), { isMovie: true });
});

test("the games feed merges an update's trailer into the game's", () => {
  const list = [
    { id: "a", title: "The Division 2 - Official Spearfall Launch Trailer", views: 72000, publishedAt: "2026-11-25T16:00:00Z" },
    { id: "b", title: "The Division 2: Spearfall - Official Launch Trailer", views: 236000, publishedAt: "2026-11-25T15:00:00Z" },
  ];
  assert.deepEqual(dedupe(list, CATEGORIES.games).map((t) => t.id), ["b"]);
  assert.deepEqual(dedupe(list, CATEGORIES.movies).map((t) => t.id), ["a", "b"]);
});
