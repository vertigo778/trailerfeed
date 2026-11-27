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

test("dedupe keeps the most viewed upload of each movie", () => {
  assert.equal(movieKey("Avengers: Doomsday | Final Trailer | In Cinemas December 17"), "avengers doomsday");
  assert.equal(movieKey("Official Trailer - Chaalchitro: The Ekchala Murders | Tota"), "chaalchitro the ekchala murders");
  const list = [
    { id: "a", title: "Avengers: Doomsday | Final Trailer | Marvel BE", views: 800 },
    { id: "b", title: "Avengers: Doomsday | Final Trailer | In Theaters December 18", views: 66000 },
    { id: "c", title: "AVENGERS 5: DOOMSDAY Official Final Trailer (2026) Marvel", views: 500 },
    { id: "d", title: "Hail Mary - Official Trailer", views: 10 },
    { id: "e", title: "Project Hail Mary | Official Trailer", views: 20 },
  ];
  assert.deepEqual(dedupe(list).map((t) => t.id), ["b", "d", "e"]);
});
