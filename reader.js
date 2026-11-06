/* ==========================================================================
   ComicVault - Reader Engine
   reader.html?comic=<slug>&chapter=<number>

   - Locks the reading mode to the creator's choice (infinite / ltr / rtl)
   - Chapter dropdown + previous/next chapter navigation
   - Single-page mode: arrow keys, click/tap zones, RTL-aware, preloads next page
   - End-of-chapter panel that leads into the next chapter
   ========================================================================== */

const MODE_INFO = {
  infinite: { text: "Vertical Scroll", cls: "badge-infinite" },
  rtl: { text: "Manga (RTL)", cls: "badge-rtl" },
  ltr: { text: "Western (LTR)", cls: "badge-ltr" },
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const el = {
    root: $("reader-root"),
    backLink: $("back-link"),
    comicTitle: $("comic-title"),
    chapterTitle: $("chapter-title"),
    chapterSelect: $("chapter-select"),
    badge: $("creator-intent-badge"),
    tip: $("reader-tip"),
    loading: $("reader-loading"),
    infinite: $("infinite-wrapper"),
    single: $("single-page-wrapper"),
    activeImg: $("active-page-img"),
    prevPage: $("prev-page-btn"),
    nextPage: $("next-page-btn"),
    counter: $("page-counter"),
    currentNum: $("current-page-num"),
    totalNum: $("total-pages-num"),
    chapterEnd: $("chapter-end"),
    chapterEndText: $("chapter-end-text"),
    chapterEndActions: $("chapter-end-actions"),
    prevChapter: $("prev-chapter-btn"),
    nextChapter: $("next-chapter-btn"),
    scrollTop: $("scroll-top-btn"),
  };

  // ---- State --------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("comic");
  const requestedChapter = parseInt(params.get("chapter"), 10);

  let comic = null;
  let chapters = [];       // sorted [{ id, chapter_number, title }]
  let chapterIndex = -1;   // index into chapters
  let pages = [];          // image URLs
  let pageIndex = 0;

  const chapterUrl = (n) => `reader.html?comic=${encodeURIComponent(slug)}&chapter=${n}`;
  const seriesUrl = () => `comic.html?comic=${encodeURIComponent(slug)}`;

  function showError(title, message) {
    el.root.innerHTML = `
      <div class="reader-error">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <a href="${slug ? seriesUrl() : "browse.html"}" class="btn">${slug ? "Back to series" : "Browse comics"}</a>
      </div>`;
  }

  // ---- Load ---------------------------------------------------------------
  async function init() {
    if (!slug) return showError("No comic selected", "Pick a comic from the browse page to start reading.");

    const { data, error } = await db
      .from("comics")
      .select("id, slug, title, reading_mode, chapters(id, chapter_number, title)")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Reader error:", error);
      return showError("Couldn't load this comic", "Please check your connection and try again.");
    }
    if (!data) return showError("Comic not found", "It may have been removed or the link is wrong.");

    comic = data;
    chapters = (data.chapters || []).sort((a, b) => a.chapter_number - b.chapter_number);
    if (!chapters.length) return showError("No chapters yet", "This comic doesn't have any chapters published yet.");

    // Requested chapter, or fall back to the first one
    chapterIndex = chapters.findIndex((c) => c.chapter_number === requestedChapter);
    if (chapterIndex === -1) chapterIndex = 0;
    const chapter = chapters[chapterIndex];

    const { data: pageRows, error: pagesError } = await db
      .from("pages")
      .select("image_url")
      .eq("chapter_id", chapter.id)
      .order("page_number", { ascending: true });

    if (pagesError) {
      console.error("Reader pages error:", pagesError);
      return showError("Couldn't load pages", "Please try again in a moment.");
    }

    pages = pageRows.map((p) => p.image_url);
    renderChrome(chapter);
    renderPages();
  }

  // ---- Toolbar, chapter list, chapter buttons ------------------------------
  function renderChrome(chapter) {
    const chapterLabel = (c) => `Chapter ${c.chapter_number}${c.title ? `: ${c.title}` : ""}`;

    document.title = `${comic.title} - Ch. ${chapter.chapter_number} | ComicVault`;
    el.comicTitle.textContent = comic.title;
    el.comicTitle.href = seriesUrl();
    el.backLink.href = seriesUrl();
    el.chapterTitle.textContent = chapterLabel(chapter);

    const mode = MODE_INFO[comic.reading_mode] || MODE_INFO.ltr;
    el.badge.textContent = mode.text;
    el.badge.className = `badge ${mode.cls}`;

    el.chapterSelect.innerHTML = chapters
      .map((c, i) => `<option value="${c.chapter_number}" ${i === chapterIndex ? "selected" : ""}>${escapeHtml(chapterLabel(c))}</option>`)
      .join("");
    el.chapterSelect.disabled = false;
    el.chapterSelect.addEventListener("change", () => {
      window.location.href = chapterUrl(el.chapterSelect.value);
    });

    setChapterLink(el.prevChapter, chapters[chapterIndex - 1]);
    setChapterLink(el.nextChapter, chapters[chapterIndex + 1]);
  }

  function setChapterLink(link, target) {
    if (target) {
      link.href = chapterUrl(target.chapter_number);
      link.removeAttribute("aria-disabled");
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
    }
  }

  // ---- Pages --------------------------------------------------------------
  function renderPages() {
    el.loading.classList.add("hidden");

    if (!pages.length) {
      el.infinite.classList.remove("hidden");
      el.infinite.innerHTML = `<p class="grid-message">This chapter has no pages.</p>`;
      return;
    }

    if (comic.reading_mode === "infinite") {
      el.infinite.classList.remove("hidden");
      el.infinite.innerHTML = pages
        .map((url, i) => `<img src="${escapeHtml(url)}" alt="Page ${i + 1}" class="webtoon-page" ${i > 1 ? 'loading="lazy"' : ""}>`)
        .join("");
      showChapterEnd();
    } else {
      el.single.classList.remove("hidden");
      el.counter.classList.remove("hidden");
      el.tip.classList.remove("hidden");
      el.totalNum.textContent = pages.length;
      showPage(0);
    }
  }

  function showPage(i) {
    pageIndex = i;
    el.activeImg.src = pages[i];
    el.activeImg.alt = `Page ${i + 1} of ${pages.length}`;
    el.currentNum.textContent = i + 1;

    // Preload the next page so turning feels instant
    if (pages[i + 1]) new Image().src = pages[i + 1];

    if (i === pages.length - 1) showChapterEnd();
    else el.chapterEnd.classList.add("hidden");
  }

  // "forward" = next page in story order, regardless of LTR/RTL
  function turn(forward) {
    if (comic?.reading_mode === "infinite" || !pages.length) return;
    const target = pageIndex + (forward ? 1 : -1);
    if (target < 0 || target >= pages.length) {
      if (target >= pages.length) el.chapterEnd.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    showPage(target);
    el.single.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showChapterEnd() {
    const next = chapters[chapterIndex + 1];
    el.chapterEnd.classList.remove("hidden");
    if (next) {
      el.chapterEndText.textContent = `Up next: Chapter ${next.chapter_number}${next.title ? ` - ${next.title}` : ""}`;
      el.chapterEndActions.innerHTML = `
        <a href="${chapterUrl(next.chapter_number)}" class="btn btn-large">Read Chapter ${next.chapter_number} &raquo;</a>`;
    } else {
      el.chapterEndText.textContent = "You're all caught up! Check back later for new chapters.";
      el.chapterEndActions.innerHTML = `
        <a href="${seriesUrl()}" class="btn btn-secondary">Back to series</a>
        <a href="browse.html" class="btn">Find more comics</a>`;
    }
  }

  // ---- Controls -----------------------------------------------------------
  // In RTL (manga) the left side moves FORWARD in the story
  const isRtl = () => comic?.reading_mode === "rtl";

  el.prevPage.addEventListener("click", () => turn(isRtl()));
  el.nextPage.addEventListener("click", () => turn(!isRtl()));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowRight") turn(!isRtl());
    else if (e.key === "ArrowLeft") turn(isRtl());
  });

  el.scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  init();
});
