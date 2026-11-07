/* ==========================================================================
   ComicVault - Home page
   - Featured carousel (newest series that have chapters)
   - Continue reading (saved in this browser)
   - Latest chapter updates, new series, and one row per genre
   ========================================================================== */

const COMIC_FIELDS =
  "id, slug, title, synopsis, genre, reading_mode, cover_url, created_at, profiles(username), chapters(chapter_number, created_at)";
const ROTATE_MS = 7000;

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const esc = CV.escapeHtml;

  const featuredEl = document.getElementById("featured");
  const continueEl = document.getElementById("continue-section");
  const latestGrid = document.getElementById("latest-grid");
  const newSeriesEl = document.getElementById("new-series");
  const genreRowsEl = document.getElementById("genre-rows");

  // ---- Continue reading ---------------------------------------------------
  function renderContinue() {
    const entries = CV.progress.list().slice(0, 12);
    if (!entries.length) {
      continueEl.hidden = true;
      continueEl.innerHTML = "";
      return;
    }
    const cards = entries
      .map((e) => {
        const label = e.done
          ? "Caught up"
          : e.upNext
            ? `Up next: Ch. ${e.chapter}`
            : `Ch. ${e.chapter}${e.page > 1 ? ` · Page ${e.page}` : ""}`;
        const href = e.done ? CV.url.series(e.slug) : CV.url.reader(e.slug, e.chapter, e.upNext ? 1 : e.page);
        const progress = e.done ? 1 : e.upNext ? 0 : e.pageCount ? e.page / e.pageCount : undefined;
        return CV.comicCard(
          { slug: e.slug, title: e.title, cover_url: e.cover, reading_mode: e.mode },
          {
            href,
            subtitle: label,
            flag: false,
            progress,
            extra: `<button type="button" class="card-remove" data-remove="${esc(e.slug)}" aria-label="Remove ${esc(e.title)} from Continue reading" title="Remove">&times;</button>`,
          }
        );
      })
      .join("");
    continueEl.hidden = false;
    continueEl.innerHTML = `
      <div class="section-heading-row"><h2 class="section-heading" id="continue-heading">Continue reading</h2></div>
      ${CV.rowHtml(cards, "Continue reading")}`;
    CV.initRows(continueEl);
  }

  continueEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    CV.progress.remove(btn.dataset.remove);
    renderContinue();
    const next = continueEl.querySelector(".card-remove");
    if (next) next.focus();
  });

  // ---- Featured carousel --------------------------------------------------
  function renderWelcome() {
    featuredEl.innerHTML = `
      <div class="hero-card is-active">
        <div class="hero-text">
          <span class="hero-eyebrow">Welcome</span>
          <h2 class="hero-title">Welcome to ComicVault</h2>
          <p class="hero-description">Read webcomics the way their creators intended. No comics have been published yet. Yours could be the first!</p>
          <div class="hero-actions"><a href="upload.html" class="btn btn-large">Publish a comic</a></div>
        </div>
      </div>`;
  }

  function slideHtml(c, i, n) {
    const nums = (c.chapters || []).map((ch) => ch.chapter_number);
    const first = nums.length ? Math.min(...nums) : null;
    const saved = CV.progress.get(c.slug);
    const mode = CV.mode(c.reading_mode);
    const author = c.profiles && c.profiles.username;

    let readHref = null;
    let readLabel = "Start reading";
    if (saved && !saved.done) {
      readHref = CV.url.reader(c.slug, saved.chapter, saved.upNext ? 1 : saved.page);
      readLabel = `Continue ch. ${saved.chapter}`;
    } else if (first !== null) {
      readHref = CV.url.reader(c.slug, first);
    }

    return `
      <div class="hero-card${i === 0 ? " is-active" : ""}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}: ${esc(c.title)}"${i === 0 ? "" : ' aria-hidden="true" inert'}>
        ${c.cover_url ? `<div class="hero-backdrop" data-bg="${esc(c.cover_url)}"></div>` : ""}
        ${c.cover_url ? `<a href="${CV.url.series(c.slug)}" class="hero-cover-link" tabindex="-1" aria-hidden="true"><img src="${esc(c.cover_url)}" alt="" class="hero-cover"></a>` : ""}
        <div class="hero-text">
          <span class="hero-eyebrow">Featured</span>
          <h2 class="hero-title">${esc(c.title)}</h2>
          ${author ? `<p class="comic-author">By ${esc(author)}</p>` : ""}
          <div class="tags"><span class="badge ${mode.cls}">${mode.short}</span>${c.genre ? `<span class="tag">${esc(CV.genreLabel(c.genre))}</span>` : ""}</div>
          <p class="hero-description">${esc(c.synopsis || "No synopsis yet.")}</p>
          <div class="hero-actions">
            ${readHref ? `<a href="${readHref}" class="btn btn-large">${esc(readLabel)}</a>` : ""}
            <a href="${CV.url.series(c.slug)}" class="btn btn-secondary btn-large">View series</a>
          </div>
        </div>
      </div>`;
  }

  function renderCarousel(list) {
    if (!list.length) return renderWelcome();
    const n = list.length;
    featuredEl.innerHTML = `
      <div class="carousel" role="region" aria-roledescription="carousel" aria-label="Featured comics">
        <div class="carousel-track">${list.map((c, i) => slideHtml(c, i, n)).join("")}</div>
        ${
          n > 1
            ? `<div class="carousel-controls">
                <button type="button" class="icon-btn carousel-btn" data-dir="-1" aria-label="Previous featured comic">${CV.icons.chevronLeft}</button>
                ${list.map((c, i) => `<button type="button" class="carousel-dot" data-go="${i}" aria-label="Show ${esc(c.title)}"${i === 0 ? ' aria-current="true"' : ""}></button>`).join("")}
                <button type="button" class="icon-btn carousel-btn" data-dir="1" aria-label="Next featured comic">${CV.icons.chevronRight}</button>
              </div>`
            : ""
        }
      </div>`;

    // Blurred backdrops are set from JS so odd characters in URLs can't break the CSS
    featuredEl.querySelectorAll(".hero-backdrop").forEach((bg) => {
      bg.style.backgroundImage = `url(${JSON.stringify(bg.dataset.bg)})`;
    });
    if (n < 2) return;

    const slides = Array.from(featuredEl.querySelectorAll(".hero-card"));
    const dots = Array.from(featuredEl.querySelectorAll(".carousel-dot"));
    const carousel = featuredEl.querySelector(".carousel");
    let current = 0;
    let timer = null;
    let stopped = CV.reducedMotion(); // no auto-rotation for reduced-motion users
    let paused = false;

    function show(i) {
      current = (i + n) % n;
      slides.forEach((s, idx) => {
        const active = idx === current;
        s.classList.toggle("is-active", active);
        s.toggleAttribute("inert", !active);
        if (active) s.removeAttribute("aria-hidden");
        else s.setAttribute("aria-hidden", "true");
      });
      dots.forEach((d, idx) => (idx === current ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
    }

    function schedule() {
      clearInterval(timer);
      if (!stopped) timer = setInterval(() => !paused && !document.hidden && show(current + 1), ROTATE_MS);
    }

    // Any manual control stops the automatic rotation
    const userGo = (i) => {
      stopped = true;
      clearInterval(timer);
      show(i);
    };
    featuredEl.querySelectorAll("[data-dir]").forEach((b) => b.addEventListener("click", () => userGo(current + Number(b.dataset.dir))));
    dots.forEach((d) => d.addEventListener("click", () => userGo(Number(d.dataset.go))));

    carousel.addEventListener("mouseenter", () => (paused = true));
    carousel.addEventListener("mouseleave", () => (paused = false));
    carousel.addEventListener("focusin", () => (paused = true));
    carousel.addEventListener("focusout", () => (paused = false));

    // Swipe between slides on touch screens
    let startX = null;
    let startY = null;
    carousel.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );
    carousel.addEventListener(
      "touchend",
      (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        startX = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) userGo(current + (dx < 0 ? 1 : -1));
      },
      { passive: true }
    );

    schedule();
  }

  // ---- Data ---------------------------------------------------------------
  async function loadNewest() {
    const { data, error } = await db.from("comics").select(COMIC_FIELDS).order("created_at", { ascending: false }).limit(20);
    if (error) {
      console.error("Home: newest comics error:", error);
      featuredEl.innerHTML = '<p class="grid-message">Couldn\'t load featured comics. Please try again later.</p>';
      return;
    }
    if (!data.length) return renderWelcome();

    const withChapters = data.filter((c) => (c.chapters || []).length);
    const featured = withChapters.filter((c) => c.cover_url).slice(0, 5);
    renderCarousel(featured.length ? featured : (withChapters.length ? withChapters : data).slice(0, 1));

    newSeriesEl.innerHTML = `
      <section class="section" aria-labelledby="new-heading">
        <div class="section-heading-row">
          <h2 class="section-heading" id="new-heading">New series</h2>
          <div class="section-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-random>${CV.icons.shuffle} Surprise me</button>
            <a href="browse.html" class="see-all">See all &rarr;</a>
          </div>
        </div>
        ${CV.rowHtml(data.slice(0, 12).map((c) => CV.comicCard(c)).join(""), "New series")}
      </section>`;
    CV.initRows(newSeriesEl);
    newSeriesEl.querySelector("[data-random]").addEventListener("click", (e) => CV.goToRandomComic(db, e.currentTarget));
  }

  async function loadLatest() {
    latestGrid.innerHTML = CV.skeletonCards(6);
    const { data, error } = await db
      .from("chapters")
      .select("chapter_number, created_at, comics(slug, title, cover_url, reading_mode, genre, created_at)")
      .order("created_at", { ascending: false })
      .limit(48);

    if (error) {
      console.error("Home: latest updates error:", error);
      latestGrid.innerHTML = '<p class="grid-message">Couldn\'t load updates. Please try again later.</p>';
      return;
    }

    // One card per comic: its newest chapter
    const seen = new Set();
    const updates = [];
    for (const ch of data || []) {
      if (!ch.comics || seen.has(ch.comics.slug)) continue;
      seen.add(ch.comics.slug);
      updates.push(ch);
      if (updates.length === 12) break;
    }

    if (!updates.length) {
      latestGrid.innerHTML = '<p class="grid-message">No chapters published yet.</p>';
      return;
    }

    latestGrid.innerHTML = updates
      .map((ch) =>
        CV.comicCard(ch.comics, {
          href: CV.url.reader(ch.comics.slug, ch.chapter_number),
          subtitle: `Ch. ${ch.chapter_number} · ${CV.timeAgo(ch.created_at)}`,
          flag: CV.isRecent(ch.created_at) ? (CV.isRecent(ch.comics.created_at) ? "new" : "updated") : false,
        })
      )
      .join("");
  }

  async function loadGenres() {
    const results = await Promise.all(
      Object.keys(CV.GENRES).map(async (genre) => {
        const { data, error } = await db
          .from("comics")
          .select(COMIC_FIELDS)
          .eq("genre", genre)
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) console.error(`Home: ${genre} row error:`, error);
        return { genre, comics: error ? [] : data || [] };
      })
    );

    genreRowsEl.innerHTML = results
      .filter((r) => r.comics.length)
      .map(
        (r) => `
        <section class="section" aria-labelledby="genre-${r.genre}-heading">
          <div class="section-heading-row">
            <h2 class="section-heading" id="genre-${r.genre}-heading">${esc(CV.genreLabel(r.genre))}</h2>
            <a href="${CV.url.browse({ genre: r.genre })}" class="see-all">See all &rarr;</a>
          </div>
          ${CV.rowHtml(r.comics.map((c) => CV.comicCard(c)).join(""), CV.genreLabel(r.genre))}
        </section>`
      )
      .join("");
    CV.initRows(genreRowsEl);
  }

  renderContinue();
  loadNewest();
  loadLatest();
  loadGenres();
});
