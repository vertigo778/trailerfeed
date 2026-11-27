// Run with: node --test scripts/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTrailers, merge, isTrailer } from "../fetch-trailers.mjs";

const now = new Date("2026-11-27T12:00:00Z");
const cfg = { searchWindowDays: 7, keepDays: 60, minViews: 100000, maxItems: 120, regionCode: "US", queries: ["official trailer"] };

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
    { id: "old", title: "Old", publishedAt: "2026-08-01T00:00:00Z", views: 9 },
    { id: "a", title: "A", publishedAt: "2026-11-20T00:00:00Z", views: 100 },
  ];
  const fresh = [
    { id: "a", title: "A", publishedAt: "2026-11-20T00:00:00Z", views: 500, embeddable: true },
    { id: "b", title: "B", publishedAt: "2026-11-26T00:00:00Z", views: 300, embeddable: true },
  ];
  const out = merge(existing, fresh, { now, config: cfg });
  assert.deepEqual(out.map((t) => t.id), ["b", "a"]);
  assert.equal(out[1].views, 500);
  assert.equal("embeddable" in out[0], false);
});
