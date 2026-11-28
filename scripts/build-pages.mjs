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
  { key: "movies", file: "trailers.json", dir: "movies", schema: "Movie", eyebrow: "Official trailer", label: "New movie trailers", noun: "movie" },
  { key: "tv", file: "tv.json", dir: "tv", schema: "TVSeries", eyebrow: "Official TV trailer", label: "New TV trailers", noun: "TV" },
  { key: "games", file: "games.json", dir: "games", schema: "VideoGame", eyebrow: "Official game trailer", label: "New game trailers", noun: "game" },
];

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
  const used = new Set(Object.values(known));
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

const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// related: other titles in the same tab, [{ slug, name, thumbnail }], linked under the trailer.
export function moviePage(m, { siteUrl, now = new Date(), section = SECTIONS[0], related = [] }) {
  const url = `${siteUrl}/${section.dir}/${m.slug}/`;
  const t = m.main;
  const year = m.releaseDate && section.key !== "tv" ? m.releaseDate.slice(0, 4) : "";
  const title = `${m.name}${year ? ` (${year})` : ""} Trailer`;
  const desc = trimDesc(m.summary || `Watch the latest official trailer for ${m.name}.`);
  const released = m.releaseDate && new Date(m.releaseDate) <= now;
  const upcoming = { movies: "In theaters", tv: "Premieres", games: "Out" }[section.key];
  const past = { movies: "Released", tv: "Premiered", games: "Released" }[section.key];
  // A show's first air date says nothing about the season being promoted, so TV pages skip it.
  const releaseLine = m.releaseDate && section.key !== "tv" ? `${released ? past : upcoming} ${fmtDate(m.releaseDate)}` : "";
  const links = linksFor({ ...t, movieTitle: m.name, releaseDate: m.releaseDate }, m.config, now, section.key);
  const ld = [
    { "@context": "https://schema.org", "@type": section.schema, name: m.name, description: m.summary || undefined,
      datePublished: m.releaseDate || undefined, image: t.thumbnail, url,
      trailer: { "@type": "VideoObject", name: t.title, description: desc, thumbnailUrl: t.thumbnail,
        uploadDate: t.publishedAt, embedUrl: `https://www.youtube.com/embed/${t.id}`,
        interactionStatistic: { "@type": "InteractionCounter", interactionType: { "@type": "WatchAction" }, userInteractionCount: t.views } } },
  ];
  const others = m.trailers.slice(1);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Trailerfeed</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${section.key === "tv" ? "video.tv_show" : section.key === "games" ? "website" : "video.movie"}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(t.thumbnail)}">
  <meta property="og:video" content="https://www.youtube.com/embed/${esc(t.id)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(t.thumbnail)}">
  <link rel="icon" href="../../favicon.ico" sizes="any">
  <link rel="icon" href="../../favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../../apple-touch-icon.png">
  <link rel="manifest" href="../../site.webmanifest">
  <meta name="theme-color" content="#0e0f13">
  <link rel="preload" href="../../fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>
  <meta property="og:site_name" content="Trailerfeed">
  <link rel="alternate" type="application/rss+xml" title="${esc(section.label)} · Trailerfeed" href="${esc(siteUrl)}/${section.dir}/feed.xml">
  <link rel="stylesheet" href="../../style.css">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  <script src="../../analytics.js" defer></script>
</head>
<body>
  <header class="top">
    <a class="brand" href="../../"><img src="../../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    <a class="updated" href="../../?tab=${section.key}">All trailers</a>
  </header>
  <main>
    <section class="hero">
      <div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(t.id)}?rel=0&amp;playsinline=1" title="${esc(t.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>
      <div class="hero-meta">
        <p class="eyebrow">${esc(section.eyebrow)}</p>
        <h1>${esc(m.name)}${year ? ` <span class="year">(${esc(year)})</span>` : ""}</h1>
        <p class="sub">${esc(t.channelTitle)}${releaseLine ? ` · <span class="release">${esc(releaseLine)}</span>` : ""}</p>
        ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ""}
        ${links.length ? `<div class="actions">${links.map((l) => `<a class="btn btn-${l.kind}" href="${esc(l.url)}" target="_blank" rel="sponsored noopener">${esc(l.label)}</a>`).join("")}</div>` : ""}
      </div>
    </section>
    ${others.length ? `<section class="feed">
      <div class="feed-head"><h2>More ${esc(m.name)} trailers</h2></div>
      <ol class="grid">${others.map((o) => `
        <li><a class="card" href="https://www.youtube.com/watch?v=${esc(o.id)}" target="_blank" rel="noopener">
          <div class="thumb"><img loading="lazy" alt="" src="${esc(o.thumbnail)}"></div>
          <h3>${esc(o.title)}</h3><p>${esc(o.channelTitle)}</p></a></li>`).join("")}
      </ol>
    </section>` : ""}
    ${related.length ? `<section class="feed">
      <div class="feed-head"><h2>More new ${esc(section.noun)} trailers</h2><a class="updated" href="../">All ${esc(section.noun)} trailers</a></div>
      <ol class="grid">${related.map((r) => `
        <li><a class="card" href="../${esc(r.slug)}/">
          <div class="thumb"><img loading="lazy" alt="" src="${esc(r.thumbnail)}"></div>
          <h3>${esc(r.name)}</h3></a></li>`).join("")}
      </ol>
    </section>` : ""}
  </main>
  <footer class="foot">
    <div class="foot-brand"><img src="../../brand/mark.svg" alt="" width="26" height="24"><span><strong>Trailerfeed</strong> · New movie, TV and game trailers, every day · <a href="mailto:help@trailerfeed.io">help@trailerfeed.io</a></span></div>
    <nav class="foot-links" aria-label="Site"><a href="../../about/">About</a><a href="../../privacy/">Privacy policy</a><a href="../../disclosure/">Affiliate disclosure</a></nav>
    <p class="disclosure">We may earn a commission from ticket and streaming links. <a href="../../disclosure/">Learn more</a></p>
    <p>Trailers are embedded from YouTube. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>
</body>
</html>
`;
}

// One hub page per tab (/movies/, /tv/, /games/) linking every title ever built, newest first.
// entries: [{ slug, name, thumbnail, lastmod, releaseDate }]
export function hubPage(section, entries, { siteUrl, now = new Date() }) {
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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Trailerfeed</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Trailerfeed">
  <meta property="og:title" content="${esc(section.label)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/brand/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(siteUrl)}/brand/og.png">
  <link rel="icon" href="../favicon.ico" sizes="any">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="../apple-touch-icon.png">
  <link rel="manifest" href="../site.webmanifest">
  <meta name="theme-color" content="#0e0f13">
  <link rel="preload" href="../fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="alternate" type="application/rss+xml" title="${esc(section.label)} · Trailerfeed" href="${esc(siteUrl)}/${section.dir}/feed.xml">
  <link rel="stylesheet" href="../style.css">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  <script src="../analytics.js" defer></script>
</head>
<body>
  <header class="top">
    <a class="brand" href="../"><img src="../brand/logo.svg" alt="Trailerfeed" width="213" height="25"></a>
    <nav class="tabs" aria-label="Trailer type">${SECTIONS.map((s) => `<a href="../${s.dir}/" aria-current="${s === section}">${esc({ movies: "Movies", tv: "TV", games: "Games" }[s.key])}</a>`).join("")}</nav>
  </header>
  <main>
    <section class="feed">
      <div class="feed-head"><h1>${esc(section.label)}</h1><a class="updated" href="../?tab=${section.key}">Watch this week's trailers</a></div>
      <ol class="grid">${entries.map((e) => `
        <li><a class="card" href="${esc(e.slug)}/">
          <div class="thumb"><img loading="lazy" alt="" src="${esc(e.thumbnail)}"></div>
          <h3>${esc(e.name)} trailer</h3>${line(e) ? `<p>${esc(line(e))}</p>` : ""}</a></li>`).join("")}
      </ol>
    </section>
  </main>
  <footer class="foot">
    <div class="foot-brand"><img src="../brand/mark.svg" alt="" width="26" height="24"><span><strong>Trailerfeed</strong> · New movie, TV and game trailers, every day · <a href="mailto:help@trailerfeed.io">help@trailerfeed.io</a></span></div>
    <nav class="foot-links" aria-label="Site"><a href="../about/">About</a><a href="../privacy/">Privacy policy</a><a href="../disclosure/">Affiliate disclosure</a><a href="feed.xml">RSS</a></nav>
    <p class="disclosure">We may earn a commission from ticket and streaming links. <a href="../disclosure/">Learn more</a></p>
    <p>Trailers are embedded from YouTube. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </footer>
</body>
</html>
`;
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

// pages: [{ dir, slug, lastmod? }]; hubs: ["movies", ...]
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

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, "config", "links.json"), "utf8"));
  const siteUrl = (process.env.SITE_URL || config.siteUrl).replace(/\/+$/, "");
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
    // Remember every title, so its page stays up after its trailers leave the feed.
    for (const m of movies) {
      const newest = m.trailers.reduce((a, t) => (t.publishedAt > a ? t.publishedAt : a), "");
      reg[m.slug] = { key: m.key, name: m.name, thumbnail: m.main.thumbnail, lastmod: newest.slice(0, 10), releaseDate: m.releaseDate || reg[m.slug]?.releaseDate || "" };
    }
    const entries = Object.entries(reg).map(([slug, e]) => ({ slug, ...e }))
      .sort((a, b) => b.lastmod.localeCompare(a.lastmod) || a.name.localeCompare(b.name));
    for (const m of movies) {
      m.config = config;
      const dir = path.join(ROOT, section.dir, m.slug);
      await mkdir(dir, { recursive: true });
      const related = entries.filter((e) => e.slug !== m.slug).slice(0, RELATED);
      await writeFile(path.join(dir, "index.html"), moviePage(m, { siteUrl, section, related }));
      for (const t of m.trailers) {
        t.movieSlug = m.slug;
        t.pagePath = `${section.dir}/${m.slug}/`;
        t.links = linksFor({ ...t, movieTitle: m.name, releaseDate: m.releaseDate }, config, new Date(), section.key);
      }
    }
    for (const e of entries) pages.push({ dir: section.dir, slug: e.slug, lastmod: e.lastmod });
    await mkdir(path.join(ROOT, section.dir), { recursive: true });
    await writeFile(path.join(ROOT, section.dir, "index.html"), hubPage(section, entries, { siteUrl }));
    hubs.push(section.dir);
    const items = movies.flatMap((m) => m.trailers.map((t) => ({ trailer: t, section, slug: m.slug, name: m.name, summary: m.summary })))
      .sort((a, b) => b.trailer.publishedAt.localeCompare(a.trailer.publishedAt));
    allItems.push(...items);
    await writeFile(path.join(ROOT, section.dir, "feed.xml"), rssFeed(items.slice(0, FEED_ITEMS), {
      siteUrl, selfPath: `${section.dir}/feed.xml`, title: `${section.label} · Trailerfeed`,
      description: `Every new official ${section.noun} trailer, updated daily.` }));
    await writeFile(dataFile, JSON.stringify(data, null, 2) + "\n");
    console.log(`${section.key}: built ${movies.length} pages (${entries.length} in total).`);
  }
  allItems.sort((a, b) => b.trailer.publishedAt.localeCompare(a.trailer.publishedAt));
  await writeFile(path.join(ROOT, "feed.xml"), rssFeed(allItems.slice(0, FEED_ITEMS), {
    siteUrl, selfPath: "feed.xml", title: "Trailerfeed: new movie, TV and game trailers",
    description: "The newest official movie, TV and video game trailers, updated daily." }));
  await writeFile(registryFile, JSON.stringify(registry, null, 1) + "\n");
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap(pages, siteUrl, updatedAt, hubs));
  await writeFile(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
