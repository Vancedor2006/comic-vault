/* ==========================================================================
   ComicVault - Browse & Search Engine
   --------------------------------------------------------------------------
   - Live search (debounced) by title
   - Filter by genre + reading format, sort, paginate
   - Filters are mirrored in the URL (?q=&genre=&format=&sort=&page=)
     so results can be shared/bookmarked and the home page can link here.
   ========================================================================== */

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

const FORMAT_LABELS = {
  infinite: { text: "Vertical Scroll", cls: "badge-infinite" },
  rtl: { text: "Manga (RTL)", cls: "badge-rtl" },
  ltr: { text: "Western (LTR)", cls: "badge-ltr" },
};

const GENRE_LABELS = {
  action: "Action",
  fantasy: "Fantasy",
  romance: "Romance",
  scifi: "Sci-Fi",
  "slice-of-life": "Slice of Life",
};

const SORTS = {
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  az: { column: "title", ascending: true },
  za: { column: "title", ascending: false },
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;

  const searchInput = document.getElementById("search-input");
  const genreSelect = document.getElementById("genre-select");
  const formatSelect = document.getElementById("format-select");
  const sortSelect = document.getElementById("sort-select");
  const grid = document.getElementById("browse-grid");
  const pagination = document.getElementById("pagination");
  const resultsInfo = document.getElementById("results-info");

  // ---- State (initialised from URL) ---------------------------------------
  const params = new URLSearchParams(window.location.search);
  const state = {
    q: params.get("q") || "",
    genre: params.get("genre") || "",
    format: params.get("format") || "",
    sort: SORTS[params.get("sort")] ? params.get("sort") : "newest",
    page: Math.max(1, parseInt(params.get("page"), 10) || 1),
  };

  searchInput.value = state.q;
  genreSelect.value = state.genre;
  formatSelect.value = state.format;
  sortSelect.value = state.sort;

  let latestRequest = 0; // ignore out-of-order responses while typing

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.genre) p.set("genre", state.genre);
    if (state.format) p.set("format", state.format);
    if (state.sort !== "newest") p.set("sort", state.sort);
    if (state.page > 1) p.set("page", state.page);
    const qs = p.toString();
    // Chrome blocks URL rewriting when a page is opened straight from disk
    // (file://). That's fine: search still works, the URL just won't update.
    try {
      history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {
      /* ignore */
    }
  }

  // ---- Data ---------------------------------------------------------------
  async function fetchComics() {
    const requestId = ++latestRequest;
    syncUrl();
    renderSkeletons();

    const from = (state.page - 1) * PAGE_SIZE;
    const sort = SORTS[state.sort];

    let query = db
      .from("comics")
      .select("id, slug, title, genre, reading_mode, cover_url, profiles(username), chapters(chapter_number)", { count: "exact" })
      .order(sort.column, { ascending: sort.ascending })
      .range(from, from + PAGE_SIZE - 1);

    if (state.q) {
      // Escape LIKE wildcards so "%" or "_" in a search are treated literally
      const safe = state.q.replace(/[\\%_]/g, (c) => `\\${c}`);
      query = query.ilike("title", `%${safe}%`);
    }
    if (state.genre) query = query.eq("genre", state.genre);
    if (state.format) query = query.eq("reading_mode", state.format);

    const { data, error, count } = await query;
    if (requestId !== latestRequest) return; // a newer search has started

    if (error) {
      console.error("Browse error:", error);
      grid.innerHTML = `<p class="grid-message">Couldn't load comics. Please try again later.</p>`;
      pagination.innerHTML = "";
      resultsInfo.textContent = "";
      return;
    }

    // Page number past the end (e.g. after narrowing filters) -> jump back
    const totalPages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));
    if (state.page > totalPages) {
      state.page = totalPages;
      return fetchComics();
    }

    renderGrid(data);
    renderPagination(totalPages);
    resultsInfo.textContent = count === 1 ? "1 comic found" : `${count || 0} comics found`;
  }

  // ---- Rendering ----------------------------------------------------------
  function renderSkeletons() {
    grid.innerHTML = Array.from({ length: 12 }, () =>
      `<div class="comic-card skeleton" aria-hidden="true"><div class="comic-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`
    ).join("");
  }

  function renderGrid(comics) {
    if (!comics.length) {
      const filtered = state.q || state.genre || state.format;
      grid.innerHTML = `<p class="grid-message">${filtered
        ? "No comics match your search. Try different filters."
        : 'No comics yet. <a href="upload.html">Be the first to publish one!</a>'}</p>`;
      return;
    }

    grid.innerHTML = comics.map((c) => {
      const chapterCount = (c.chapters || []).length;
      const format = FORMAT_LABELS[c.reading_mode] || FORMAT_LABELS.ltr;
      const author = c.profiles?.username;
      const href = `comic.html?comic=${encodeURIComponent(c.slug)}`;
      const cover = c.cover_url
        ? `<img src="${escapeHtml(c.cover_url)}" alt="" class="comic-cover" loading="lazy">`
        : `<div class="comic-cover cover-fallback">${escapeHtml(c.title)}</div>`;

      return `
        <article>
          <a href="${href}" class="comic-card">
            <div class="cover-container">
              <span class="badge ${format.cls}">${format.text}</span>
              ${cover}
            </div>
            <div class="comic-meta">
              <h3 class="comic-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</h3>
              ${author ? `<p class="comic-author">By ${escapeHtml(author)}</p>` : ""}
              <div class="tags">
                ${c.genre ? `<span class="tag">${escapeHtml(GENRE_LABELS[c.genre] || c.genre)}</span>` : ""}
              </div>
              <span class="comic-chapter">${chapterCount} ${chapterCount === 1 ? "Chapter" : "Chapters"}</span>
            </div>
          </a>
        </article>`;
    }).join("");
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    // Show first, last, and a window around the current page
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - state.page) <= 1) pages.push(p);
      else if (pages[pages.length - 1] !== "…") pages.push("…");
    }

    pagination.innerHTML = `
      <button type="button" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>&laquo; Previous</button>
      ${pages.map((p) => p === "…"
        ? `<span class="page-gap">…</span>`
        : `<button type="button" data-page="${p}" class="${p === state.page ? "active" : ""}" ${p === state.page ? 'aria-current="page"' : ""}>${p}</button>`
      ).join("")}
      <button type="button" data-page="${state.page + 1}" ${state.page === totalPages ? "disabled" : ""}>Next &raquo;</button>`;
  }

  // ---- Events -------------------------------------------------------------
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      state.page = 1;
      fetchComics();
    }, SEARCH_DEBOUNCE_MS);
  });

  [[genreSelect, "genre"], [formatSelect, "format"], [sortSelect, "sort"]].forEach(([el, key]) => {
    el.addEventListener("change", () => {
      state[key] = el.value;
      state.page = 1;
      fetchComics();
    });
  });

  pagination.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-page]");
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    fetchComics();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  fetchComics();
});
