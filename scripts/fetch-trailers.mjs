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
  // Keep only English-language trailers. Set ENGLISH_ONLY=false to allow every language.
  englishOnly: (process.env.ENGLISH_ONLY || "true").toLowerCase() !== "false",
  // Each search.list call costs 100 quota units (free quota is 10,000/day).
  queries: (process.env.QUERIES || "official trailer|official teaser trailer|movie trailer 2026|final trailer")
    .split("|").map((q) => q.trim()).filter(Boolean),
};

const MUST_MATCH = /\btrailer\b|\bteaser\b/i;
// Fan edits, reactions, commentary, games, music and TV content that also say "trailer" or "teaser".
const REJECT = new RegExp([
  String.raw`\b(reactions?|reacting|reacts?|fan[\s-]?made|fan[\s-]?edit|edit|concept|parody|spoof|breakdown|explained|explains?|review|recap|analysis|an[aá]lise|an[aá]lisis|details|hidden|leaked?|leaks|easter eggs?|theory|predictions?|aura|notion|ai[\s-]generated)\b`,
  String.raw`\b(video game|gameplay|in[\s-]game|ps5|xbox|nintendo|fortnite|roblox|minecraft|poppy playtime|hoyo\w*|genshin|star rail|dls\d*)\b`,
  String.raw`\b(season \d+|episode|series|k-?drama|mv|music video|lyric video|musical trailer|song|album|background music|bgm)\b`,
  String.raw`#shorts`,
].join("|"), "i");
// Clickbait-style titles (emoji, ending in "!") are almost never official uploads.
const EMOJI = /\p{Extended_Pictographic}|!\s*$/u;

export function isTrailer(snippet) {
  const text = `${snippet.title} ${snippet.channelTitle}`;
  return MUST_MATCH.test(snippet.title) && !REJECT.test(text) && !EMOJI.test(snippet.title);
}

// English if YouTube says so; if the uploader set no language, require a mostly Latin-script, non-dubbed title.
const NON_EN_TITLE = /\b(dublado|legendado|doblad[oa]|subtitulado|finaler trailer|trailer finale?|bande[\s-]annonce|tráiler|trailer oficial|tamil|telugu|hindi|malayalam|kannada|marathi|bengali|punjabi|dub(bed)?)\b/i;
const NON_EN_CHANNEL = /\b(music|india|tamil|telugu|malayalam|kannada|hindi|marathi|bollywood|tollywood|kollywood|brasil|latino|españa|mexico|deutschland|italia|france|indonesia|mena)\b/i;
export function isEnglish(t) {
  const lang = (t.audioLanguage || t.language || "").toLowerCase();
  if (lang) return lang.startsWith("en");
  if (NON_EN_TITLE.test(t.title) || NON_EN_CHANNEL.test(t.channelTitle || "")) return false;
  const letters = t.title.match(/\p{L}/gu) || [];
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return letters.length > 0 && latin / letters.length > 0.9;
}

// A rough "which movie is this" key, so dubs and regional uploads of one trailer collapse to one entry.
const TRAILER_WORDS = /\b(official|final|new|exclusive|international|teaser|trailer|tráiler|movie|film|hd|4k|\d{4})\b/gi;
export function movieKey(title) {
  const t = title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ");
  const cut = t.search(/\b(official|final|new|exclusive|international|teaser|trailer)\b/);
  let base = cut > 0 ? t.slice(0, cut) : "";
  if (!base.replace(/[^\p{L}\p{N}]/gu, "")) {
    base = t.split(/\s[|–—-]\s|\|/).map((x) => x.replace(TRAILER_WORDS, "")).find((x) => x.replace(/[^\p{L}\p{N}]/gu, "")) || t;
  }
  return base.replace(/\b(movie|film)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Keep only the most viewed upload for each movie. Two keys count as the same movie when they differ
// only by numbers (e.g. "avengers doomsday" and "avengers 5 doomsday").
function sameMovie(a, b) {
  if (a === b) return true;
  const [x, y] = [a.split(" "), b.split(" ")].sort((p, q) => p.length - q.length);
  return x.length >= 2 && x.every((w) => y.includes(w)) && y.every((w) => x.includes(w) || /^\d+$/.test(w));
}
export function dedupe(list) {
  const groups = [];
  for (const t of [...list].sort((a, b) => b.views - a.views)) {
    const k = movieKey(t.title);
    if (!groups.some((g) => sameMovie(g, k))) groups.push(k), (t._keep = true);
  }
  return list.filter((t) => t._keep && delete t._keep);
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

export async function findTrailers({ apiKey, fetchFn = fetch, now = new Date(), config = CONFIG, refreshIds = [] }) {
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
  // Also re-check trailers already in the feed, to refresh view counts and language.
  for (const id of refreshIds) ids.add(id);
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
  return found.filter((t) => t.embeddable && t.views >= config.minViews && isTrailer(t) && (!config.englishOnly || isEnglish(t)));
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
    audioLanguage: s.defaultAudioLanguage || "",
    language: s.defaultLanguage || "",
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
  // Re-check older entries too, so tightening the rules also cleans the existing feed.
  const kept = [...byId.values()].filter((t) =>
    new Date(t.publishedAt) >= cutoff && isTrailer(t) && (!config.englishOnly || isEnglish(t)));
  return dedupe(kept)
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
  const fresh = await findTrailers({ apiKey, refreshIds: (current.trailers || []).map((t) => t.id) });
  const trailers = merge(current.trailers || [], fresh);
  const out = { updatedAt: new Date().toISOString(), count: trailers.length, trailers };
  await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`Found ${fresh.length} popular trailers this run; feed now has ${trailers.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
