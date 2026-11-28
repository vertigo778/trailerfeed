# Trailerfeed

A static website that shows the newest popular movie, TV and video game trailers from YouTube, in three tabs. The newest trailer is embedded at the top of the page; the rest are listed below, sortable by newest or most viewed.

There is no server. A GitHub Action runs once a day, asks the YouTube Data API for new popular official trailers, and commits the results to `data/trailers.json`. Cloudflare Pages (or GitHub Pages) serves the site, which reads that file.

```
index.html, style.css, app.js     the site
_headers                          cache rules for Cloudflare
wrangler.jsonc, .assetsignore     Cloudflare Workers config (static files, plus branch previews)
data/trailers.json                the feed (written by the Action)
scripts/fetch-trailers.mjs        the daily YouTube search (Node 20+, no dependencies)
scripts/build-pages.mjs           builds title pages, hub pages, RSS feeds, sitemap.xml and robots.txt
data/pages.json                   every title page ever built, so pages stay up after trailers leave the feed
content/notes/<tab>/<slug>.txt    optional: your own paragraphs for a title page
config/links.json                 "Get tickets" / "Watch on" / "Where to watch" button links
scripts/test/                     unit tests and sample data for local previews
.github/workflows/update-trailers.yml   the daily job
```

## Setup

### 1. YouTube API key

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and create a project (or pick one).
2. Open **APIs & Services → Library**, find **YouTube Data API v3**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key and, under **API restrictions**, choose **Restrict key** and tick only **YouTube Data API v3**. Leave application restrictions as "None" (the key is used from GitHub's servers, not a browser).

The API is free. The default quota is 10,000 units a day; one run of this job uses about 400–410 units (4 searches at 100 units each, plus a few cheap lookups).

### 2. Add the key as a repository secret

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `YOUTUBE_API_KEY`
- Secret: the key from step 1

The key is only ever read by the Action. It never goes into the site or the repo.

### 2b. (Optional) TMDB key for movie summaries

Each trailer shows a short plot summary. Without a TMDB key, it comes from the first plot-like paragraph of the YouTube description, which many uploads don't have. With a key, it comes from [The Movie Database](https://www.themoviedb.org/), which also adds the release date.

1. Create a free account at themoviedb.org, then go to **Settings → API** and request an API key (choose "Developer", personal use).
2. Copy the **API Key** (or the longer **API Read Access Token**; either works).
3. Add it as a repository secret named `TMDB_API_KEY`.

Each movie is looked up once and the result is kept, so this uses very few requests.

### 3. Host it: Cloudflare Pages (recommended) or GitHub Pages

The site is plain files with relative paths, so either host works, and both can run at once. Both are free.

**Cloudflare Pages**

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize GitHub and pick this repository.
3. Build settings: Framework preset **None**, Build command **empty**, Build output directory **`/`**. Production branch **main**.
4. Click **Save and Deploy**. The site will be at `https://<project-name>.pages.dev/`. To use your own domain, open the project's **Custom domains** tab.

Cloudflare redeploys on every push to `main`, including the daily data commit, so the feed updates on its own. That's about 30 deploys a month, well under the free plan's 500 builds. `_headers` tells Cloudflare to cache `data/trailers.json` for only 5 minutes, so new trailers show up quickly.

**GitHub Pages**

**Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**. The site will be at `https://<your-user>.github.io/<repo>/`.

### 4. Run the first update

**Actions → Update trailers → Run workflow**. After that it runs daily at 09:17 UTC. Each run commits the updated `data/trailers.json`, and Cloudflare (or GitHub Pages) republishes automatically.

If the workflow can't push, check **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

## Movies, TV and Games tabs

The daily job fills three feeds: `data/trailers.json` (movies), `data/tv.json` and `data/games.json`. Each one has its own searches, its own channel list and its own filters, set in `CATEGORIES` in `scripts/fetch-trailers.mjs`:

- **TV:** channels are streamers and networks (Netflix, HBO Max, Apple TV, Prime Video, Disney+, Hulu, FX, AMC...). Summaries come from TMDB's TV search, and anything TMDB knows only as a film is dropped.
- **Games:** channels are publishers and platforms (PlayStation, Xbox, Nintendo of America, Ubisoft, EA, Rockstar, Capcom...). Summaries come from YouTube descriptions, and there are no store buttons yet.
- IGN, GameSpot and the other trailer channels post every kind of trailer. In the TV and Games tabs, their uploads only count when the title says what they are ("Season 2", "Gameplay Trailer", "PS5"...).

All three feeds together use about 1,100 of the 10,000 free YouTube API units a day. The repo variables `TV_CHANNELS`, `GAMES_CHANNELS`, `TV_QUERIES`, `GAMES_QUERIES`, `TV_MIN_VIEWS` and `GAMES_MIN_VIEWS` override the defaults. Pages are built at `/tv/<slug>/` and `/games/<slug>/` too.

English-only also checks TMDB's original language. A streamer title that isn't originally in English is dropped, and so is a streamer upload TMDB can't identify.

## How trailers are picked

Each day the script searches YouTube for videos uploaded in the last 7 days matching a few queries ("official trailer", "official teaser trailer", and so on), ordered by view count. It keeps videos that:

- have "trailer" or "teaser" in the title,
- don't look like reactions, fan edits, commentary, clickbait (emoji or "!" titles), game, music or TV trailers, or Shorts,
- come from a known US studio, streamer or trailer channel (Marvel, Warner Bros., Universal, Paramount, A24, Netflix, IGN, and so on; the full list is `channels` in `scripts/fetch-trailers.mjs`) and look English (title script, no dub markers, YouTube's audio language when set). Uploaders' language tags alone proved unreliable,
- can be embedded, and
- have at least 100,000 views.

When the same trailer is uploaded by several channels within a few days (the studio, IGN, KinoCheck and so on), only the most viewed upload is kept. A new trailer for the same movie later on (a second trailer, a final trailer) is added as its own entry, so the feed picks up every new Dune or Doomsday trailer.

Trailers stay in the feed for 26 weeks (up to 1,000 per tab), so history builds up over time. The site groups them by the week they came out ("This week", "Last week", "Week of Nov 9"…), shows four weeks at first and loads four more with **Show older weeks**. Each run also re-checks trailers already in the feed, so view counts stay current and stricter rules clean out older entries.

### Filling in past weeks (backfill)

The daily run only searches the last 7 days. To fill in earlier weeks, open **Actions → Update trailers → Run workflow** and enter weeks in **backfill_weeks**, for example `1-6` (one to six weeks ago). Each past week is searched on its own, so every week gets its own most-viewed trailers.

Each week costs about 1,100 of YouTube's 10,000 free daily quota units (11 searches across the three tabs), and the daily run uses about 1,100 more. So backfill at most about 7 weeks per day, for example `1-6` one day and `7-12` the next. If the quota runs out midway, the weeks already searched are kept, and the quota resets at midnight Pacific time.

You can tune this without editing code by adding repository **variables** (**Settings → Secrets and variables → Actions → Variables**), which the workflow already passes through: `SEARCH_WINDOW_DAYS`, `KEEP_DAYS`, `MIN_VIEWS`, `MAX_ITEMS`, `REGION_CODE`, `QUERIES` (separated by `|`), `ENGLISH_ONLY` (set to `false` to include every language and any channel), and `CHANNELS` (your own channel list, names separated by `|`), and `SAME_TRAILER_DAYS` (how close together two uploads of one movie must be to count as the same trailer, default 3).

## Movie pages and buttons

After each daily fetch, `scripts/build-pages.mjs` writes one page per movie at `/movies/<slug>/`. Each page has the trailer, summary and release date, a proper title and description, Open Graph and Twitter tags for link previews, and schema.org `Movie` data for search engines. It also writes `sitemap.xml` and `robots.txt`. Submit `https://<your-site>/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) so the pages get indexed.

Pages are permanent. `data/pages.json` remembers every title with its URL, so when a trailer ages out of the feed its page stays up with the last version it had, and a title that comes back keeps its old URL. To remove a page, delete its folder and its entry in `data/pages.json`.

The script also writes:

- **Hub pages** at `/movies/`, `/tv/` and `/games/`, listing every title newest first, linked from the home page footer and from each title page.
- **More new trailers** on every title page: links to the 8 newest other titles in the same tab.
- **RSS feeds**: `/feed.xml` (all tabs) and `/movies/feed.xml`, `/tv/feed.xml`, `/games/feed.xml`, 50 newest trailers each, linking to title pages. Auto-posting and newsletter tools can read these.
- **Sitemap dates** per page: the upload date of the title's newest trailer, so search engines can tell which pages are new.
- **Weekly roundups** at `/movies/week/<monday>/` (and `/tv/`, `/games/`): every trailer that came out that week, most viewed first, with links to the weeks before and after. Weeks start on Monday, like the home page.
- **Coming soon** at `/movies/coming-soon/` and `/games/coming-soon/`: upcoming releases grouped by month, soonest first.
- On each title page: the kind of each trailer (Teaser, Final trailer, Season 2 trailer, Gameplay trailer...), a fact line (release date or streaming service, number of trailers), breadcrumbs, and a description that leads with those facts.

`data/pages.json` keeps up to 20 trailers per title, so pages and weekly roundups keep their trailers after they leave the feed, and every page is rebuilt each day (ticket windows and links stay current).

### Your own words on a title page

Google ranks pages with original text above pages that only repeat a summary. To add a few sentences of your own (cast, director, what the trailer shows), create `content/notes/<tab>/<slug>.txt`, for example `content/notes/movies/dune-part-three.txt`. Separate paragraphs with a blank line. They show under the trailer as "About <title>" on the next build. Start with movies opening in the next 60 days, since those pages show the ticket button.

### Click tracking

`analytics.js` sends a GA4 event `affiliate_click` when someone clicks a ticket or watch button, with `link_kind` (`tickets` or `watch`) and `item_name` (the title). To see it by title in GA4 reports, register `link_kind` and `item_name` as custom dimensions (Admin > Custom definitions).

Buttons come from `config/links.json`:

- **Get tickets** (Fandango search) shows from 60 days before release until 75 days after, for theatrical movies.
- **Watch on Netflix / Prime Video / Apple TV / ...** shows for trailers posted by that streamer.
- **Where to watch** (JustWatch search) shows once a movie is released.

To earn commission, sign up for the affiliate programs (Fandango's runs through its affiliate network, and JustWatch and the streamers have their own). Then replace the `url` values with your affiliate links, keeping `{query}` where the movie name goes. All button links carry `rel="sponsored"`, as search engines require for paid links. Set `siteUrl` (or the `SITE_URL` repo variable) if you move to your own domain.

The About (`about/`), Privacy policy (`privacy/`) and Affiliate disclosure (`disclosure/`) pages are plain HTML, linked from every footer, with a short commission notice at the bottom of every page. Before applying to an affiliate program, check the contact address `help@trailerfeed.io` in those three pages works, and update their canonical links if the domain changes.

Two things to check before making money from the site:
- TMDB's free API is for non-commercial use. A site with affiliate links or ads needs TMDB's commercial terms, or you can drop `TMDB_API_KEY` and use YouTube descriptions only.
- Keep ads and overlays off the YouTube player. YouTube's terms don't allow covering or wrapping the embed.

## Google Analytics

`analytics.js` loads Google Analytics 4 directly (`GA_ID`, `G-KT1GPWNCYR`) and the Google Tag Manager container (`GTM_ID`, `GTM-M7L9FHZ9`) on every page. Leave an ID empty to turn that part off. Neither runs on localhost or on Cloudflare preview builds.

GA4 is already loaded by the site, so **don't add a GA4 / Google tag for the same ID inside Tag Manager**, or every page view counts twice. Use Tag Manager only for other tags. The tabs change the URL with `history.replaceState`, which GA4's enhanced measurement counts as page views. If you get visitors from the EU or UK, add a cookie consent banner as well.

## Running locally

The page loads JSON with `fetch`, so serve the folder rather than opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Before the first Action run the feed is empty. Run `node scripts/build-pages.mjs` to build the movie pages from the current data. To preview the layout with made-up sample data (fake video ids, so the player says the video is unavailable), open:

```
http://localhost:8000/?data=scripts/test/sample-trailers.json
```

To fetch real data locally:

```sh
YOUTUBE_API_KEY=your-key node scripts/fetch-trailers.mjs
```

Run the tests with:

```sh
node --test scripts/test/*.test.mjs
```
