#!/usr/bin/env node
// Finds new, popular official movie trailers on YouTube and merges them into data/trailers.json.
// Runs daily from .github/workflows/update-trailers.yml. Needs YOUTUBE_API_KEY in the environment.
// No dependencies: Node 20+ (built-in fetch).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "trailers.json");
const API = "https://www.googleapis.com/youtube/v3";

export const CONFIG = {
  // How far back each daily search looks for new uploads.
  searchWindowDays: Number(process.env.SEARCH_WINDOW_DAYS || 7),
  // How long a trailer stays in the feed.
  keepDays: Number(process.env.KEEP_DAYS || 60),
  // A trailer must have at least this many views to count as "popular".
  minViews: Number(process.env.MIN_VIEWS || 100000),
  maxItems: Number(process.env.MAX_ITEMS || 120),
  regionCode: process.env.REGION_CODE || "US",
  // Each search.list call costs 100 quota units (free quota is 10,000/day).
  queries: (process.env.QUERIES || "official trailer|official teaser trailer|movie trailer 2026|final trailer")
    .split("|").map((q) => q.trim()).filter(Boolean),
};

const MUST_MATCH = /\btrailer\b|\bteaser\b/i;
const REJECT = /\b(reaction|reacting|react|reacts|fan[\s-]?made|concept|parody|breakdown|explained|review|recap|easter eggs?|ai[\s-]generated|video game|gameplay|ps5|xbox|nintendo|fortnite|season \d+|episode|k-?drama|music video|lyric video)\b|#shorts/i;

export function isTrailer(snippet) {
  const text = `${snippet.title} ${snippet.channelTitle}`;
  return MUST_MATCH.test(snippet.title) && !REJECT.test(text);
}

function decode(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function api(fetchFn, endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchFn(url);
  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new Error(`YouTube API ${endpoint} failed (${res.status}): ${msg}`);
  }
  return body;
}

export async function findTrailers({ apiKey, fetchFn = fetch, now = new Date(), config = CONFIG }) {
  const publishedAfter = new Date(now - config.searchWindowDays * 864e5).toISOString();
  const ids = new Set();
  for (const q of config.queries) {
    const res = await api(fetchFn, "search", {
      key: apiKey, part: "snippet", q, type: "video", order: "viewCount",
      publishedAfter, maxResults: 50, regionCode: config.regionCode,
      relevanceLanguage: "en", videoEmbeddable: "true", safeSearch: "moderate",
    });
    for (const item of res.items || []) {
      if (item.id?.videoId && isTrailer(item.snippet)) ids.add(item.id.videoId);
    }
  }
  if (!ids.size) return [];

  // Look up view counts and embeddability (videos.list costs 1 unit per 50 ids).
  const all = [...ids];
  const found = [];
  for (let i = 0; i < all.length; i += 50) {
    const res = await api(fetchFn, "videos", {
      key: apiKey, part: "snippet,statistics,status,contentDetails", id: all.slice(i, i + 50).join(","),
    });
    for (const v of res.items || []) found.push(toTrailer(v));
  }
  return found.filter((t) => t.embeddable && t.views >= config.minViews && isTrailer(t));
}

function toTrailer(v) {
  const s = v.snippet || {};
  const thumbs = s.thumbnails || {};
  return {
    id: v.id,
    title: decode(s.title),
    channelTitle: decode(s.channelTitle),
    publishedAt: s.publishedAt,
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    thumbnail: (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {}).url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    embeddable: v.status?.embeddable !== false,
  };
}

// Merge fresh results into the existing list: refresh view counts, drop old ones, newest first.
export function merge(existing, fresh, { now = new Date(), config = CONFIG } = {}) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of fresh) {
    const { embeddable, ...rest } = t;
    byId.set(t.id, { ...byId.get(t.id), ...rest });
  }
  const cutoff = now - config.keepDays * 864e5;
  return [...byId.values()]
    .filter((t) => new Date(t.publishedAt) >= cutoff)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, config.maxItems);
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY is not set. See README.md, section 'YouTube API key'.");
    process.exit(1);
  }
  let current = { trailers: [] };
  try { current = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}
  const fresh = await findTrailers({ apiKey });
  const trailers = merge(current.trailers || [], fresh);
  const out = { updatedAt: new Date().toISOString(), count: trailers.length, trailers };
  await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`Found ${fresh.length} popular trailers this run; feed now has ${trailers.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
