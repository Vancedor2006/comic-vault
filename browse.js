/* ==========================================================================
   ComicVault - Browse & search
   - Live search across titles, synopses and author names
   - Genre chips, reading-direction filter, sort, grid/list view
   - Numbered pages on bigger screens, "Load more" on phones
   - Filters live in the URL (?q=&genre=&format=&sort=&page=) so results
     can be bookmarked and the header search can link here
   ========================================================================== */

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;
const VIEW_KEY = "cv-browse-view";
const BROWSE_FIELDS =
  "id, slug, title, synopsis, genre, reading_mode, cover_url, created_at, author_id, profiles(username), chapters(chapter_number, created_at)";
const SORTS = {
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  az: { column: "title", ascending: true },
  za: { column: "title", ascending: false },
};

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const esc = CV.escapeHtml;
  const $ = (id) => document.getElementById(id);

  document.querySelectorAll("[data-icon]").forEach((node) => (node.innerHTML = CV.icons[node.dataset.icon] || ""));

  const searchInput = $("search-input");
  const formatSelect = $("format-select");
  const sortSelect = $("sort-select");
  const chipsEl = $("genre-chips");
  const grid = $("browse-grid");
  const pagination = $("pagination");
  const resultsInfo = $("results-info");
  const clearBtn = $("clear-filters");
  const filtersToggle = $("filters-toggle");
  const filterPanel = $("filter-panel");
  const filterCount = $("filter-count");
  const loadMoreWrap = $("load-more");
  const loadMoreInfo = $("load-more-info");
  const loadMoreBtn = $("load-more-btn");
  const viewButtons = document.querySelectorAll("[data-view]");

  const phoneQuery = window.matchMedia("(max-width: 760px)");
  const usingLoadMore = () => phoneQuery.matches;

  // ---- State (from the URL) -----------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const state = {
    q: (params.get("q") || "").trim(),
    genre: CV.GENRES[params.get("genre")] ? params.get("genre") : "",
    format: CV.MODES[params.get("format")] ? params.get("format") : "",
    sort: SORTS[params.get("sort")] ? params.get("sort") : "newest",
    page: Math.max(1, parseInt(params.get("page"), 10) || 1),
    view: CV.store.get(VIEW_KEY, "grid") === "list" ? "list" : "grid",
  };

  let latestRequest = 0;
  let loaded = 0;
  let total = 0;
  const authorIdCache = new Map();

  // ---- UI setup -----------------------------------------------------------
  searchInput.value = state.q;
  formatSelect.value = state.format;
  sortSelect.value = state.sort;

  chipsEl.innerHTML = [["", "All"], ...Object.entries(CV.GENRES)]
    .map(([value, label]) => `<button type="button" class="chip" data-genre="${value}" aria-pressed="false">${esc(label)}</button>`)
    .join("");

  function syncControls() {
    chipsEl.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.genre === state.genre)));
    viewButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
    grid.classList.toggle("is-list", state.view === "list");
    const active = (state.format ? 1 : 0) + (state.sort !== "newest" ? 1 : 0);
    filterCount.hidden = !active;
    filterCount.textContent = String(active);
    clearBtn.hidden = !(state.q || state.genre || state.format || state.sort !== "newest");
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.genre) p.set("genre", state.genre);
    if (state.format) p.set("format", state.format);
    if (state.sort !== "newest") p.set("sort", state.sort);
    if (!usingLoadMore() && state.page > 1) p.set("page", state.page);
    const qs = p.toString();
    try {
      history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {
      /* not allowed for files opened from disk; search still works */
    }
  }

  // ---- Data ---------------------------------------------------------------
  // Profiles whose username matches the search (so you can search by author)
  async function authorIdsFor(query) {
    if (authorIdCache.has(query)) return authorIdCache.get(query);
    const { data, error } = await db.from("profiles").select("id").ilike("username", CV.likePattern(query)).limit(50);
    const ids = error ? [] : (data || []).map((p) => p.id);
    if (error) console.error("Author search error:", error);
    authorIdCache.set(query, ids);
    return ids;
  }

  async function fetchComics({ append = false } = {}) {
    const requestId = ++latestRequest;
    syncControls();
    syncUrl();

    const from = append ? loaded : usingLoadMore() ? 0 : (state.page - 1) * PAGE_SIZE;
    if (append) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = "Loading…";
    } else {
      grid.innerHTML = CV.skeletonCards(12);
      grid.setAttribute("aria-busy", "true");
    }

    const sort = SORTS[state.sort];
    let query = db
      .from("comics")
      .select(BROWSE_FIELDS, { count: "exact" })
      .order(sort.column, { ascending: sort.ascending })
      .order("id", { ascending: true }) // stable order between pages
      .range(from, from + PAGE_SIZE - 1);

    if (state.q) {
      const ids = await authorIdsFor(state.q);
      if (requestId !== latestRequest) return;
      const value = CV.pgQuote(CV.likePattern(state.q));
      const filters = [`title.ilike.${value}`, `synopsis.ilike.${value}`];
      if (ids.length) filters.push(`author_id.in.(${ids.join(",")})`);
      query = query.or(filters.join(","));
    }
    if (state.genre) query = query.eq("genre", state.genre);
    if (state.format) query = query.eq("reading_mode", state.format);

    const { data, error, count } = await query;
    if (requestId !== latestRequest) return; // a newer search started meanwhile
    grid.removeAttribute("aria-busy");

    if (error) {
      console.error("Browse error:", error);
      if (!append) grid.innerHTML = '<p class="grid-message">Couldn\'t load comics. Please try again later.</p>';
      else CV.toast("Couldn't load more comics. Please try again.", "error");
      resetLoadMoreButton();
      return;
    }

    total = count || 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (!usingLoadMore() && !append && state.page > totalPages) {
      state.page = totalPages; // e.g. narrowed the filters while on page 5
      return fetchComics();
    }

    const cards = data.map((c) => CV.comicCard(c)).join("");
    if (append) {
      grid.insertAdjacentHTML("beforeend", cards);
      loaded += data.length;
    } else {
      grid.innerHTML = data.length ? cards : emptyMessage();
      loaded = data.length;
    }

    resultsInfo.textContent = total === 1 ? "1 comic" : `${total} comics`;
    renderPaging(totalPages);
  }

  function emptyMessage() {
    const filtered = state.q || state.genre || state.format;
    return filtered
      ? '<div class="grid-message"><h2>No matches</h2><p>Try a different search, or clear the filters.</p></div>'
      : '<div class="grid-message"><h2>No comics yet</h2><p>Be the first to publish one!</p><a class="btn" href="upload.html">Publish a comic</a></div>';
  }

  function resetLoadMoreButton() {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Load more";
  }

  function renderPaging(totalPages) {
    if (usingLoadMore()) {
      pagination.innerHTML = "";
      loadMoreWrap.hidden = loaded >= total;
      loadMoreInfo.textContent = `Showing ${loaded} of ${total}`;
      resetLoadMoreButton();
      return;
    }
    loadMoreWrap.hidden = true;
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - state.page) <= 1) pages.push(p);
      else if (pages[pages.length - 1] !== "…") pages.push("…");
    }
    pagination.innerHTML = `
      <button type="button" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>&laquo; Previous</button>
      ${pages
        .map((p) =>
          p === "…"
            ? '<span class="page-gap" aria-hidden="true">…</span>'
            : `<button type="button" data-page="${p}" class="${p === state.page ? "active" : ""}" aria-label="Page ${p}"${p === state.page ? ' aria-current="page"' : ""}>${p}</button>`
        )
        .join("")}
      <button type="button" data-page="${state.page + 1}" ${state.page === totalPages ? "disabled" : ""}>Next &raquo;</button>`;
  }

  // ---- Events -------------------------------------------------------------
  const runSearch = CV.debounce(() => {
    state.q = searchInput.value.trim();
    state.page = 1;
    fetchComics();
  }, SEARCH_DEBOUNCE_MS);
  searchInput.addEventListener("input", runSearch);

  $("filter-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.q = searchInput.value.trim();
    state.page = 1;
    fetchComics();
    searchInput.blur(); // closes the phone keyboard
  });

  formatSelect.addEventListener("change", () => {
    state.format = formatSelect.value;
    state.page = 1;
    fetchComics();
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    state.page = 1;
    fetchComics();
  });

  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.genre = chip.dataset.genre;
    state.page = 1;
    fetchComics();
  });

  viewButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      CV.store.set(VIEW_KEY, state.view);
      syncControls();
    })
  );

  filtersToggle.addEventListener("click", () => {
    const open = filterPanel.classList.toggle("open");
    filtersToggle.setAttribute("aria-expanded", String(open));
  });

  clearBtn.addEventListener("click", () => {
    Object.assign(state, { q: "", genre: "", format: "", sort: "newest", page: 1 });
    searchInput.value = "";
    formatSelect.value = "";
    sortSelect.value = "newest";
    fetchComics();
  });

  pagination.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-page]");
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    fetchComics();
    window.scrollTo({ top: 0, behavior: CV.reducedMotion() ? "auto" : "smooth" });
  });

  loadMoreBtn.addEventListener("click", () => fetchComics({ append: true }));

  $("random-btn").addEventListener("click", (e) => CV.goToRandomComic(db, e.currentTarget));

  // Switching between phone and bigger layouts changes the paging style
  const onLayoutChange = () => {
    state.page = 1;
    fetchComics();
  };
  if (phoneQuery.addEventListener) phoneQuery.addEventListener("change", onLayoutChange);

  fetchComics();
});
