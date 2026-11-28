#!/usr/bin/env node
// Builds the SEO side of the site from the three feeds (data/trailers.json, tv.json, games.json):
//   - movies/<slug>/, tv/<slug>/ and games/<slug>/ pages (trailer, summary, release date, buttons)
//   - movies/, tv/ and games/ hub pages listing every title ever built
//   - feed.xml (all tabs) and movies/feed.xml, tv/feed.xml, games/feed.xml (RSS, for auto-posting and newsletters)
//   - sitemap.xml and robots.txt
// Title pages are permanent: data/pages.json remembers every title, so a page stays up (and keeps its URL)
// after its trailers age out of the feed.
//   - adds movieSlug and links (ticket / watch buttons) to each trailer in data/trailers.json
// Button URLs come from config/links.json, so affiliate links can be swapped in without code changes.
// Runs after fetch-trailers.mjs in the daily workflow. No dependencies.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { movieName, movieKey, sameMovie } from "./fetch-trailers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const slugify = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "movie";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Cut text to about `max` characters at a word boundary, for meta descriptions (Google shows ~155).
export function trimDesc(s = "", max = 155) {
  s = String(s).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…";
}
const fill = (tpl, q) => tpl.replace(/\{query\}/g, encodeURIComponent(q));

// The buttons for one movie, from config/links.json.
export function linksFor(t, config, now = new Date(), section = "movies") {
  const name = t.movieTitle || movieName(t.title);
  const links = [];
  if (section === "games") return links; // no game store links yet
  const stream = config.streaming?.[t.channelTitle];
  if (stream) links.push({ kind: "watch", label: stream.label, url: fill(stream.url, name) });
  const tk = config.tickets;
  if (!stream && section === "movies" && tk?.enabled && t.releaseDate) {
    const days = (new Date(t.releaseDate + "T00:00:00Z") - now) / 864e5;
    if (days <= (tk.showFromDaysBeforeRelease ?? 60) && days >= -(tk.showUntilDaysAfterRelease ?? 75)) {
      links.push({ kind: "tickets", label: tk.label, url: fill(tk.url, name) });
    }
  }
  const ww = config.whereToWatch;
  if (!stream && ww?.enabled && t.releaseDate && new Date(t.releaseDate) <= now) {
    links.push({ kind: "watch", label: ww.label, url: fill(ww.url, name) });
  }
  return links;
}

export const SECTIONS = [
  { key: "movies", file: "trailers.json", dir: "movies", schema: "Movie", eyebrow: "Official trailer", label: "New movie trailers", noun: "movie", tab: "Movies" },
  { key: "tv", file: "tv.json", dir: "tv", schema: "TVSeries", eyebrow: "Official TV trailer", label: "New TV trailers", noun: "TV", tab: "TV" },
  { key: "games", file: "games.json", dir: "games", schema: "VideoGame", eyebrow: "Official game trailer", label: "New game trailers", noun: "game", tab: "Games" },
];

// Folder names under each tab that title pages may not use.
const RESERVED = ["week", "coming-soon"];

const AGGREGATORS = new Set(["IGN", "Rotten Tomatoes Trailers", "KinoCheck.com", "FilmSelect Trailer", "Fandango", "Movieclips Trailers"]);

// Group trailers into movies (TMDB id when known, otherwise the movie's name).
// known: { [key]: slug } from data/pages.json, so a title keeps its URL across runs.
export function groupMovies(trailers, known = {}) {
  const movies = new Map();
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Trailers with a TMDB id first, so others can join their movie by name.
  for (const t of [...trailers].sort((a, b) => (b.tmdbId ? 1 : 0) - (a.tmdbId ? 1 : 0))) {
    let key = t.tmdbId ? `tmdb:${t.tmdbId}` : null;
    if (!key) {
      const k = movieKey(t.title);
      key = [...movies.entries()].find(([, m]) => sameMovie(norm(m.name), k))?.[0] || `key:${k}`;
    }
    if (!movies.has(key)) movies.set(key, { key, name: t.movieTitle || movieName(t.title), trailers: [] });
    movies.get(key).trailers.push(t);
  }
  const used = new Set([...Object.values(known), ...RESERVED]);
  for (const m of movies.values()) {
    m.trailers.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    // Lead with the newest upload from the studio itself; trailer channels (IGN, KinoCheck...) re-post.
    m.main = m.trailers.find((t) => !AGGREGATORS.has(t.channelTitle)) || m.trailers[0];
    m.trailers = [m.main, ...m.trailers.filter((t) => t !== m.main)];
    m.summary = (m.trailers.find((t) => t.tmdbId && t.summary) || m.trailers.find((t) => t.summary))?.summary || "";
    m.releaseDate = m.trailers.find((t) => t.releaseDate)?.releaseDate || "";
    if (known[m.key]) { m.slug = known[m.key]; continue; }
    let slug = slugify(m.name), n = 2;
    while (used.has(slug)) slug = `${slugify(m.name)}-${n++}`;
    used.add(slug);
    m.slug = slug;
  }
  return [...movies.values()];
}

const fmtDate = (d) => new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (d) => new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// What kind of video a trailer is, from its YouTube title ("Final trailer", "Teaser", "Season 2 trailer"...).
export function trailerType(title = "") {
  const t = title.toLowerCase();
  const season = t.match(/season (\d+)/);
  const num = t.match(/trailer\s*#?\s*(\d)\b(?!\d)/) || t.match(/\b(\d)(?:st|nd|rd|th)? (?:official )?trailer/);
  if (/final trailer/.test(t)) return "Final trailer";
  if (/teaser/.test(t)) return "Teaser";
  if (/gameplay/.test(t)) return "Gameplay trailer";
  if (/launch trailer/.test(t)) return "Launch trailer";
  if (/release date/.test(t)) return "Release date trailer";
  if (/announce/.test(t)) return "Announcement trailer";
  if (/reveal/.test(t)) return "Reveal trailer";
  if (season) return `Season ${season[1]} trailer`;
  if (num && num[1] !== "1") return `Trailer ${num[1]}`;
  if (/\bclip\b/.test(t)) return "Clip";
  if (/featurette|behind the scenes/.test(t)) return "Featurette";
  if (/official trailer/.test(t)) return "Official trailer";
  return "Trailer";
}

// Turn a stored title (data/pages.json entry, or a fresh groupMovies result) into what a page needs.
export function pageModel(e) {
  const trailers = [...(e.trailers || [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const main = trailers.find((t) => !AGGREGATORS.has(t.channelTitle)) || trailers[0];
  return { ...e, main, trailers: main ? [main, ...trailers.filter((t) => t !== main)] : [] };
}

// One factual line under the title: release, streaming service, how many trailers.
export function factsLine(m, section, config = {}, now = new Date()) {
  return factsParts(m, section, config, now).join(" ");
}
function factsParts(m, section, config = {}, now = new Date()) {
  const out = [];
  const stream = config.streaming?.[m.main?.channelTitle];
  const service = stream ? stream.label.replace(/^Watch on /, "") : "";
  const released = m.releaseDate && new Date(m.releaseDate) <= now;
  if (service) out.push(released || !m.releaseDate ? `Watch ${m.name} on ${service}.` : `${m.name} comes to ${service} on ${fmtDate(m.releaseDate)}.`);
  else if (section.key === "movies" && m.releaseDate) out.push(released ? `${m.name} came out in theaters on ${fmtDate(m.releaseDate)}; use Where to watch to find it streaming or to rent.` : `${m.name} opens in theaters on ${fmtDate(m.releaseDate)}.`);
  else if (section.key === "games" && m.releaseDate) out.push(released ? `${m.name} came out on ${fmtDate(m.releaseDate)}.` : `${m.name} comes out on ${fmtDate(m.releaseDate)}.`);
  if (m.trailers.length > 1) out.push(`There are ${m.trailers.length} official trailers for ${m.name} below, newest first.`);
  return out;
}

// Your own words about a title: content/notes/<tab>/<slug>.txt, paragraphs separated by blank lines.
const notesHtml = (notes = "") => notes.trim() ? notes.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p.replace(/\s+/g, " "))}</p>`).join("\n        ") : "";

const head = ({ depth, title, desc, url, image, ogType = "website", section, ld, extra = "" }) => {
  const up = "../".repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Trailerfeed</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="Trailerfeed">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image)}">${extra}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(image)}">
  <link rel="icon" href="${up}favicon.ico" sizes="any">
  <link rel="icon" href="${up}favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${up}apple-touch-icon.png">
  <link rel="manifest" href="${up}site.webmanifest">
  <meta name="theme-color" content="#0e0f13">
  <link rel="preload" href="${up}fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="alternate" type="application/rss+xml" title="${esc(section.label)} · Trailerfeed" href="${esc(url.replace(/(\/(movies|tv|games)\/).*$/, "$1"))}feed.xml">
  <link rel="stylesheet" href="${up}style.css">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  <script src="${up}analytics.js" defer></script>
</head>`;
};

const tabsNav = (section, up) => `<nav class="tabs" aria-label="Trailer type">${SECTIONS.map((s) => `<a href="${up}${s.dir}/" aria-current="${s === section}">${esc(s.tab)}</a>`).join("")}</nav>`;

const footer = (up) => `  <footer class="foot">
    <div class="foot-brand"><img src="${up}brand/mark.svg" alt="" width="26" height="24"><span><strong>Trailerfeed</strong> · New movie, TV and game trailers, every day · <a href="mailto:help@trailerfeed.io">help@trailerfeed.io</a></span></div>
    <nav class="foot-links" aria-label="Site"><a href="${up}movies/">All movie trailers</a><a href="${up}tv/">All TV trailers</a><a href="${up}games/">All game trailers</a><a href="${up}about/">About</a><a href="${up}privacy/">Privacy policy</a><a href="${up}disclosure/">Affiliate disclosure</a><a href="${up}feed.xml">RSS</a></nav>
    <p class="disclosure">We may earn a commission from ticket and streaming links. <a href="${up}disclosure/">Learn more</a></p>
    <p>Trailers are embedded from YouTube. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>
</body>
</html>
`;

const card = (href, img, h, p, external = false) => `
        <li><a class="card" href="${esc(href)}"${external ? ` target="_blank" rel="noopener"` : ""}>
          <div class="thumb"><img loading="lazy" alt="" src="${esc(img)}"></div>
          <h3>${esc(h)}</h3>${p ? `<p>${esc(p)}</p>` : ""}</a></li>`;

// The title page. m: a pageModel. related: other titles in the same tab, [{ slug, name, thumbnail }].
export function moviePage(m, { siteUrl, now = new Date(), section = SECTIONS[0], related = [], notes = "" }) {
  const url = `${siteUrl}/${section.dir}/${m.slug}/`;
  const t = m.main;
  const year = m.releaseDate && section.key !== "tv" ? m.releaseDate.slice(0, 4) : "";
  const gameplay = section.key === "games" && m.trailers.some((x) => trailerType(x.title) === "Gameplay trailer");
  const title = `${m.name}${year ? ` (${year})` : ""} ${gameplay ? "Gameplay Trailer" : "Trailer"}`;
  const kind = trailerType(t.title);
  const facts = factsLine(m, section, m.config, now);
  const firstFact = (factsParts(m, section, m.config, now)[0] || "").replace(/;.*$/, ".");
  const desc = trimDesc(`Watch the ${kind.toLowerCase()} for ${m.name}. ${firstFact} ${m.summary || ""}`);
  const released = m.releaseDate && new Date(m.releaseDate) <= now;
  const upcoming = { movies: "In theaters", tv: "Premieres", games: "Out" }[section.key];
  const past = { movies: "Released", tv: "Premiered", games: "Released" }[section.key];
  // A show's first air date says nothing about the season being promoted, so TV pages skip it.
  const releaseLine = m.releaseDate && section.key !== "tv" ? `${released ? past : upcoming} ${fmtDate(m.releaseDate)}` : "";
  const links = linksFor({ ...t, movieTitle: m.name, releaseDate: m.releaseDate }, m.config, now, section.key);
  const video = (x) => ({ "@type": "VideoObject", name: x.title, description: trimDesc(m.summary || x.title, 300), thumbnailUrl: x.thumbnail,
    uploadDate: x.publishedAt, embedUrl: `https://www.youtube.com/embed/${x.id}`,
    ...(x.views ? { interactionStatistic: { "@type": "InteractionCounter", interactionType: { "@type": "WatchAction" }, userInteractionCount: x.views } } : {}) });
  const ld = [
    { "@context": "https://schema.org", "@type": section.schema, name: m.name, description: m.summary || undefined,
      datePublished: m.releaseDate || undefined, image: t.thumbnail, url, trailer: video(t) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: section.label, item: `${siteUrl}/${section.dir}/` },
      { "@type": "ListItem", position: 2, name: m.name, item: url } ] },
  ];
  const others = m.trailers.slice(1);
  const about = notesHtml(notes);
  return `${head({ depth: 2, title, desc, url, image: t.thumbnail, section, ld,
    ogType: section.key === "tv" ? "video.tv_show" : section.key === "games" ? "website" : "video.movie",
    extra: `\n  <meta property="og:video" content="https://www.youtube.com/embed/${esc(t.id)}">` })}
<body>
  <header class="top">
    <a class="brand" href="../../"><img src="../../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    <a class="updated" href="../../?tab=${section.key}">All trailers</a>
  </header>
  <main>
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">${esc(section.label)}</a> › <span>${esc(m.name)}</span></nav>
    <section class="hero">
      <div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(t.id)}?rel=0&amp;playsinline=1" title="${esc(t.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>
      <div class="hero-meta">
        <p class="eyebrow">${esc(section.eyebrow)} · ${esc(kind)}</p>
        <h1>${esc(m.name)}${year ? ` <span class="year">(${esc(year)})</span>` : ""}</h1>
        <p class="sub">${esc(t.channelTitle)}${releaseLine ? ` · <span class="release">${esc(releaseLine)}</span>` : ""}</p>
        ${facts ? `<p class="facts">${esc(facts)}</p>` : ""}
        ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ""}
        ${links.length ? `<div class="actions">${links.map((l) => `<a class="btn btn-${l.kind}" href="${esc(l.url)}" target="_blank" rel="sponsored noopener">${esc(l.label)}</a>`).join("")}</div>` : ""}
      </div>
    </section>
    ${about ? `<section class="about-title">
      <h2>About ${esc(m.name)}</h2>
        ${about}
    </section>` : ""}
    ${others.length ? `<section class="feed">
      <div class="feed-head"><h2>More ${esc(m.name)} trailers</h2></div>
      <ol class="grid">${others.map((o) => card(`https://www.youtube.com/watch?v=${o.id}`, o.thumbnail, `${trailerType(o.title)}: ${o.title}`, `${o.channelTitle} · ${shortDate(o.publishedAt)}`, true)).join("")}
      </ol>
    </section>` : ""}
    ${related.length ? `<section class="feed">
      <div class="feed-head"><h2>More new ${esc(section.noun)} trailers</h2><a class="updated" href="../">All ${esc(section.noun)} trailers</a></div>
      <ol class="grid">${related.map((r) => card(`../${r.slug}/`, r.thumbnail, r.name)).join("")}
      </ol>
    </section>` : ""}
  </main>
${footer("../../")}`;
}

// Monday (UTC) of the week a date falls in, as YYYY-MM-DD. Matches the home page's weekly groups.
export function weekOf(d) {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - day)).toISOString().slice(0, 10);
}

// weeks: [{ week: "YYYY-MM-DD", items: [{ trailer, slug, name }] }], newest first.
export function weekPage(section, w, { siteUrl, prev, next }) {
  const url = `${siteUrl}/${section.dir}/week/${w.week}/`;
  const end = new Date(Date.parse(w.week) + 6 * 864e5).toISOString().slice(0, 10);
  const names = [...new Set(w.items.map((i) => i.name))];
  const title = `New ${section.noun} trailers, week of ${shortDate(w.week)}`;
  const lead = `${w.items.length} new official ${section.noun} trailer${w.items.length === 1 ? "" : "s"} came out between ${fmtDate(w.week)} and ${fmtDate(end)}${names.length ? `, including ${names.slice(0, 3).join(", ")}` : ""}.`;
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url, datePublished: w.week,
    mainEntity: { "@type": "ItemList", itemListElement: w.items.map((i, n) => ({ "@type": "ListItem", position: n + 1, url: `${siteUrl}/${section.dir}/${i.slug}/`, name: i.trailer.title })) } };
  return `${head({ depth: 3, title, desc: trimDesc(lead), url, image: w.items[0]?.trailer.thumbnail || `${siteUrl}/brand/og.png`, section, ld })}
<body>
  <header class="top">
    <a class="brand" href="../../../"><img src="../../../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    ${tabsNav(section, "../../../")}
  </header>
  <main>
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../../">${esc(section.label)}</a> › <span>Week of ${esc(shortDate(w.week))}</span></nav>
    <section class="feed">
      <div class="feed-head"><h1>${esc(title)}</h1></div>
      <p class="lead">${esc(lead)}</p>
      <ol class="grid">${w.items.map((i) => card(`../../${i.slug}/`, i.trailer.thumbnail, `${i.name}: ${trailerType(i.trailer.title)}`, `${i.trailer.channelTitle} · ${shortDate(i.trailer.publishedAt)}`)).join("")}
      </ol>
      <p class="pager">${prev ? `<a href="../${prev}/">← Week of ${esc(shortDate(prev))}</a>` : ""}${next ? `<a href="../${next}/">Week of ${esc(shortDate(next))} →</a>` : ""}</p>
    </section>
  </main>
${footer("../../../")}`;
}

// Upcoming releases by month: /movies/coming-soon/ and /games/coming-soon/. entries: [{ slug, name, thumbnail, releaseDate }]
export function comingSoonPage(section, entries, { siteUrl, now = new Date() }) {
  const url = `${siteUrl}/${section.dir}/coming-soon/`;
  const today = now.toISOString().slice(0, 10);
  const list = entries.filter((e) => e.releaseDate && e.releaseDate > today).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name));
  const months = new Map();
  for (const e of list) {
    const k = new Date(e.releaseDate.slice(0, 7) + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(e);
  }
  const what = section.key === "games" ? "games" : "movies";
  const title = `Upcoming ${what} and their trailers`;
  const first = [...months.keys()][0];
  const desc = trimDesc(`Release dates and trailers for upcoming ${what}${first ? `, starting with ${first}` : ""}: ${list.slice(0, 4).map((e) => e.name).join(", ")}.`);
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url,
    mainEntity: { "@type": "ItemList", itemListElement: list.map((e, n) => ({ "@type": "ListItem", position: n + 1, url: `${siteUrl}/${section.dir}/${e.slug}/`, name: e.name })) } };
  const verb = section.key === "games" ? "Out" : "In theaters";
  return `${head({ depth: 2, title, desc, url, image: `${siteUrl}/brand/og.png`, section, ld })}
<body>
  <header class="top">
    <a class="brand" href="../../"><img src="../../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    ${tabsNav(section, "../../")}
  </header>
  <main>
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">${esc(section.label)}</a> › <span>Coming soon</span></nav>
    <section class="feed">
      <div class="feed-head"><h1>${esc(title)}</h1></div>
      <p class="lead">${list.length ? `${list.length} upcoming ${what} with official trailers, soonest first.` : `No upcoming ${what} with trailers right now. Check back soon.`}</p>
    </section>${[...months.entries()].map(([month, items]) => `
    <section class="feed">
      <div class="feed-head"><h2>${esc(month)}</h2></div>
      <ol class="grid">${items.map((e) => card(`../${e.slug}/`, e.thumbnail, e.name, `${verb} ${fmtDate(e.releaseDate)}`)).join("")}
      </ol>
    </section>`).join("")}
  </main>
${footer("../../")}`;
}

// One hub page per tab (/movies/, /tv/, /games/) linking every title ever built, newest first.
// entries: [{ slug, name, thumbnail, lastmod, releaseDate }]; weeks: ["YYYY-MM-DD", ...] newest first.
export function hubPage(section, entries, { siteUrl, now = new Date(), weeks = [], comingSoon = false }) {
  const url = `${siteUrl}/${section.dir}/`;
  const title = `${section.label}: every official ${section.noun} trailer`;
  const desc = trimDesc(`Every new official ${section.noun} trailer in one place, newest first, updated daily. ${entries.slice(0, 4).map((e) => e.name).join(", ")} and more.`);
  const upcoming = { movies: "In theaters", tv: "", games: "Out" }[section.key];
  const line = (e) => {
    if (!e.releaseDate || !upcoming) return "";
    return new Date(e.releaseDate) > now ? `${upcoming} ${fmtDate(e.releaseDate)}` : `Released ${fmtDate(e.releaseDate)}`;
  };
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url,
    mainEntity: { "@type": "ItemList", itemListElement: entries.slice(0, 100).map((e, i) => ({ "@type": "ListItem", position: i + 1, url: `${url}${e.slug}/`, name: e.name })) } };
  return `${head({ depth: 1, title, desc, url, image: `${siteUrl}/brand/og.png`, section, ld })}
<body>
  <header class="top">
    <a class="brand" href="../"><img src="../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    ${tabsNav(section, "../")}
  </header>
  <main>
    <section class="feed">
      <div class="feed-head"><h1>${esc(section.label)}</h1><a class="updated" href="../?tab=${section.key}">Watch this week's trailers</a></div>
      ${weeks.length || comingSoon ? `<p class="hub-links">${comingSoon ? `<a href="coming-soon/">Coming soon</a>` : ""}${weeks.slice(0, 8).map((w) => `<a href="week/${w}/">Week of ${esc(shortDate(w))}</a>`).join("")}</p>` : ""}
      <ol class="grid">${entries.map((e) => card(`${e.slug}/`, e.thumbnail, `${e.name} trailer`, line(e))).join("")}
      </ol>
    </section>
    ${weeks.length > 8 ? `<section class="feed">
      <div class="feed-head"><h2>Older weeks</h2></div>
      <p class="hub-links">${weeks.slice(8).map((w) => `<a href="week/${w}/">Week of ${esc(shortDate(w))}</a>`).join("")}</p>
    </section>` : ""}
  </main>
${footer("../")}`;
}

// RSS 2.0 feed of the newest trailers, each linking to its title page.
// items: [{ trailer, section, slug, summary }], newest first.
export function rssFeed(items, { siteUrl, title, selfPath, description }) {
  const x = (s = "") => esc(s).replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>${x(title)}</title>
  <link>${x(siteUrl)}/</link>
  <description>${x(description)}</description>
  <language>en-us</language>
  <atom:link href="${x(siteUrl)}/${x(selfPath)}" rel="self" type="application/rss+xml"/>
${items.map(({ trailer: t, section, slug, summary }) => {
  const link = `${siteUrl}/${section.dir}/${slug}/`;
  const text = trimDesc(summary || "", 280);
  return `  <item>
    <title>${x(t.title)}</title>
    <link>${x(link)}</link>
    <guid isPermaLink="false">youtube:${x(t.id)}</guid>
    <pubDate>${new Date(t.publishedAt).toUTCString()}</pubDate>
    <category>${x(section.noun)}</category>
    <description>${x(`<p><img src="${t.thumbnail}" alt=""></p>${text ? `<p>${esc(text)}</p>` : ""}<p>${esc(t.channelTitle)}</p>`)}</description>
    <media:thumbnail url="${x(t.thumbnail)}"/>
  </item>`;
}).join("\n")}
</channel>
</rss>
`;
}

// pages: [{ dir, slug, lastmod? }] (slug may be a path like "week/2026-11-23"); hubs: ["movies", ...]
export function sitemap(pages, siteUrl, updatedAt, hubs = []) {
  const day = (updatedAt || new Date().toISOString()).slice(0, 10);
  const urls = [
    [`${siteUrl}/`, day],
    ...hubs.map((d) => [`${siteUrl}/${d}/`, day]),
    ...["about", "privacy", "disclosure"].map((p) => [`${siteUrl}/${p}/`, ""]),
    ...pages.map((p) => [`${siteUrl}/${p.dir || "movies"}/${p.slug}/`, p.lastmod || day]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${esc(u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}

const RELATED = 8;
const FEED_ITEMS = 50;
const KEEP_TRAILERS = 20;
// Only what pages need, so data/pages.json stays small.
const slim = (t) => ({ id: t.id, title: t.title, channelTitle: t.channelTitle, publishedAt: t.publishedAt, thumbnail: t.thumbnail, views: t.views || 0 });

async function readText(file) { try { return await readFile(file, "utf8"); } catch { return ""; } }

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, "config", "links.json"), "utf8"));
  const siteUrl = (process.env.SITE_URL || config.siteUrl).replace(/\/+$/, "");
  const now = new Date();
  const registryFile = path.join(ROOT, "data", "pages.json");
  let registry = {};
  try { registry = JSON.parse(await readFile(registryFile, "utf8")); } catch {}
  const pages = [], hubs = [], allItems = [];
  let updatedAt = "";
  for (const section of SECTIONS) {
    const dataFile = path.join(ROOT, "data", section.file);
    let data;
    try { data = JSON.parse(await readFile(dataFile, "utf8")); } catch { continue; }
    if (data.updatedAt > updatedAt) updatedAt = data.updatedAt;
    const reg = (registry[section.key] ||= {});
    const known = Object.fromEntries(Object.entries(reg).map(([slug, e]) => [e.key, slug]));
    const movies = groupMovies(data.trailers || [], known);
    // Trailers older than anything in the feed have aged out of it; keep them on their title's page.
    const oldest = (data.trailers || []).reduce((a, t) => (!a || t.publishedAt < a ? t.publishedAt : a), "");
    // Remember every title, so its page stays up (and keeps its trailers) after they leave the feed.
    for (const m of movies) {
      const prev = reg[m.slug] || {};
      const aged = (prev.trailers || []).filter((t) => t.publishedAt < oldest && !m.trailers.some((x) => x.id === t.id));
      const trailers = [...m.trailers.map(slim), ...aged].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, KEEP_TRAILERS);
      reg[m.slug] = { key: m.key, name: m.name, thumbnail: m.main.thumbnail, lastmod: trailers[0].publishedAt.slice(0, 10),
        releaseDate: m.releaseDate || prev.releaseDate || "", summary: m.summary || prev.summary || "", trailers };
    }
    const entries = Object.entries(reg).map(([slug, e]) => ({ slug, ...e }))
      .sort((a, b) => b.lastmod.localeCompare(a.lastmod) || a.name.localeCompare(b.name));
    // Rebuild every title page, so ticket windows, related links and notes stay current on old pages too.
    for (const e of entries) {
      if (!e.trailers?.length) continue;
      const m = { ...pageModel(e), config };
      const dir = path.join(ROOT, section.dir, e.slug);
      await mkdir(dir, { recursive: true });
      const related = entries.filter((r) => r.slug !== e.slug).slice(0, RELATED);
      const notes = await readText(path.join(ROOT, "content", "notes", section.dir, `${e.slug}.txt`));
      await writeFile(path.join(dir, "index.html"), moviePage(m, { siteUrl, now, section, related, notes }));
      pages.push({ dir: section.dir, slug: e.slug, lastmod: e.lastmod });
    }
    for (const m of movies) {
      for (const t of m.trailers) {
        t.movieSlug = m.slug;
        t.pagePath = `${section.dir}/${m.slug}/`;
        t.links = linksFor({ ...t, movieTitle: m.name, releaseDate: m.releaseDate }, config, now, section.key);
      }
    }
    // Weekly roundups from every remembered trailer.
    const byWeek = new Map();
    for (const e of entries) for (const t of e.trailers || []) {
      const w = weekOf(t.publishedAt);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w).push({ trailer: t, slug: e.slug, name: e.name });
    }
    const weeks = [...byWeek.keys()].sort().reverse();
    for (const [i, w] of weeks.entries()) {
      const items = byWeek.get(w).sort((a, b) => (b.trailer.views || 0) - (a.trailer.views || 0));
      const dir = path.join(ROOT, section.dir, "week", w);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), weekPage(section, { week: w, items }, { siteUrl, prev: weeks[i + 1], next: weeks[i - 1] }));
      const newest = items.reduce((a, x) => (x.trailer.publishedAt > a ? x.trailer.publishedAt : a), "");
      pages.push({ dir: section.dir, slug: `week/${w}`, lastmod: newest.slice(0, 10) });
    }
    const comingSoon = section.key !== "tv";
    if (comingSoon) {
      await mkdir(path.join(ROOT, section.dir, "coming-soon"), { recursive: true });
      await writeFile(path.join(ROOT, section.dir, "coming-soon", "index.html"), comingSoonPage(section, entries, { siteUrl, now }));
      pages.push({ dir: section.dir, slug: "coming-soon", lastmod: updatedAt.slice(0, 10) });
    }
    await writeFile(path.join(ROOT, section.dir, "index.html"), hubPage(section, entries, { siteUrl, now, weeks, comingSoon }));
    hubs.push(section.dir);
    const items = movies.flatMap((m) => m.trailers.map((t) => ({ trailer: t, section, slug: m.slug, summary: m.summary })))
      .sort((a, b) => b.trailer.publishedAt.localeCompare(a.trailer.publishedAt));
    allItems.push(...items);
    await writeFile(path.join(ROOT, section.dir, "feed.xml"), rssFeed(items.slice(0, FEED_ITEMS), {
      siteUrl, selfPath: `${section.dir}/feed.xml`, title: `${section.label} · Trailerfeed`,
      description: `Every new official ${section.noun} trailer, updated daily.` }));
    await writeFile(dataFile, JSON.stringify(data, null, 2) + "\n");
    console.log(`${section.key}: ${movies.length} titles in the feed, ${entries.length} title pages, ${weeks.length} weekly pages.`);
  }
  allItems.sort((a, b) => b.trailer.publishedAt.localeCompare(a.trailer.publishedAt));
  await writeFile(path.join(ROOT, "feed.xml"), rssFeed(allItems.slice(0, FEED_ITEMS), {
    siteUrl, selfPath: "feed.xml", title: "Trailerfeed: new movie, TV and game trailers",
    description: "The newest official movie, TV and video game trailers, updated daily." }));
  await writeFile(registryFile, JSON.stringify(registry) + "\n");
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap(pages, siteUrl, updatedAt, hubs));
  await writeFile(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
