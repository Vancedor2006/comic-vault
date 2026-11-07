/* ==========================================================================
   ComicVault - Reader
   reader.html?comic=<slug>&chapter=<number>[&page=<number>]

   - Always uses the creator's reading direction (vertical / LTR / RTL)
   - Single-page modes: arrow keys, click/tap sides, swipe, double-tap zoom,
     optional two-page spreads on wide screens, preloading
   - Vertical mode: progress tracking and (optionally) the next chapter loads
     automatically when you reach the end
   - Tap the middle of a page to hide all controls; fullscreen; settings
   - Remembers where you stopped (in this browser) for "Continue reading"
   ========================================================================== */

const READER_SETTINGS_KEY = "cv-reader";
const DEFAULT_READER_SETTINGS = { fit: "height", bg: "auto", gaps: false, spread: false, autoNext: true };

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const esc = CV.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const body = document.body;

  // Fill icon buttons from the shared icon set
  document.querySelectorAll("[data-icon]").forEach((btn) => btn.insertAdjacentHTML("afterbegin", CV.icons[btn.dataset.icon] || ""));

  const el = {
    main: $("main"),
    progressBar: $("reader-progress-bar"),
    backLink: $("back-link"),
    comicTitle: $("comic-title"),
    chapterTitle: $("chapter-title"),
    chapterSelect: $("chapter-select"),
    mobileSelect: $("chapter-select-mobile"),
    badge: $("mode-badge"),
    tip: $("reader-tip"),
    loading: $("reader-loading"),
    infinite: $("infinite-wrapper"),
    single: $("single-page-wrapper"),
    stage: $("page-stage"),
    prevPage: $("prev-page-btn"),
    nextPage: $("next-page-btn"),
    counter: $("page-counter"),
    end: $("chapter-end"),
    endTitle: $("chapter-end-title"),
    endText: $("chapter-end-text"),
    endActions: $("chapter-end-actions"),
    prevChapter: $("prev-chapter-btn"),
    nextChapter: $("next-chapter-btn"),
    mobilePrev: $("m-prev-chapter"),
    mobileNext: $("m-next-chapter"),
    scrollTop: $("scroll-top-btn"),
    settingsBtn: $("settings-btn"),
    mobileSettingsBtn: $("m-settings-btn"),
    fullscreenBtn: $("fullscreen-btn"),
    dialog: $("reader-settings"),
    settingsForm: $("settings-form"),
    fsSetting: $("fs-setting"),
    fsDialogBtn: $("fs-dialog-btn"),
  };

  // ---- State --------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("comic");
  const requestedChapter = Number(params.get("chapter"));
  const requestedPage = Math.max(1, parseInt(params.get("page"), 10) || 1);

  const stored = CV.store.get(READER_SETTINGS_KEY, {});
  const settings = { ...DEFAULT_READER_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) };

  let comic = null;
  let mode = "ltr";
  let chapters = []; // sorted [{ id, chapter_number, title }]
  let chapterIndex = -1;
  let pages = []; // image URLs of the current chapter (single-page mode)
  const pageCounts = new Map(); // chapter index -> number of pages

  // single-page mode
  let pageIndex = 0;
  let spreads = []; // [[0], [1, 2], ...]
  const dims = new Map(); // page index -> { w, h }
  const imageCache = new Map(); // url -> Promise<{ w, h }>
  let renderToken = 0;
  let zoomed = false;

  // vertical mode
  const segments = []; // { ci, el }
  let appending = false;
  let autoNextBlocked = false;
  let userScrolled = false; // don't fetch the next chapter until the reader actually scrolls
  let vCurrent = { ci: -1, page: -1 };

  const isRtl = () => mode === "rtl";
  const chapterLabel = (c) => `Chapter ${c.chapter_number}${c.title ? `: ${c.title}` : ""}`;
  const wideQuery = window.matchMedia("(min-width: 1000px) and (min-aspect-ratio: 1/1)");
  const isSpreadActive = () => mode !== "infinite" && settings.spread && wideQuery.matches;

  function showError(title, message) {
    el.main.innerHTML = `
      <div class="reader-error">
        <h1>${esc(title)}</h1>
        <p>${esc(message)}</p>
        <a href="${slug ? CV.url.series(slug) : "browse.html"}" class="btn">${slug ? "Back to series" : "Browse comics"}</a>
      </div>`;
    document.querySelector(".reader-mobile-bar").hidden = true;
  }

  // ---- Load ---------------------------------------------------------------
  async function fetchPages(chapterId) {
    const { data, error } = await db
      .from("pages")
      .select("image_url")
      .eq("chapter_id", chapterId)
      .order("page_number", { ascending: true });
    if (error) throw error;
    return (data || []).map((p) => p.image_url);
  }

  async function init() {
    applySettings();
    if (!slug) return showError("No comic selected", "Pick a comic from the browse page to start reading.");

    const { data, error } = await db
      .from("comics")
      .select("id, slug, title, reading_mode, cover_url, chapters(id, chapter_number, title)")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Reader error:", error);
      return showError("Couldn't load this comic", "Please check your connection and try again.");
    }
    if (!data) return showError("Comic not found", "It may have been removed, or the link is wrong.");

    comic = data;
    mode = ["infinite", "ltr", "rtl"].includes(data.reading_mode) ? data.reading_mode : "ltr";
    chapters = (data.chapters || []).slice().sort((a, b) => a.chapter_number - b.chapter_number);
    if (!chapters.length) return showError("No chapters yet", "This comic doesn't have any chapters published yet.");

    chapterIndex = chapters.findIndex((c) => c.chapter_number === requestedChapter);
    const chapterMatched = chapterIndex !== -1;
    if (!chapterMatched) chapterIndex = 0;

    try {
      pages = await fetchPages(chapters[chapterIndex].id);
    } catch (err) {
      console.error("Reader pages error:", err);
      return showError("Couldn't load the pages", "Please try again in a moment.");
    }
    pageCounts.set(chapterIndex, pages.length);

    setupChrome();
    updateChapterChrome();
    applySettings();
    el.loading.hidden = true;

    const startPage = chapterMatched ? requestedPage : 1;
    if (mode === "infinite") startVertical(startPage);
    else startSingle(startPage);
  }

  // ---- Toolbar, chapter lists, chapter links ------------------------------
  function setupChrome() {
    const m = CV.mode(mode);
    el.badge.textContent = m.short;
    el.badge.className = `badge ${m.cls}`;
    el.comicTitle.textContent = comic.title;
    el.comicTitle.href = CV.url.series(slug);
    el.backLink.href = CV.url.series(slug);

    const options = chapters.map((c) => `<option value="${c.chapter_number}">${esc(chapterLabel(c))}</option>`).join("");
    [el.chapterSelect, el.mobileSelect].forEach((select) => {
      select.innerHTML = options;
      select.disabled = false;
      select.addEventListener("change", () => {
        window.location.href = CV.url.reader(slug, select.value);
      });
    });

    const touchFirst = window.matchMedia("(hover: none)").matches;
    el.tip.hidden = false;
    if (mode === "infinite") {
      el.tip.textContent = touchFirst ? "Tip: tap a page to hide the controls." : "Tip: click a page to hide the controls.";
    } else {
      el.tip.innerHTML = touchFirst
        ? "Tip: swipe or tap the sides to turn pages. Tap the middle to hide the controls; double-tap to zoom."
        : "Tip: use <kbd>&larr;</kbd> <kbd>&rarr;</kbd> or click the sides of the page to turn pages. Click the middle to hide the controls; double-click (or press <kbd>Z</kbd>) to zoom.";
    }

    // Settings that only make sense for this reading mode
    el.dialog.querySelectorAll("[data-for]").forEach((fs) => {
      fs.hidden = fs.dataset.for !== (mode === "infinite" ? "vertical" : "single");
    });
  }

  function updateChapterChrome() {
    const ch = chapters[chapterIndex];
    document.title = `${comic.title} · Chapter ${ch.chapter_number} | ComicVault`;
    el.chapterTitle.textContent = chapterLabel(ch);
    el.chapterSelect.value = String(ch.chapter_number);
    el.mobileSelect.value = String(ch.chapter_number);
    const prev = chapters[chapterIndex - 1];
    const next = chapters[chapterIndex + 1];
    setChapterLink(el.prevChapter, prev);
    setChapterLink(el.mobilePrev, prev);
    setChapterLink(el.nextChapter, next);
    setChapterLink(el.mobileNext, next);
  }

  function setChapterLink(link, target) {
    if (target) {
      link.href = CV.url.reader(slug, target.chapter_number);
      link.removeAttribute("aria-disabled");
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
    }
  }

  // Keep the address bar pointing at the current chapter/page (refresh-safe)
  function syncUrl(ci, page) {
    try {
      history.replaceState(null, "", CV.url.reader(slug, chapters[ci].chapter_number, page));
    } catch {
      /* not allowed for files opened from disk; harmless */
    }
  }

  function goChapter(delta) {
    const target = chapters[chapterIndex + delta];
    if (target) window.location.href = CV.url.reader(slug, target.chapter_number);
  }

  // ---- Reading progress ----------------------------------------------------
  function saveProgress(ci, pageNumber, finished = false) {
    const ch = chapters[ci];
    const next = chapters[ci + 1];
    const base = { slug, title: comic.title, cover: comic.cover_url || "", mode };
    if (finished && next) {
      CV.progress.save({ ...base, chapter: next.chapter_number, chapterTitle: next.title || "", page: 1, pageCount: 0, upNext: true });
    } else {
      CV.progress.save({
        ...base,
        chapter: ch.chapter_number,
        chapterTitle: ch.title || "",
        page: pageNumber,
        pageCount: pageCounts.get(ci) || 0,
        done: finished,
      });
    }
  }

  function setProgressBar(fraction) {
    el.progressBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`;
  }

  // ---- Chapter end panel --------------------------------------------------
  function renderChapterEnd(ci, loadingNext = false) {
    const next = chapters[ci + 1];
    el.end.hidden = false;
    if (loadingNext && next) {
      el.endTitle.textContent = `End of chapter ${chapters[ci].chapter_number}`;
      el.endText.textContent = `Loading ${chapterLabel(next)}…`;
      el.endActions.innerHTML = "";
    } else if (next) {
      el.endTitle.textContent = "End of chapter";
      el.endText.textContent = `Up next: ${chapterLabel(next)}`;
      el.endActions.innerHTML = `<a href="${CV.url.reader(slug, next.chapter_number)}" class="btn btn-large">Read chapter ${next.chapter_number} &raquo;</a>`;
    } else {
      el.endTitle.textContent = "You're all caught up!";
      el.endText.textContent = "That's the latest chapter. Check back later for more.";
      el.endActions.innerHTML = `
        <a href="${CV.url.series(slug)}" class="btn btn-secondary">Back to series</a>
        <a href="browse.html" class="btn">Find more comics</a>`;
    }
  }

  // ======================================================================
  // Single-page mode (LTR / RTL)
  // ======================================================================
  function startSingle(startPage) {
    el.single.hidden = false;
    el.counter.hidden = false;
    if (!pages.length) {
      el.stage.innerHTML = '<p class="page-error">This chapter has no pages yet.</p>';
      el.counter.hidden = true;
      renderChapterEnd(chapterIndex);
      return;
    }
    rebuildSpreads();
    showAt(Math.min(startPage, pages.length) - 1, { scroll: false });
  }

  function loadImage(url, index) {
    if (!imageCache.has(url)) {
      imageCache.set(
        url,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => {
            imageCache.delete(url); // allow a retry later
            reject(new Error(`Couldn't load page ${index + 1}`));
          };
          img.src = url;
        })
      );
    }
    return imageCache.get(url).then((d) => {
      noteDims(index, d);
      return d;
    });
  }

  const isLandscape = (i) => {
    const d = dims.get(i);
    return !!d && d.w > d.h * 1.05;
  };

  function rebuildSpreads() {
    spreads = [];
    if (!isSpreadActive()) {
      spreads = pages.map((_, i) => [i]);
      return;
    }
    // Cover alone, then pairs; wide (already double-page) images stay alone
    let i = 0;
    while (i < pages.length) {
      if (i === 0 || i === pages.length - 1 || isLandscape(i) || isLandscape(i + 1)) {
        spreads.push([i]);
        i += 1;
      } else {
        spreads.push([i, i + 1]);
        i += 2;
      }
    }
  }

  const spreadOf = (page) => spreads.find((s) => s.includes(page)) || [page];

  // A page turned out to be landscape: recompute spreads, redraw if needed
  function noteDims(index, d) {
    if (dims.has(index)) return;
    dims.set(index, d);
    if (!isSpreadActive() || !isLandscape(index)) return;
    const before = spreadOf(pageIndex).join(",");
    rebuildSpreads();
    if (spreadOf(pageIndex).join(",") !== before) showAt(pageIndex, { scroll: false });
  }

  function showAt(page, { scroll = true } = {}) {
    if (!pages.length) return;
    const spread = spreadOf(Math.max(0, Math.min(page, pages.length - 1)));
    pageIndex = spread[0];
    setZoom(false);

    const token = ++renderToken;
    const slowTimer = setTimeout(() => token === renderToken && el.single.classList.add("is-loading"), 150);

    Promise.all(spread.map((i) => loadImage(pages[i], i)))
      .then(async () => {
        if (token !== renderToken) return;
        // Build the new page images and wait until they're fully decoded, so
        // they have their real size the moment they're shown (no collapse,
        // no layout jump, and the old page stays up until the new one is ready)
        const imgs = spread.map((i) => {
          const img = new Image();
          img.src = pages[i];
          img.alt = `Page ${i + 1} of ${pages.length}`;
          img.draggable = false;
          return img;
        });
        await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
        if (token !== renderToken) return;
        el.stage.classList.toggle("is-spread", spread.length > 1);
        el.stage.classList.toggle("is-rtl", isRtl());
        el.stage.replaceChildren(...imgs);
        if (scroll) alignPage();
      })
      .catch((err) => {
        if (token !== renderToken) return;
        el.stage.classList.remove("is-spread");
        el.stage.innerHTML = `<div class="page-error"><p>${esc(err.message)}.</p><button type="button" class="btn btn-sm" data-retry>Try again</button></div>`;
        el.stage.querySelector("[data-retry]").addEventListener("click", () => showAt(pageIndex, { scroll: false }));
      })
      .finally(() => {
        clearTimeout(slowTimer);
        if (token === renderToken) el.single.classList.remove("is-loading");
      });

    // Counter, progress, URL, end panel
    const last = spread[spread.length - 1];
    el.counter.textContent =
      spread.length > 1 ? `Pages ${spread[0] + 1}–${last + 1} of ${pages.length}` : `Page ${spread[0] + 1} of ${pages.length}`;
    setProgressBar((last + 1) / pages.length);
    syncUrl(chapterIndex, pageIndex + 1);
    const atEnd = last === pages.length - 1;
    if (atEnd) renderChapterEnd(chapterIndex);
    else el.end.hidden = true;
    saveProgress(chapterIndex, pageIndex + 1, atEnd);

    // Preload what comes next (and, for spreads, learn page shapes early)
    const k = spreads.findIndex((s) => s[0] === pageIndex);
    [1, 2].forEach((ahead) => (spreads[k + ahead] || []).forEach((i) => loadImage(pages[i], i).catch(() => {})));
    (spreads[k - 1] || []).forEach((i) => loadImage(pages[i], i).catch(() => {}));

  }

  // After a page turn, line the page up under the header if any of it is cut
  // off (above the screen, or under the phone's bottom bar)
  function alignPage() {
    const r = el.single.getBoundingClientRect();
    const bar = document.querySelector(".reader-mobile-bar");
    const header = document.querySelector(".site-header");
    const barHeight = bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0;
    const headerHeight = header && getComputedStyle(header).display !== "none" ? header.offsetHeight : 0;
    const topGap = headerHeight + 8;
    if (r.top < topGap || r.bottom > window.innerHeight - barHeight) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - topGap), behavior: "auto" });
    }
  }

  // forward = next page in story order, whatever the reading direction
  function turn(forward) {
    if (mode === "infinite" || !pages.length) return;
    const k = spreads.findIndex((s) => s[0] === pageIndex);
    const target = spreads[k + (forward ? 1 : -1)];
    if (target) showAt(target[0]);
    else if (forward) el.end.scrollIntoView({ behavior: CV.reducedMotion() ? "auto" : "smooth", block: "center" });
  }

  // ---- Zoom (double-tap / double-click / Z) --------------------------------
  function setZoom(on, point) {
    if (mode === "infinite" || zoomed === on) return;
    zoomed = on;
    el.single.classList.toggle("is-zoomed", on);
    if (on && point) {
      requestAnimationFrame(() => {
        el.stage.scrollLeft = point.fx * el.stage.scrollWidth - el.stage.clientWidth / 2;
        el.stage.scrollTop = point.fy * el.stage.scrollHeight - el.stage.clientHeight / 2;
      });
    }
  }

  function toggleZoom(event) {
    if (zoomed) return setZoom(false);
    const r = el.stage.getBoundingClientRect();
    const point = event
      ? { fx: (event.clientX - r.left) / r.width, fy: (event.clientY - r.top) / r.height }
      : { fx: 0.5, fy: 0.25 };
    setZoom(true, point);
  }

  // ---- Immersive mode (hide everything but the comic) ---------------------
  function setImmersive(on) {
    body.classList.toggle("is-immersive", on);
    if (on && !CV.store.get("cv-immersive-tip")) {
      CV.toast("Controls hidden. Tap the middle of the page again (or press Esc) to bring them back.", "info", 4000);
      CV.store.set("cv-immersive-tip", true);
    }
  }
  const toggleImmersive = () => setImmersive(!body.classList.contains("is-immersive"));

  // ---- Clicks, taps and swipes (single-page) ------------------------------
  let lastSwipeAt = 0;
  const swipedRecently = () => Date.now() - lastSwipeAt < 450;

  el.prevPage.addEventListener("click", () => !swipedRecently() && turn(isRtl())); // left side
  el.nextPage.addEventListener("click", () => !swipedRecently() && turn(!isRtl())); // right side

  // Middle of the page: one tap = hide/show controls, two taps = zoom
  let tapTimer = null;
  el.stage.addEventListener("click", (e) => {
    if (swipedRecently() || e.target.closest("button")) return;
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      toggleZoom(e);
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = null;
      toggleImmersive();
    }, 260);
  });

  let touchStart = null;
  const pinchZoomed = () => !!window.visualViewport && window.visualViewport.scale > 1.05;
  el.single.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1 || zoomed || pinchZoomed()) {
        touchStart = null;
        return;
      }
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    },
    { passive: true }
  );
  el.single.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const dt = Date.now() - touchStart.time;
      touchStart = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
        lastSwipeAt = Date.now();
        // Swiping left = the same as pressing the right arrow
        turn(dx < 0 ? !isRtl() : isRtl());
      }
    },
    { passive: true }
  );
  el.single.addEventListener("touchcancel", () => (touchStart = null), { passive: true });

  // ======================================================================
  // Vertical (webtoon) mode
  // ======================================================================
  // The page crossing a line 40% down the screen is the "current" page
  const pageObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) =>
            entries.forEach((en) => {
              if (en.isIntersecting) setVerticalCurrent(Number(en.target.dataset.ci), Number(en.target.dataset.page));
            }),
          { rootMargin: "-40% 0px -59% 0px" }
        )
      : null;

  // Start loading the next chapter when the end panel gets close
  const endNearObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => entries.some((en) => en.isIntersecting) && maybeAppendNext(), {
          rootMargin: "0px 0px 1200px 0px",
        })
      : null;

  // Reaching the end panel counts as finishing the (last loaded) chapter
  let endVisible = false;
  const lastSegmentCi = () => (segments.length ? segments[segments.length - 1].ci : chapterIndex);
  const saveFinished = () => saveProgress(lastSegmentCi(), pageCounts.get(lastSegmentCi()) || 1, true);
  const endSeenObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          endVisible = entries.some((en) => en.isIntersecting);
          if (endVisible && segments.length) saveFinished();
        })
      : null;

  function startVertical(startPage) {
    el.infinite.hidden = false;
    appendSegment(chapterIndex, pages, false);
    updateVerticalEnd();
    if (endNearObserver) endNearObserver.observe(el.end);
    if (endSeenObserver) endSeenObserver.observe(el.end);
    window.addEventListener("scroll", onVerticalScroll, { passive: true });
    window.addEventListener("resize", onVerticalScroll, { passive: true });
    onVerticalScroll();
    if (startPage > 1) resumeVertical(startPage);
    else saveProgress(chapterIndex, 1);
  }

  function appendSegment(ci, urls, withDivider) {
    const seg = document.createElement("section");
    seg.className = "chapter-segment";
    seg.setAttribute("aria-label", chapterLabel(chapters[ci]));
    seg.innerHTML =
      (withDivider ? `<h2 class="segment-divider"><small>Next chapter</small>${esc(chapterLabel(chapters[ci]))}</h2>` : "") +
      (urls.length
        ? urls
            .map(
              (url, i) =>
                `<img src="${esc(url)}" alt="${esc(chapterLabel(chapters[ci]))}, page ${i + 1} of ${urls.length}" class="webtoon-page" data-ci="${ci}" data-page="${i}"${withDivider || i > 2 ? ' loading="lazy"' : ""} decoding="async">`
            )
            .join("")
        : '<p class="page-error">This chapter has no pages yet.</p>');
    el.infinite.appendChild(seg);

    const imgs = Array.from(seg.querySelectorAll("img"));
    let pending = imgs.length;
    const isFirst = segments.length === 0;
    imgs.forEach((img) => {
      const loaded = () => {
        img.classList.add("is-loaded");
        if (--pending === 0 && isFirst) onFirstChapterLoaded();
      };
      if (img.complete && img.naturalWidth) loaded();
      else {
        img.addEventListener("load", loaded, { once: true });
        img.addEventListener("error", loaded, { once: true });
      }
      if (pageObserver) pageObserver.observe(img);
    });
    segments.push({ ci, el: seg });
    pageCounts.set(ci, urls.length);
    if (isFirst && !imgs.length) onFirstChapterLoaded();
  }

  // A chapter too short to scroll: allow the next one to load straight away
  function onFirstChapterLoaded() {
    if (document.documentElement.scrollHeight <= window.innerHeight + 4) {
      userScrolled = true;
      checkNearEnd();
    }
  }

  function checkNearEnd() {
    if (el.end.getBoundingClientRect().top < window.innerHeight + 1200) maybeAppendNext();
  }

  function updateVerticalEnd(loadingNext = false) {
    const lastCi = segments.length ? segments[segments.length - 1].ci : chapterIndex;
    renderChapterEnd(lastCi, loadingNext);
    if (!loadingNext && settings.autoNext && !autoNextBlocked && chapters[lastCi + 1]) {
      el.endText.textContent = `Keep scrolling: ${chapterLabel(chapters[lastCi + 1])} loads automatically.`;
    }
  }

  async function maybeAppendNext() {
    if (mode !== "infinite" || !settings.autoNext || autoNextBlocked || appending || !userScrolled || !segments.length) return;
    const lastCi = segments[segments.length - 1].ci;
    const next = chapters[lastCi + 1];
    if (!next) return;

    appending = true;
    updateVerticalEnd(true);
    try {
      const urls = await fetchPages(next.id);
      appendSegment(lastCi + 1, urls, true);
    } catch (err) {
      console.error("Couldn't load the next chapter:", err);
      autoNextBlocked = true; // stop retrying in a loop; the button still works
      CV.toast("Couldn't load the next chapter automatically. Use the button to open it.", "error");
    } finally {
      appending = false;
      updateVerticalEnd();
    }
    // Very short chapters: the end panel may still be close, so check again
    requestAnimationFrame(checkNearEnd);
  }

  const saveVerticalProgress = (() => {
    let timer = null;
    return () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (vCurrent.ci < 0) return;
        // Don't overwrite "finished" while the end-of-chapter panel is on screen
        if (endVisible && vCurrent.ci === lastSegmentCi()) saveFinished();
        else saveProgress(vCurrent.ci, vCurrent.page + 1);
        syncUrl(vCurrent.ci, vCurrent.page + 1);
      }, 700);
    };
  })();

  function setVerticalCurrent(ci, page) {
    if (ci === vCurrent.ci && page === vCurrent.page) return;
    vCurrent = { ci, page };
    if (ci !== chapterIndex) {
      chapterIndex = ci;
      updateChapterChrome();
    }
    saveVerticalProgress();
  }

  let scrollQueued = false;
  function onVerticalScroll() {
    if (!userScrolled && window.scrollY > 20) {
      userScrolled = true;
      checkNearEnd(); // the end panel may already be in range (no new intersection event)
    }
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const seg = segments.find((s) => s.ci === chapterIndex);
      if (!seg) return;
      // How much of the current chapter has come into view (100% at its last page)
      const r = seg.el.getBoundingClientRect();
      setProgressBar(r.height ? (window.innerHeight - r.top) / r.height : 0);
    });
  }

  // Jump to a saved page: load the pages above it first so the position is right
  async function resumeVertical(pageNumber) {
    const imgs = Array.from(segments[0].el.querySelectorAll("img"));
    const target = imgs[Math.min(pageNumber, imgs.length) - 1];
    if (!target) return;
    const above = imgs.slice(0, imgs.indexOf(target) + 1);
    above.forEach((img) => {
      img.loading = "eager";
    });
    const waitFor = (img) =>
      img.complete
        ? null
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
    await Promise.race([Promise.all(above.map(waitFor)), new Promise((r) => setTimeout(r, 8000))]);
    target.scrollIntoView({ block: "start" });
  }

  // Tap a page (vertical mode) to hide/show the controls
  el.infinite.addEventListener("click", (e) => {
    if (e.target.closest(".webtoon-page")) toggleImmersive();
  });

  // ======================================================================
  // Settings, fullscreen, keyboard
  // ======================================================================
  function applySettings() {
    body.classList.toggle("fit-width", settings.fit === "width");
    body.classList.remove("bg-black", "bg-gray", "bg-white");
    if (["black", "gray", "white"].includes(settings.bg)) body.classList.add(`bg-${settings.bg}`);
    body.classList.toggle("has-gaps", !!settings.gaps);
    body.classList.toggle("is-spread-mode", isSpreadActive());
  }

  function syncSettingsForm() {
    const f = el.settingsForm;
    f.querySelectorAll('input[name="fit"]').forEach((r) => (r.checked = r.value === settings.fit));
    f.querySelectorAll('input[name="bg"]').forEach((r) => (r.checked = r.value === settings.bg));
    f.elements.gaps.checked = !!settings.gaps;
    f.elements.autoNext.checked = !!settings.autoNext;
    f.elements.spread.checked = !!settings.spread;
    f.elements.spread.disabled = !wideQuery.matches;
    $("spread-hint").hidden = wideQuery.matches;
  }

  function openSettings() {
    syncSettingsForm();
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
    else el.dialog.setAttribute("open", "");
  }

  el.settingsBtn.addEventListener("click", openSettings);
  el.mobileSettingsBtn.addEventListener("click", openSettings);
  el.dialog.addEventListener("click", (e) => {
    if (e.target === el.dialog) el.dialog.close(); // click on the backdrop
  });

  el.settingsForm.addEventListener("change", (e) => {
    const input = e.target;
    const wasSpread = isSpreadActive();
    if (input.name === "fit" || input.name === "bg") settings[input.name] = input.value;
    else if (["gaps", "autoNext", "spread"].includes(input.name)) settings[input.name] = input.checked;
    CV.store.set(READER_SETTINGS_KEY, settings);
    applySettings();

    if (mode !== "infinite" && comic && pages.length) {
      setZoom(false);
      if (wasSpread !== isSpreadActive()) {
        rebuildSpreads();
        showAt(pageIndex, { scroll: false });
      }
    }
    if (input.name === "autoNext" && mode === "infinite" && comic) {
      updateVerticalEnd();
      if (settings.autoNext) maybeAppendNext();
    }
  });

  const onWideChange = () => {
    applySettings();
    if (el.dialog.open) syncSettingsForm();
    if (mode !== "infinite" && comic && pages.length) {
      rebuildSpreads();
      showAt(pageIndex, { scroll: false });
    }
  };
  if (wideQuery.addEventListener) wideQuery.addEventListener("change", onWideChange);

  // Fullscreen (not available on iPhone; the buttons stay hidden there)
  const fsEnabled = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFullscreen() {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    const result = request && request.call(root);
    if (result && result.catch) result.catch(() => CV.toast("Fullscreen isn't available here.", "error"));
  }
  function updateFullscreenUi() {
    const on = isFullscreen();
    el.fullscreenBtn.innerHTML = on ? CV.icons.shrink : CV.icons.expand;
    el.fullscreenBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
    el.fullscreenBtn.title = on ? "Exit fullscreen (F)" : "Fullscreen (F)";
    el.fsDialogBtn.textContent = on ? "Exit fullscreen" : "Enter fullscreen";
  }
  if (fsEnabled) {
    el.fullscreenBtn.hidden = false;
    el.fsSetting.hidden = false;
    el.fullscreenBtn.addEventListener("click", toggleFullscreen);
    el.fsDialogBtn.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", updateFullscreenUi);
    document.addEventListener("webkitfullscreenchange", updateFullscreenUi);
    updateFullscreenUi();
  }

  el.scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: CV.reducedMotion() ? "auto" : "smooth" }));

  document.addEventListener("keydown", (e) => {
    if (!comic || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (el.dialog.open || (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]"))) return;
    const single = mode !== "infinite";
    switch (e.key) {
      case "ArrowRight":
        if (single) {
          e.preventDefault();
          turn(!isRtl());
        }
        break;
      case "ArrowLeft":
        if (single) {
          e.preventDefault();
          turn(isRtl());
        }
        break;
      case "Home":
        if (single && pages.length) {
          e.preventDefault();
          showAt(0);
        }
        break;
      case "End":
        if (single && pages.length) {
          e.preventDefault();
          showAt(pages.length - 1);
        }
        break;
      case "[":
        goChapter(-1);
        break;
      case "]":
        goChapter(1);
        break;
      case "f":
      case "F":
        if (fsEnabled) toggleFullscreen();
        break;
      case "z":
      case "Z":
        if (single && pages.length) toggleZoom(null);
        break;
      case "Escape":
        if (zoomed) setZoom(false);
        else if (body.classList.contains("is-immersive")) setImmersive(false);
        break;
      default:
        break;
    }
  });

  init();
});
