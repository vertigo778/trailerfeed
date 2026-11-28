#!/usr/bin/env node
// Finds new, popular official trailers on YouTube for three feeds (movies, TV, video games) and
// merges them into data/trailers.json, data/tv.json and data/games.json.
// Runs daily from .github/workflows/update-trailers.yml. Needs YOUTUBE_API_KEY in the environment.
// No dependencies: Node 20+ (built-in fetch).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://www.googleapis.com/youtube/v3";

export const CONFIG = {
  category: "movies",
  file: "trailers.json",
  // TMDB lookup type for summaries: "movie", "tv" or "" (none).
  tmdbType: "movie",
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
  // A trailer uploaded within this many days of another upload of the same movie counts as the
  // same trailer (re-uploads by other channels). Uploads further apart are new versions and both stay.
  sameTrailerDays: Number(process.env.SAME_TRAILER_DAYS || 3),
  // In English-only mode, trailers must come from one of these US studio, streamer or trailer
  // channels (exact name, any case).
  // Uploaders' language tags proved unreliable, so a list of studio and trailer channels is the
  // dependable signal. Override with the CHANNELS variable (names separated by |).
  channels: (process.env.CHANNELS || [
    // Studios and distributors
    "Marvel Entertainment", "Warner Bros. Pictures", "Warner Bros.", "Universal Pictures", "Sony Pictures Entertainment",
    "Sony Pictures Classics", "Sony Pictures Animation", "Paramount Pictures", "20th Century Studios", "Walt Disney Studios",
    "Disney", "Pixar", "Lucasfilm", "Star Wars", "Lionsgate Movies", "Lionsgate", "A24", "NEON", "Focus Features",
    "Searchlight Pictures", "Bleecker Street", "Angel Studios", "Amazon MGM Studios", "Blumhouse", "DreamWorks Animation",
    "Illumination", "Legendary", "Roadside Attractions", "IFC Films", "Magnolia Pictures", "MUBI", "STXfilms",
    "Vertical", "Briarcliff Entertainment",
    // Streamers
    "Netflix", "Prime Video", "Apple TV", "HBO Max", "Max", "Peacock", "Hulu",
    // Trailer channels
    "IGN", "Rotten Tomatoes Trailers", "KinoCheck.com", "FilmSelect Trailer", "Fandango", "Movieclips Trailers",
  ].join("|")).split("|").map((c) => c.trim().toLowerCase()).filter(Boolean),
  // Each search.list call costs 100 quota units (free quota is 10,000/day).
  queries: (process.env.QUERIES || "official trailer|official teaser trailer|movie trailer 2026|final trailer")
    .split("|").map((q) => q.trim()).filter(Boolean),
};

const MUST_MATCH = /\btrailer\b|\bteaser\b/i;
// Fan edits, reactions, commentary and music uploads that also say "trailer" or "teaser".
const COMMON_REJECT = new RegExp([
  String.raw`\b(reactions?|reacting|reacts?|fan[\s-]?made|fan[\s-]?edit|edit|concept|parody|spoof|breakdown|explained|explains?|review|recap|analysis|an[aá]lise|an[aá]lisis|details|hidden|leaked?|leaks|easter eggs?|theory|predictions?|aura|notion|ai[\s-]generated)\b`,
  String.raw`\b(mv|music video|lyric video|musical trailer|song|album|background music|bgm)\b`,
  String.raw`#shorts`,
].join("|"), "i");
const GAME_WORDS = String.raw`\b(video game|gameplay|in[\s-]game|ps5|ps4|playstation|xbox|nintendo|switch 2|steam|dlc|fortnite|roblox|minecraft|poppy playtime|hoyo\w*|genshin|star rail|dls\d*)\b`;
const TV_WORDS = String.raw`\b(season \d+|episode|series|docuseries|k-?drama)\b`;
// Category-specific: the movie feed drops game and TV trailers, the TV feed drops game trailers.
const REJECT = {
  movies: new RegExp(`${GAME_WORDS}|${TV_WORDS}`, "i"),
  tv: new RegExp(GAME_WORDS, "i"),
  games: null,
};
// Clickbait-style titles (emoji, ending in "!") are almost never official uploads.
const EMOJI = /\p{Extended_Pictographic}|!\s*$/u;

const list = (env, fallback) => (env || fallback.join("|")).split("|").map((c) => c.trim().toLowerCase()).filter(Boolean);
const STREAMERS = new Set(["netflix", "prime video", "apple tv", "hbo max", "max", "hulu", "peacock", "paramount plus", "paramount+", "disney plus", "disney+"]);
const AGGREGATORS = ["ign", "gamespot", "rotten tomatoes tv", "rotten tomatoes trailers", "kinocheck.com"];

// The three feeds. Movies use CONFIG as is; TV and games override what differs.
// TV runs first so the movie feed can skip anything the TV feed claimed (a streamer title can
// match both a film and a show on TMDB).
export const CATEGORIES = {
  tv: {
    ...CONFIG,
    category: "tv",
    file: "tv.json",
    tmdbType: "tv",
    minViews: Number(process.env.TV_MIN_VIEWS || 50000),
    queries: list(process.env.TV_QUERIES, ["official series trailer", "season official trailer", "limited series official trailer"]),
    channels: list(process.env.TV_CHANNELS, [
      "Netflix", "Prime Video", "Apple TV", "HBO Max", "Max", "Hulu", "Peacock", "Paramount Plus", "Paramount+",
      "Disney Plus", "Disney+", "FX Networks", "AMC", "AMC+", "STARZ", "Showtime", "Marvel Entertainment", "Star Wars",
      "Rotten Tomatoes TV", "IGN",
    ]),
    aggregators: AGGREGATORS,
    aggregatorMustMatch: new RegExp(TV_WORDS, "i"),
  },
  movies: CONFIG,
  games: {
    ...CONFIG,
    category: "games",
    file: "games.json",
    tmdbType: "",
    minViews: Number(process.env.GAMES_MIN_VIEWS || 50000),
    queries: list(process.env.GAMES_QUERIES, ["official game trailer", "gameplay trailer", "launch trailer game", "reveal trailer game"]),
    channels: list(process.env.GAMES_CHANNELS, [
      "PlayStation", "Xbox", "Nintendo of America", "Ubisoft", "Ubisoft North America", "EA", "Electronic Arts",
      "Bethesda Softworks", "Rockstar Games", "Bandai Namco America", "CAPCOM USA", "Capcom", "SEGA", "Square Enix",
      "Square Enix North America", "Warner Bros. Games", "Riot Games", "Blizzard Entertainment", "Call of Duty",
      "Activision", "Epic Games", "Fortnite", "2K", "Devolver Digital", "Valve", "Insomniac Games", "Naughty Dog",
      "Bungie", "Destiny 2", "Battlefield", "Genshin Impact", "Honkai: Star Rail", "The Game Awards", "IGN", "GameSpot",
    ]),
    aggregators: AGGREGATORS,
    aggregatorMustMatch: new RegExp(`${GAME_WORDS}|\\b(launch|reveal|announcement|announce|release date) trailer\\b`, "i"),
  },
};

export function isTrailer(snippet, config = CONFIG) {
  const text = `${snippet.title} ${snippet.channelTitle}`;
  const extra = REJECT[config.category || "movies"];
  if (!MUST_MATCH.test(snippet.title) || COMMON_REJECT.test(text) || (extra && extra.test(text)) || EMOJI.test(snippet.title)) return false;
  // Trailer channels like IGN post every kind of trailer, so in the TV and game feeds their
  // uploads must say what they are.
  if (config.aggregators?.includes((snippet.channelTitle || "").toLowerCase()) && config.aggregatorMustMatch) {
    return config.aggregatorMustMatch.test(snippet.title);
  }
  return true;
}

// English if YouTube says so; if the uploader set no language, require a mostly Latin-script, non-dubbed title.
const NON_EN_TITLE = /\b(dublado|legendado|doblad[oa]|subtitulado|finaler trailer|trailer finale?|bande[\s-]annonce|tráiler|trailer oficial|tamil|telugu|hindi|malayalam|kannada|marathi|bengali|punjabi|dub(bed)?)\b/i;
const NON_EN_CHANNEL = /\b(music|india|tamil|telugu|malayalam|kannada|hindi|marathi|bollywood|tollywood|kollywood|brasil|latino|españa|mexico|deutschland|italia|france|indonesia|mena)\b/i;
export function isEnglish(t, config = CONFIG) {
  if (config.channels?.length && !config.channels.includes((t.channelTitle || "").trim().toLowerCase())) return false;
  const lang = (t.audioLanguage || t.language || "").toLowerCase();
  if (lang && !lang.startsWith("en")) return false;
  if (NON_EN_TITLE.test(t.title) || NON_EN_CHANNEL.test(t.channelTitle || "")) return false;
  const letters = t.title.match(/\p{L}/gu) || [];
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return letters.length > 0 && latin / letters.length > 0.9;
}

// A rough "which movie is this" key, so dubs and regional uploads of one trailer collapse to one entry.
const TRAILER_WORDS = /\b(official|final|new|exclusive|international|teaser|trailer|tráiler|movie|film|hd|4k|\d{4})\b/gi;
// The movie's name as written in the title, e.g. "Avengers: Doomsday" from
// "Avengers: Doomsday | Final Trailer | In Theaters December 18".
export function movieName(title) {
  const t = title.replace(/\(.*?\)|\[.*?\]/g, " ");
  const cut = t.search(/\b(official|final|new|exclusive|international|teaser|trailer|launch|reveal|release date|announcement|announce|gameplay|demo)\b/i);
  let base = cut > 0 ? t.slice(0, cut) : "";
  if (!base.replace(/[^\p{L}\p{N}]/gu, "")) {
    base = t.split(/\s[|–—-]\s|\|/).map((x) => x.replace(TRAILER_WORDS, "")).find((x) => x.replace(/[^\p{L}\p{N}]/gu, "")) || t;
  }
  return base.replace(/\b(movie|film|season \d+|(limited |docu)?series|volume \d+|vol\. ?\d+)\b/gi, " ").replace(/[\s|–—:-]+$/u, "").replace(/^[\s|–—:-]+/u, "").replace(/\s+/g, " ").trim();
}

export function movieKey(title) {
  return movieName(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// A short summary from the video description, for when TMDB has nothing: the first paragraph
// that reads like prose (no links, hashtags, credits or "subscribe" lines).
export function summaryFromDescription(desc = "") {
  const junk = /https?:\/\/|www\.|#\w|@\w|subscribe|follow us|leading entertainment service|netflix is|about netflix|like us|download|tickets|in theaters|in cinemas|only in|streaming|©|℗|all rights reserved|directed by|starring|written by|produced by|rated |^\s*[A-Z][A-Za-z ]{0,25}:\s*$/i;
  const paras = String(desc).split(/\n\s*\n/).map((p) => p.split("\n").filter((l) => !junk.test(l)).join(" ").replace(/\s+/g, " ").trim());
  const prose = paras.find((p) => p.length >= 60 && /[.!?]["”’)]?$/.test(p) && !/^[A-Z0-9\s\W]+$/.test(p));
  if (!prose) return "";
  return prose.length > 420 ? prose.slice(0, prose.lastIndexOf(" ", 410)) + "…" : prose;
}

// Look up the movie on TMDB (free API key, optional) for its official overview and release date.
export async function lookupMovie(name, { tmdbKey, fetchFn = fetch, now = new Date(), type = "movie" }) {
  if (!tmdbKey || !name) return null;
  if (type === "tv") return lookupShow(name, { tmdbKey, fetchFn, now });
  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.searchParams.set("query", name);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("include_adult", "false");
  const bearer = tmdbKey.length > 40; // v4 read access token vs v3 api key
  if (!bearer) url.searchParams.set("api_key", tmdbKey);
  const res = await fetchFn(url, bearer ? { headers: { Authorization: `Bearer ${tmdbKey}` } } : undefined);
  if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);
  const { results = [] } = await res.json();
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const minYear = now.getUTCFullYear() - 1;
  const recent = (list, dateKey) => list.filter((m) => !m[dateKey] || Number(m[dateKey].slice(0, 4)) >= minYear);
  // Only trust an exact title match: a fuzzy "most popular" pick was often the wrong film.
  // Exact title match, ignoring numbering ("Avengers 5: Doomsday" is "Avengers: Doomsday").
  const pick = recent(results, "release_date").find((m) => m.overview && sameMovie(norm(m.title), norm(name)));
  if (pick) return { movieTitle: pick.title, summary: pick.overview, releaseDate: pick.release_date || "", tmdbId: pick.id, originalLanguage: pick.original_language || "" };
  // No movie by that name: if it's a TV show, say so, so the feed can leave it out.
  const tvUrl = new URL(url);
  tvUrl.pathname = "/3/search/tv";
  const tvRes = await fetchFn(tvUrl, bearer ? { headers: { Authorization: `Bearer ${tmdbKey}` } } : undefined);
  if (tvRes.ok) {
    const { results: shows = [] } = await tvRes.json();
    if (recent(shows, "first_air_date").some((m) => norm(m.name || "") === norm(name))) return { isTv: true };
  }
  return null;
}

// The TV version: the show's overview and first air date, or { isMovie } when it's a film instead.
async function lookupShow(name, { tmdbKey, fetchFn, now }) {
  const bearer = tmdbKey.length > 40;
  const get = async (kind) => {
    const url = new URL(`https://api.themoviedb.org/3/search/${kind}`);
    url.searchParams.set("query", name);
    url.searchParams.set("language", "en-US");
    if (!bearer) url.searchParams.set("api_key", tmdbKey);
    const res = await fetchFn(url, bearer ? { headers: { Authorization: `Bearer ${tmdbKey}` } } : undefined);
    if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);
    return (await res.json()).results || [];
  };
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const minYear = now.getUTCFullYear() - 1;
  const shows = await get("tv");
  // Long-running shows started years ago, so no date filter here: an exact name match is enough.
  const pick = shows.find((m) => m.overview && sameMovie(norm(m.name || ""), norm(name)));
  if (pick) return { movieTitle: pick.name, summary: pick.overview, releaseDate: pick.first_air_date || "", tmdbId: pick.id, originalLanguage: pick.original_language || "" };
  const movies = await get("movie");
  if (movies.some((m) => norm(m.title || "") === norm(name) && (!m.release_date || Number(m.release_date.slice(0, 4)) >= minYear))) return { isMovie: true };
  return null;
}

// Two keys name the same movie when they differ only by numbers ("avengers doomsday" and
// "avengers 5 doomsday").
export function sameMovie(a, b) {
  if (a === b) return true;
  const [x, y] = [a.split(" "), b.split(" ")].sort((p, q) => p.length - q.length);
  return x.length >= 2 && x.every((w) => y.includes(w)) && y.every((w) => x.includes(w) || /^\d+$/.test(w));
}

function contains(a, b) {
  const [x, y] = [a.split(" "), b.split(" ")].sort((p, q) => p.length - q.length);
  return x.length >= 2 && x.every((w) => y.includes(w));
}

// Collapse re-uploads of one trailer (same movie, published within a few days of each other) to the
// most viewed upload. A newer trailer for the same movie, weeks later, is a new version and stays.
export function dedupe(list, config = CONFIG) {
  const windowMs = (config.sameTrailerDays ?? 3) * 864e5;
  const kept = [];
  for (const t of [...list].sort((a, b) => b.views - a.views)) {
    const k = movieKey(t.title);
    // Game trailers often add the update's name ("The Division 2: Spearfall"), so in the games feed
    // one name containing the other counts as the same game.
    const same = (a, b) => sameMovie(a, b) || (config.category === "games" && contains(a, b));
    const dup = kept.some((o) => same(o.key, k) && Math.abs(new Date(o.t.publishedAt) - new Date(t.publishedAt)) <= windowMs);
    if (!dup) kept.push({ key: k, t });
  }
  const keep = new Set(kept.map((o) => o.t));
  return list.filter((t) => keep.has(t));
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
      if (item.id?.videoId && isTrailer(item.snippet, config)) ids.add(item.id.videoId);
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
  return found.filter((t) => t.embeddable && t.views >= config.minViews && isTrailer(t, config) && (!config.englishOnly || isEnglish(t, config)));
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
    descriptionSummary: summaryFromDescription(decode(s.description || "")),
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
    new Date(t.publishedAt) >= cutoff && isTrailer(t, config) && (!config.englishOnly || isEnglish(t, config)));
  return dedupe(kept, config)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, config.maxItems);
}

// Fill in each trailer's movie summary: TMDB's overview when a TMDB key is set (looked up once per
// movie and kept), otherwise the first prose paragraph of the YouTube description.
export async function addSummaries(trailers, { tmdbKey, fetchFn = fetch, now = new Date(), type = "movie" } = {}) {
  if (!type) tmdbKey = ""; // games: description summaries only
  const cache = new Map();
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const t of trailers) {
    // Forget earlier lookups that didn't match the movie's name exactly, so they're redone.
    if (t.tmdbId && !sameMovie(norm(t.movieTitle || ""), norm(movieName(t.title)))) {
      for (const k of ["movieTitle", "summary", "releaseDate", "tmdbId", "originalLanguage"]) delete t[k];
    }
    // Entries looked up before original language was recorded: look them up again once.
    if (t.tmdbId && t.originalLanguage === undefined) for (const k of ["movieTitle", "summary", "releaseDate", "tmdbId"]) delete t[k];
    if (t.tmdbId) cache.set(movieKey(t.title), t);
  }
  for (const t of trailers) {
    if (!t.tmdbId && tmdbKey) {
      const key = movieKey(t.title);
      if (!cache.has(key)) {
        try { cache.set(key, await lookupMovie(movieName(t.title), { tmdbKey, fetchFn, now, type })); }
        catch (e) { console.warn(e.message); cache.set(key, null); }
      }
      const m = cache.get(key);
      if (m?.isTv) t.isTv = true;
      else if (m?.isMovie) t.isMovie = true;
      else if (m) Object.assign(t, { movieTitle: m.movieTitle, summary: m.summary, releaseDate: m.releaseDate, tmdbId: m.tmdbId, originalLanguage: m.originalLanguage });
    }
    if (!t.tmdbId) {
      if (t.descriptionSummary) t.summary = t.descriptionSummary;
      else delete t.summary;
    }
  }
  return trailers;
}

// Streamers post both films and shows: drop what TMDB says belongs in the other feed. In
// English-only mode also drop titles whose original language isn't English (streamers post
// international titles with English names), and streamer uploads TMDB can't identify, since
// that's where those international titles came from.
export function dropWrongFeed(trailers, config, tmdbKey) {
  const wrongFeed = (t) => (config.category === "movies" && t.isTv) || (config.category === "tv" && t.isMovie);
  const foreign = (t) => config.englishOnly && config.tmdbType && tmdbKey && (
    (t.tmdbId && t.originalLanguage && t.originalLanguage !== "en") ||
    (!t.tmdbId && STREAMERS.has((t.channelTitle || "").toLowerCase())));
  for (let i = trailers.length - 1; i >= 0; i--) if (wrongFeed(trailers[i]) || foreign(trailers[i])) trailers.splice(i, 1);
  return trailers;
}

async function updateCategory(config, apiKey, tmdbKey, claimed = new Set()) {
  const file = path.join(ROOT, "data", config.file);
  let current = { trailers: [] };
  try { current = JSON.parse(await readFile(file, "utf8")); } catch {}
  const fresh = await findTrailers({ apiKey, config, refreshIds: (current.trailers || []).map((t) => t.id) });
  const trailers = merge(current.trailers || [], fresh, { config });
  await addSummaries(trailers, { tmdbKey, type: config.tmdbType });
  dropWrongFeed(trailers, config, tmdbKey);
  for (let i = trailers.length - 1; i >= 0; i--) if (claimed.has(trailers[i].id)) trailers.splice(i, 1);
  for (const t of trailers) claimed.add(t.id);
  const out = { updatedAt: new Date().toISOString(), count: trailers.length, trailers };
  await writeFile(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`${config.category}: found ${fresh.length} popular trailers this run; feed now has ${trailers.length}.`);
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY is not set. See README.md, section 'YouTube API key'.");
    process.exit(1);
  }
  // One feed failing (quota, a bad response) shouldn't stop the others.
  let failed = 0;
  const claimed = new Set(); // a video appears in one feed only
  for (const config of Object.values(CATEGORIES)) {
    try { await updateCategory(config, apiKey, process.env.TMDB_API_KEY, claimed); }
    catch (e) { failed++; console.error(`${config.category}: ${e.message}`); }
  }
  if (failed === Object.keys(CATEGORIES).length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
