(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  // ?data=path lets you preview with another JSON file locally, e.g. ?data=scripts/test/sample-trailers.json
  const dataUrl = params.get("data") || "data/trailers.json";

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
    document.title = `${t.title} · Trailer Feed`;
    history.replaceState(null, "", t === trailers[0] ? location.pathname + location.search : `#v=${t.id}`);
    renderGrid();
    if (scroll) $("hero").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderGrid() {
    const list = [...trailers];
    if (sort === "popular") list.sort((a, b) => b.views - a.views);
    const grid = $("grid");
    grid.innerHTML = "";
    for (const t of list) {
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
      b.addEventListener("click", () => play(t, { autoplay: true, scroll: true }));
      li.appendChild(b);
      grid.appendChild(li);
    }
  }

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

  fetch(dataUrl, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      trailers = (data.trailers || []).slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      if (data.updatedAt) $("updated").textContent = "Updated " + ago(data.updatedAt);
      if (!trailers.length) return showEmpty("No trailers yet. The daily update hasn't run, so check back soon.");
      const fromHash = new URLSearchParams(location.hash.slice(1)).get("v");
      play(trailers.find((t) => t.id === fromHash) || trailers[0]);
    })
    .catch(() => showEmpty("Couldn't load the trailer list. If you opened this file directly, serve the folder instead (see README)."));
})();
