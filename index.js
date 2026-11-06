/* ==========================================================================
   ComicVault - Home Page
   --------------------------------------------------------------------------
   - Featured hero: the newest comic
   - Latest Updates: most recently published chapters (one card per comic)
   - Search box sends the user to browse.html?q=...
   ========================================================================== */

const LATEST_UPDATES_LIMIT = 12;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function readerUrl(slug, chapter) {
  return `reader.html?comic=${encodeURIComponent(slug)}&chapter=${chapter}`;
}

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  const units = [
    ["year", 31536000], ["month", 2592000], ["week", 604800],
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [name, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;

  const hero = document.getElementById("hero-card");
  const updatesGrid = document.getElementById("latest-grid");
  const searchForm = document.getElementById("home-search-form");
  const searchInput = document.getElementById("home-search-input");

  // ---- Search -> Browse ---------------------------------------------------
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    window.location.href = q ? `browse.html?q=${encodeURIComponent(q)}` : "browse.html";
  });

  // ---- Featured hero ------------------------------------------------------
  async function loadFeatured() {
    const { data, error } = await db
      .from("comics")
      .select("slug, title, synopsis, cover_url, profiles(username), chapters(chapter_number)")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !data || !data.length) {
      hero.innerHTML = `
        <div class="hero-text">
          <h1 class="hero-title">Welcome to ComicVault</h1>
          <p class="hero-description">Read webcomics the way their creators intended. No comics have been published yet.</p>
          <a href="upload.html" class="btn">Publish the first one</a>
        </div>`;
      if (error) console.error("Featured comic error:", error);
      return;
    }

    const comic = data[0];
    const nums = (comic.chapters || []).map((c) => c.chapter_number);
    const firstChapter = nums.length ? Math.min(...nums) : 1;
    const author = comic.profiles?.username;

    const seriesUrl = `comic.html?comic=${encodeURIComponent(comic.slug)}`;
    const cover = escapeHtml(comic.cover_url || "");

    hero.innerHTML = `
      ${cover ? `<div class="hero-backdrop" style="background-image: url('${cover}')"></div>` : ""}
      ${cover ? `<a href="${seriesUrl}"><img src="${cover}" alt="" class="hero-cover"></a>` : ""}
      <div class="hero-text">
        <span class="hero-eyebrow">Featured</span>
        <h1 class="hero-title">${escapeHtml(comic.title)}</h1>
        ${author ? `<p class="comic-author">By ${escapeHtml(author)}</p>` : ""}
        <p class="hero-description">${escapeHtml(comic.synopsis || "No synopsis yet.")}</p>
        <div class="hero-actions">
          ${nums.length ? `<a href="${readerUrl(comic.slug, firstChapter)}" class="btn btn-large">Start Reading</a>` : ""}
          <a href="${seriesUrl}" class="btn btn-secondary btn-large">View Series</a>
        </div>
      </div>`;
  }

  // ---- Latest updates -----------------------------------------------------
  async function loadLatestUpdates() {
    // Pull extra chapters so we still have enough after keeping one per comic
    const { data, error } = await db
      .from("chapters")
      .select("chapter_number, title, created_at, comics(slug, title, cover_url)")
      .order("created_at", { ascending: false })
      .limit(LATEST_UPDATES_LIMIT * 4);

    if (error) {
      console.error("Latest updates error:", error);
      updatesGrid.innerHTML = `<p class="grid-message">Couldn't load updates. Please try again later.</p>`;
      return;
    }

    const seen = new Set();
    const updates = [];
    for (const ch of data || []) {
      if (!ch.comics || seen.has(ch.comics.slug)) continue;
      seen.add(ch.comics.slug);
      updates.push(ch);
      if (updates.length === LATEST_UPDATES_LIMIT) break;
    }

    if (!updates.length) {
      updatesGrid.innerHTML = `<p class="grid-message">No chapters published yet.</p>`;
      return;
    }

    updatesGrid.innerHTML = updates.map((ch) => {
      const c = ch.comics;
      const cover = c.cover_url
        ? `<img src="${escapeHtml(c.cover_url)}" alt="" class="comic-cover" loading="lazy">`
        : `<div class="comic-cover cover-fallback">${escapeHtml(c.title)}</div>`;
      return `
        <article>
          <a href="${readerUrl(c.slug, ch.chapter_number)}" class="comic-card">
            ${cover}
            <div class="comic-meta">
              <h3 class="comic-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</h3>
              <span class="comic-chapter">Ch. ${ch.chapter_number} · ${timeAgo(ch.created_at)}</span>
            </div>
          </a>
        </article>`;
    }).join("");
  }

  updatesGrid.innerHTML = Array.from({ length: 6 }, () =>
    `<div class="comic-card skeleton" aria-hidden="true"><div class="comic-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`
  ).join("");

  loadFeatured();
  loadLatestUpdates();
});
