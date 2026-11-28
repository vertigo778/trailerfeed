#!/usr/bin/env node
// Builds the SEO side of the site from the three feeds (data/trailers.json, tv.json, games.json):
//   - movies/<slug>/, tv/<slug>/ and games/<slug>/ pages (trailer, summary, release date, buttons)
//   - sitemap.xml and robots.txt
//   - adds movieSlug and links (ticket / watch buttons) to each trailer in data/trailers.json
// Button URLs come from config/links.json, so affiliate links can be swapped in without code changes.
// Runs after fetch-trailers.mjs in the daily workflow. No dependencies.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { movieName, movieKey, sameMovie } from "./fetch-trailers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const slugify = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "movie";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  { key: "movies", file: "trailers.json", dir: "movies", schema: "Movie", eyebrow: "Official trailer" },
  { key: "tv", file: "tv.json", dir: "tv", schema: "TVSeries", eyebrow: "Official TV trailer" },
  { key: "games", file: "games.json", dir: "games", schema: "VideoGame", eyebrow: "Official game trailer" },
];

const AGGREGATORS = new Set(["IGN", "Rotten Tomatoes Trailers", "KinoCheck.com", "FilmSelect Trailer", "Fandango", "Movieclips Trailers"]);

// Group trailers into movies (TMDB id when known, otherwise the movie's name).
export function groupMovies(trailers) {
  const movies = new Map();
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Trailers with a TMDB id first, so others can join their movie by name.
  for (const t of [...trailers].sort((a, b) => (b.tmdbId ? 1 : 0) - (a.tmdbId ? 1 : 0))) {
    let key = t.tmdbId ? `tmdb:${t.tmdbId}` : null;
    if (!key) {
      const k = movieKey(t.title);
      key = [...movies.entries()].find(([, m]) => sameMovie(norm(m.name), k))?.[0] || `key:${k}`;
    }
    if (!movies.has(key)) movies.set(key, { name: t.movieTitle || movieName(t.title), trailers: [] });
    movies.get(key).trailers.push(t);
  }
  const used = new Set();
  for (const m of movies.values()) {
    m.trailers.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    // Lead with the newest upload from the studio itself; trailer channels (IGN, KinoCheck...) re-post.
    m.main = m.trailers.find((t) => !AGGREGATORS.has(t.channelTitle)) || m.trailers[0];
    m.trailers = [m.main, ...m.trailers.filter((t) => t !== m.main)];
    m.summary = (m.trailers.find((t) => t.tmdbId && t.summary) || m.trailers.find((t) => t.summary))?.summary || "";
    m.releaseDate = m.trailers.find((t) => t.releaseDate)?.releaseDate || "";
    let slug = slugify(m.name), n = 2;
    while (used.has(slug)) slug = `${slugify(m.name)}-${n++}`;
    used.add(slug);
    m.slug = slug;
  }
  return [...movies.values()];
}

const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function moviePage(m, { siteUrl, now = new Date(), section = SECTIONS[0] }) {
  const url = `${siteUrl}/${section.dir}/${m.slug}/`;
  const t = m.main;
  const year = m.releaseDate && section.key !== "tv" ? m.releaseDate.slice(0, 4) : "";
  const title = `${m.name}${year ? ` (${year})` : ""} Trailer`;
  const desc = (m.summary || `Watch the latest official trailer for ${m.name}.`).slice(0, 300);
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
  <link rel="stylesheet" href="../../style.css">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
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

// pages: [{ dir, slug }]
export function sitemap(pages, siteUrl, updatedAt) {
  const day = (updatedAt || new Date().toISOString()).slice(0, 10);
  const urls = [`${siteUrl}/`, ...["about", "privacy", "disclosure"].map((p) => `${siteUrl}/${p}/`), ...pages.map((p) => `${siteUrl}/${p.dir || "movies"}/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${day}</lastmod></url>`).join("\n")}
</urlset>
`;
}

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, "config", "links.json"), "utf8"));
  const siteUrl = (process.env.SITE_URL || config.siteUrl).replace(/\/+$/, "");
  const pages = [];
  let updatedAt = "";
  for (const section of SECTIONS) {
    const dataFile = path.join(ROOT, "data", section.file);
    let data;
    try { data = JSON.parse(await readFile(dataFile, "utf8")); } catch { continue; }
    if (data.updatedAt > updatedAt) updatedAt = data.updatedAt;
    const movies = groupMovies(data.trailers || []);
    await rm(path.join(ROOT, section.dir), { recursive: true, force: true });
    for (const m of movies) {
      m.config = config;
      const dir = path.join(ROOT, section.dir, m.slug);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), moviePage(m, { siteUrl, section }));
      for (const t of m.trailers) {
        t.movieSlug = m.slug;
        t.pagePath = `${section.dir}/${m.slug}/`;
        t.links = linksFor({ ...t, movieTitle: m.name, releaseDate: m.releaseDate }, config, new Date(), section.key);
      }
      pages.push({ dir: section.dir, slug: m.slug });
    }
    await writeFile(dataFile, JSON.stringify(data, null, 2) + "\n");
    console.log(`${section.key}: built ${movies.length} pages.`);
  }
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap(pages, siteUrl, updatedAt));
  await writeFile(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
