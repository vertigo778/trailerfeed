# Trailer Feed

A static website that shows the newest popular movie trailers from YouTube. The newest trailer is embedded at the top of the page; the rest are listed below, sortable by newest or most viewed.

There is no server. A GitHub Action runs once a day, asks the YouTube Data API for new popular official trailers, and commits the results to `data/trailers.json`. Cloudflare Pages (or GitHub Pages) serves the site, which reads that file.

```
index.html, style.css, app.js     the site
_headers                          cache rules for Cloudflare
data/trailers.json                the feed (written by the Action)
scripts/fetch-trailers.mjs        the daily YouTube search (Node 20+, no dependencies)
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

## How trailers are picked

Each day the script searches YouTube for videos uploaded in the last 7 days matching a few queries ("official trailer", "official teaser trailer", and so on), ordered by view count. It keeps videos that:

- have "trailer" or "teaser" in the title,
- don't look like reactions, fan edits, commentary, clickbait (emoji or "!" titles), game, music or TV trailers, or Shorts,
- are in English (YouTube's audio language when the uploader set it, otherwise judged from the title and channel),
- can be embedded, and
- have at least 100,000 views.

When the same trailer is uploaded by several channels (regional studios, dubs), only the most viewed upload is kept.

Trailers stay in the feed for 60 days, up to 120 at a time, newest first. Each run also re-checks trailers already in the feed, so view counts stay current and stricter rules clean out older entries.

You can tune this without editing code by adding repository **variables** (**Settings → Secrets and variables → Actions → Variables**), which the workflow already passes through: `SEARCH_WINDOW_DAYS`, `KEEP_DAYS`, `MIN_VIEWS`, `MAX_ITEMS`, `REGION_CODE`, `QUERIES` (separated by `|`), and `ENGLISH_ONLY` (set to `false` to include every language).

## Running locally

The page loads JSON with `fetch`, so serve the folder rather than opening the file directly:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

Before the first Action run the feed is empty. To preview the layout with made-up sample data (fake video ids, so the player says the video is unavailable), open:

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
