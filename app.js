(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  // ?data=path lets you preview with another JSON file locally, e.g. ?data=scripts/test/sample-trailers.json
  const TABS = {
    movies: { file: "data/trailers.json", page: "Movie page", empty: "No movie trailers yet. Check back soon." },
    tv: { file: "data/tv.json", page: "Show page", empty: "No TV trailers yet. The daily update will add them." },
    games: { file: "data/games.json", page: "Game page", empty: "No game trailers yet. The daily update will add them." },
  };
  let tab = TABS[params.get("tab")] ? params.get("tab") : "movies";

  let trailers = [];
  let sort = "newest";
  let current = null;

  const fmtViews = (n) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) + " views";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
    return "just now";
  }
  function releaseText(d) {
    if (!d || tab === "tv") return ""; // a show's first air date says nothing about the new season
    const date = new Date(d + "T12:00:00Z");
    if (isNaN(date)) return "";
    const fmt = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return (date > Date.now() ? (tab === "games" ? "Out " : "In theaters ") : "Released ") + fmt;
  }
  // Ticket / watch buttons (from config/links.json via the daily build) and the movie page link.
  function renderActions(el, t, withPage) {
    el.innerHTML = "";
    for (const l of t.links || []) {
      const a = document.createElement("a");
      a.className = `btn btn-${l.kind}`; a.href = l.url; a.textContent = l.label;
      a.target = "_blank"; a.rel = "sponsored noopener";
      el.appendChild(a);
    }
    if (withPage && t.movieSlug) {
      const a = document.createElement("a");
      a.className = "btn btn-page"; a.href = t.pagePath || `movies/${encodeURIComponent(t.movieSlug)}/`; a.textContent = TABS[tab].page;
      el.appendChild(a);
    }
    el.hidden = !el.children.length;
  }
  const isNew = (iso) => Date.now() - new Date(iso) < 2 * 864e5;

  function play(t, { autoplay = false, scroll = false } = {}) {
    current = t;
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.id)}?rel=0&playsinline=1${autoplay ? "&autoplay=1" : ""}`;
    $("player").innerHTML = "";
    const f = document.createElement("iframe");
    f.src = src;
    f.title = t.title;
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.allowFullscreen = true;
    $("player").appendChild(f);
    $("hero-label").textContent = t === trailers[0] ? "Newest trailer" : "Now playing";
    $("hero-title").textContent = t.title;
    $("hero-sub").textContent = `${t.channelTitle} · ${fmtViews(t.views)} · ${ago(t.publishedAt)}`;
    const rel = releaseText(t.releaseDate);
    if (rel) {
      const span = document.createElement("span");
      span.className = "release"; span.textContent = ` · ${rel}`;
      $("hero-sub").appendChild(span);
    }
    $("hero-summary").textContent = t.summary || "";
    $("hero-summary").hidden = !t.summary;
    renderActions($("hero-actions"), t, true);
    document.title = `TrailerFeed | ${t.title}`;
    const q = tab === "movies" ? "" : `?tab=${tab}`;
    history.replaceState(null, "", location.pathname + q + (t === trailers[0] ? "" : `#v=${t.id}`));
    renderGrid();
    if (scroll) $("hero").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Trailers are grouped by the week they came out (weeks start Monday), newest week first.
  const WEEKS_PER_PAGE = 4;
  let weeksShown = WEEKS_PER_PAGE;
  function weekStart(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function weekLabel(start) {
    const diff = Math.round((weekStart(Date.now()) - start) / 6048e5);
    if (diff <= 0) return "This week";
    if (diff === 1) return "Last week";
    const opts = { month: "short", day: "numeric", ...(start.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) };
    return "Week of " + start.toLocaleDateString("en-US", opts);
  }
  function groupByWeek(list) {
    const weeks = new Map();
    for (const t of list) {
      const k = weekStart(t.publishedAt).getTime();
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k).push(t);
    }
    return [...weeks.entries()].sort((a, b) => b[0] - a[0]).map(([k, items]) => ({ start: new Date(k), items }));
  }

  function card(t) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card" + (t === current ? " playing" : "");
    b.innerHTML = `<div class="thumb"><img loading="lazy" alt=""></div><h3></h3><p></p>`;
    b.querySelector("img").onerror = (e) => { e.target.style.visibility = "hidden"; };
    b.querySelector("img").src = t.thumbnail || `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`;
    if (isNew(t.publishedAt)) {
      const badge = document.createElement("span");
      badge.className = "badge"; badge.textContent = "New";
      b.querySelector(".thumb").appendChild(badge);
    }
    b.querySelector("h3").textContent = t.title;
    b.querySelector("p").textContent = `${t.channelTitle} · ${fmtViews(t.views)} · ${ago(t.publishedAt)}`;
    if (t.summary) {
      const sum = document.createElement("p");
      sum.className = "card-summary"; sum.textContent = t.summary;
      b.appendChild(sum);
    }
    b.addEventListener("click", () => play(t, { autoplay: true, scroll: true }));
    li.appendChild(b);
    return li;
  }

  function renderGrid() {
    const weeks = groupByWeek(trailers);
    // Keep the week of the trailer that's playing visible, e.g. when opened from a shared link.
    const playingWeek = weeks.findIndex((w) => w.items.includes(current));
    if (playingWeek >= weeksShown) weeksShown = playingWeek + 1;
    const box = $("weeks");
    box.innerHTML = "";
    for (const w of weeks.slice(0, weeksShown)) {
      const items = [...w.items];
      if (sort === "popular") items.sort((a, b) => b.views - a.views);
      const sec = document.createElement("section");
      sec.className = "week";
      const h = document.createElement("h3");
      h.className = "week-head";
      h.innerHTML = `<span></span> <span class="week-count"></span>`;
      h.firstChild.textContent = weekLabel(w.start);
      h.lastChild.textContent = `${items.length} trailer${items.length === 1 ? "" : "s"}`;
      const ol = document.createElement("ol");
      ol.className = "grid";
      for (const t of items) ol.appendChild(card(t));
      sec.append(h, ol);
      box.appendChild(sec);
    }
    const more = $("more-weeks");
    more.hidden = weeks.length <= weeksShown;
  }
  $("more-weeks").addEventListener("click", () => { weeksShown += WEEKS_PER_PAGE; renderGrid(); });

  document.querySelectorAll(".sort button").forEach((btn) =>
    btn.addEventListener("click", () => {
      sort = btn.dataset.sort;
      document.querySelectorAll(".sort button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      renderGrid();
    }));

  function showEmpty(msg) {
    $("player").innerHTML = `<div class="player-empty"></div>`;
    $("player").firstChild.textContent = msg;
    $("hero-label").textContent = "";
  }

  function load(name, { fromHash = false } = {}) {
    tab = name;
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.tab === tab)));
    $("player").innerHTML = `<div class="player-empty">Loading…</div>`;
    $("hero-title").textContent = ""; $("hero-sub").textContent = ""; $("hero-summary").hidden = true; $("hero-actions").hidden = true;
    $("weeks").innerHTML = ""; $("more-weeks").hidden = true; trailers = []; weeksShown = WEEKS_PER_PAGE;
    // ?data=path lets you preview another JSON file locally, e.g. ?data=scripts/test/sample-trailers.json
    const url = params.get("data") || TABS[tab].file;
    fetch(url, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((data) => {
        if (tab !== name) return; // switched tabs while loading
        trailers = (data.trailers || []).slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        $("updated").textContent = data.updatedAt ? "Updated " + ago(data.updatedAt) : "";
        if (!trailers.length) return showEmpty(TABS[tab].empty);
        const id = fromHash ? new URLSearchParams(location.hash.slice(1)).get("v") : null;
        play(trailers.find((t) => t.id === id) || trailers[0]);
      })
      .catch(() => { if (tab === name) showEmpty(location.protocol === "file:" ? "Serve this folder instead of opening the file directly (see README)." : TABS[tab].empty); });
  }

  document.querySelectorAll(".tabs a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (a.dataset.tab !== tab) load(a.dataset.tab);
  }));
  load(tab, { fromHash: true });
})();
