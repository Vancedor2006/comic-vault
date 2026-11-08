/* ==========================================================================
   ComicVault - common.js
   --------------------------------------------------------------------------
   Loaded FIRST on every page, as the first thing inside <body>, before the
   Supabase scripts. It:
     - draws the shared header and footer (edit them here, once)
     - applies the light/dark theme and handles the theme toggle + mobile menu
     - provides shared helpers on window.CV (escaping, labels, links, dates,
       comic cards, toasts, local storage, reading progress)
   ========================================================================== */
(function () {
  "use strict";

  const CV = (window.CV = window.CV || {});

  // ---- Page + auth-link handling --------------------------------------------
  // Supabase puts login/password-reset tokens in the URL hash. Keep a copy
  // before the Supabase library (loaded later) reads and removes it.
  CV.initialHash = window.location.hash;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  // Hosts like Cloudflare Pages drop ".html" from addresses (/comic instead of
  // /comic.html), so normalise the page name back to "comic.html".
  CV.page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (!CV.page.endsWith(".html")) CV.page += ".html";
  CV.here = CV.page + window.location.search; // used for "come back here after login"

  // App manifest ("Add to Home Screen"). Added here instead of in each page's
  // <head> because browsers refuse to load it from a file opened from disk.
  if (/^https?:$/.test(window.location.protocol)) {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "manifest.webmanifest";
    document.head.appendChild(manifest);
  }

  // A password-reset link can land on any page (Supabase falls back to the
  // Site URL). Send it to the reset page with its tokens intact.
  if (hashParams.get("type") === "recovery" && CV.page !== "reset-password.html") {
    window.location.replace("reset-password.html" + window.location.hash);
  }

  // ---- Safe local storage (never throws in private mode etc.) ---------------
  CV.store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };

  // ---- Small helpers ------------------------------------------------------
  CV.escapeHtml = (str) =>
    String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  CV.debounce = (fn, ms) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  CV.reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // LIKE pattern that matches the typed text literally (escapes % _ and \)
  CV.likePattern = (text) => `%${String(text).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  // Wrap a value in double quotes for Supabase .or() filters
  CV.pgQuote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  // ---- Labels -------------------------------------------------------------
  CV.GENRES = {
    action: "Action",
    fantasy: "Fantasy",
    romance: "Romance",
    scifi: "Sci-Fi",
    "slice-of-life": "Slice of Life",
  };
  CV.MODES = {
    infinite: { short: "Vertical Scroll", long: "Vertical scroll (webtoon)", cls: "badge-infinite" },
    rtl: { short: "Manga (RTL)", long: "Manga (right to left)", cls: "badge-rtl" },
    ltr: { short: "Western (LTR)", long: "Western (left to right)", cls: "badge-ltr" },
  };
  CV.mode = (m) => CV.MODES[m] || CV.MODES.ltr;
  CV.genreLabel = (g) => CV.GENRES[g] || g || "";

  // ---- Links --------------------------------------------------------------
  const enc = encodeURIComponent;
  CV.url = {
    series: (slug) => `comic.html?comic=${enc(slug)}`,
    reader: (slug, chapter, page) =>
      `reader.html?comic=${enc(slug)}&chapter=${enc(chapter)}${page > 1 ? `&page=${enc(page)}` : ""}`,
    profile: (id) => `profile.html?id=${enc(id)}`,
    browse: (params = {}) => {
      const p = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && p.set(k, v));
      const qs = p.toString();
      return qs ? `browse.html?${qs}` : "browse.html";
    },
    login: () => `login.html?next=${enc(CV.here)}`,
  };

  // ---- Dates --------------------------------------------------------------
  CV.timeAgo = (date) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [name, secs] of units) {
      const n = Math.floor(seconds / secs);
      if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
    }
    return "just now";
  };
  CV.formatDate = (date) =>
    new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  CV.isRecent = (date, days = 7) => !!date && Date.now() - new Date(date).getTime() < days * 86400000;
  CV.latestDate = (items, key = "created_at") =>
    (items || []).reduce((max, it) => (it[key] && (!max || new Date(it[key]) > new Date(max)) ? it[key] : max), null);

  // ---- Icons (inline SVG, inherit text colour) ----------------------------
  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  CV.icons = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
    moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    chevronLeft: svg('<path d="m15 18-6-6 6-6"/>'),
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    settings: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    expand: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    shrink: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>'),
    grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    filter: svg('<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>'),
  };

  const LOGO =
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(-6 32 32)">' +
    '<rect x="7" y="7" width="50" height="50" rx="6" fill="#ffd400" stroke="#141414" stroke-width="3"/>' +
    '<rect x="15" y="15" width="15" height="34" rx="2.5" fill="#141414"/>' +
    '<path d="M36.5 15h10a2.5 2.5 0 0 1 2.5 2.5v9.3L34 30.4V17.5a2.5 2.5 0 0 1 2.5-2.5z" fill="#141414"/>' +
    '<path d="M34 34.6l15-3.6v15.5a2.5 2.5 0 0 1-2.5 2.5h-10a2.5 2.5 0 0 1-2.5-2.5z" fill="#141414"/>' +
    "</g></svg>";

  // ---- Theme --------------------------------------------------------------
  const THEME_KEY = "cv-theme";
  const systemLight = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const effectiveTheme = () =>
    document.documentElement.dataset.theme || (systemLight && systemLight.matches ? "light" : "dark");

  function syncThemeUi() {
    const theme = effectiveTheme();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f0e6" : "#101114");
    document.querySelectorAll(".theme-toggle").forEach((btn) => {
      const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.innerHTML = theme === "light" ? CV.icons.moon : CV.icons.sun;
    });
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    syncThemeUi();
  }

  CV.toggleTheme = () => {
    const next = effectiveTheme() === "light" ? "dark" : "light";
    CV.store.set(THEME_KEY, next);
    applyTheme(next);
  };

  applyTheme(CV.store.get(THEME_KEY));
  if (systemLight && systemLight.addEventListener) systemLight.addEventListener("change", syncThemeUi);

  // ---- Toasts -------------------------------------------------------------
  CV.toast = (message, type = "info", ms = 4500) => {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
  };

  // A message to show after the next page load (e.g. "Series deleted")
  CV.flash = (message, type = "success") => {
    try {
      sessionStorage.setItem("cv-flash", JSON.stringify({ message, type }));
    } catch {
      /* ignore */
    }
  };

  // ---- Reading progress (saved in this browser only) ----------------------
  const PROGRESS_KEY = "cv-progress";
  const MAX_PROGRESS = 60;
  CV.progress = {
    all() {
      const data = CV.store.get(PROGRESS_KEY, {});
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    },
    get(slug) {
      return this.all()[slug] || null;
    },
    save(entry) {
      const data = this.all();
      data[entry.slug] = { ...entry, updatedAt: Date.now() };
      const keys = Object.keys(data);
      if (keys.length > MAX_PROGRESS) {
        keys
          .sort((a, b) => (data[a].updatedAt || 0) - (data[b].updatedAt || 0))
          .slice(0, keys.length - MAX_PROGRESS)
          .forEach((k) => delete data[k]);
      }
      CV.store.set(PROGRESS_KEY, data);
    },
    list() {
      return Object.values(this.all())
        .filter((e) => e && e.slug)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    remove(slug) {
      const data = this.all();
      delete data[slug];
      CV.store.set(PROGRESS_KEY, data);
    },
  };

  // ---- Comic cards --------------------------------------------------------
  CV.coverImg = (url, title, cls = "comic-cover", lazy = true) =>
    url
      ? `<img src="${CV.escapeHtml(url)}" alt="" class="${cls}"${lazy ? ' loading="lazy"' : ""} decoding="async" data-title="${CV.escapeHtml(title)}" onload="this.classList.add('is-loaded')" onerror="CV.coverFailed(this)">`
      : `<div class="${cls} cover-fallback">${CV.escapeHtml(title)}</div>`;

  // Swap a broken cover image for a title card
  CV.coverFailed = (img) => {
    const div = document.createElement("div");
    div.className = img.className.replace(/\bis-loaded\b/, "").trim() + " cover-fallback";
    div.textContent = img.dataset.title || "";
    img.replaceWith(div);
  };

  /**
   * comic: { slug, title, cover_url, reading_mode, genre, synopsis, created_at,
   *          profiles: { username }, chapters: [{ chapter_number, created_at }] }
   * opts:  href, subtitle (plain text), flag ("new" | "updated" | false),
   *        progress (0..1), extra (HTML placed after the link)
   */
  CV.comicCard = (comic, opts = {}) => {
    const esc = CV.escapeHtml;
    const chapters = comic.chapters || [];
    const latest = CV.latestDate(chapters);
    const mode = CV.mode(comic.reading_mode);
    const author = comic.profiles && comic.profiles.username;
    const href = opts.href || CV.url.series(comic.slug);

    let flag = opts.flag;
    if (flag === undefined) {
      flag = CV.isRecent(comic.created_at) ? "new" : CV.isRecent(latest) ? "updated" : false;
    }
    const flagHtml =
      flag === "new" ? '<span class="cover-flag">New</span>' : flag === "updated" ? '<span class="cover-flag is-updated">Updated</span>' : "";

    let subtitle = opts.subtitle;
    if (subtitle === undefined) {
      subtitle = chapters.length
        ? `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}${latest ? ` · updated ${CV.timeAgo(latest)}` : ""}`
        : "No chapters yet";
    }

    const progressHtml =
      typeof opts.progress === "number"
        ? `<span class="card-progress" aria-hidden="true"><span style="width:${Math.round(Math.min(1, Math.max(0, opts.progress)) * 100)}%"></span></span>`
        : "";

    return `
      <article class="card-item">
        <a href="${href}" class="comic-card">
          <div class="cover-container">
            <span class="badge ${mode.cls}">${mode.short}</span>
            ${flagHtml}
            ${CV.coverImg(comic.cover_url, comic.title)}
            ${progressHtml}
          </div>
          <div class="comic-meta">
            <h3 class="comic-title">${esc(comic.title)}</h3>
            ${author ? `<p class="comic-author">By ${esc(author)}</p>` : ""}
            <span class="comic-chapter">${esc(subtitle)}</span>
            ${comic.genre || comic.reading_mode ? `<div class="tags">${comic.genre ? `<span class="tag">${esc(CV.genreLabel(comic.genre))}</span>` : ""}<span class="tag tag-mode">${mode.short}</span></div>` : ""}
            ${comic.synopsis ? `<p class="comic-synopsis">${esc(comic.synopsis)}</p>` : ""}
          </div>
        </a>
        ${opts.extra || ""}
      </article>`;
  };

  CV.skeletonCards = (n) =>
    Array.from(
      { length: n },
      () => '<div class="comic-card skeleton" aria-hidden="true"><div class="comic-cover"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>'
    ).join("");

  // Horizontal row of cards with scroll buttons (buttons show on mouse hover)
  CV.rowHtml = (cardsHtml, label) => `
    <div class="row-wrap">
      <button type="button" class="row-btn prev" aria-label="Scroll ${CV.escapeHtml(label)} left" tabindex="-1" hidden>${CV.icons.chevronLeft}</button>
      <div class="comic-row" role="list" aria-label="${CV.escapeHtml(label)}">${cardsHtml}</div>
      <button type="button" class="row-btn next" aria-label="Scroll ${CV.escapeHtml(label)} right" tabindex="-1" hidden>${CV.icons.chevronRight}</button>
    </div>`;

  CV.initRows = (root) => {
    root.querySelectorAll(".row-wrap").forEach((wrap) => {
      const row = wrap.querySelector(".comic-row");
      const prev = wrap.querySelector(".row-btn.prev");
      const next = wrap.querySelector(".row-btn.next");
      row.querySelectorAll(":scope > .card-item").forEach((el) => el.setAttribute("role", "listitem"));
      const update = () => {
        prev.hidden = row.scrollLeft <= 4;
        next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
      };
      const scroll = (dir) =>
        row.scrollBy({ left: dir * row.clientWidth * 0.9, behavior: CV.reducedMotion() ? "auto" : "smooth" });
      prev.addEventListener("click", () => scroll(-1));
      next.addEventListener("click", () => scroll(1));
      row.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      update();
    });
  };

  // Pick a random comic and open its series page
  CV.goToRandomComic = async (db, btn) => {
    if (btn) btn.disabled = true;
    try {
      const { count, error } = await db.from("comics").select("id", { count: "exact", head: true });
      if (error) throw error;
      if (!count) {
        CV.toast("There are no comics to pick from yet.");
        if (btn) btn.disabled = false;
        return;
      }
      const offset = Math.floor(Math.random() * count);
      const { data, error: pickError } = await db
        .from("comics")
        .select("slug")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset);
      if (pickError || !data || !data.length) throw pickError || new Error("No comic found");
      window.location.href = CV.url.series(data[0].slug);
    } catch (err) {
      console.error("Random comic error:", err);
      CV.toast("Couldn't pick a random comic right now. Please try again.", "error");
      if (btn) btn.disabled = false;
    }
  };

  // ---- Shared header ------------------------------------------------------
  const NAV = [
    ["index.html", "Home"],
    ["browse.html", "Browse"],
    ["upload.html", "Publish"],
  ];
  const activeAttr = (href) => (href === CV.page ? ' class="active" aria-current="page"' : "");

  function searchForm(variant) {
    const id = `site-search-${variant}`;
    return `
      <form class="header-search header-search--${variant}" role="search" action="browse.html" method="get" autocomplete="off">
        <label class="visually-hidden" for="${id}">Search comics</label>
        <span class="search-icon">${CV.icons.search}</span>
        <input id="${id}" class="input-field" type="search" name="q" placeholder="Search comics…" autocomplete="off" spellcheck="false"
               role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
        <ul class="search-suggestions" id="${id}-list" role="listbox" aria-label="Search suggestions" hidden></ul>
      </form>`;
  }

  const headerHtml = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="container nav-wrapper">
        <a href="index.html" class="logo" aria-label="ComicVault home"><span class="logo-mark">${LOGO}</span><span class="logo-text">ComicVault</span></a>
        ${searchForm("bar")}
        <nav class="site-nav" id="site-nav" aria-label="Main">
          ${searchForm("panel")}
          <ul class="nav-links">
            ${NAV.map(([href, label]) => `<li><a href="${href}"${activeAttr(href)}>${label}</a></li>`).join("")}
            <li class="nav-dashboard" hidden><a href="dashboard.html"${activeAttr("dashboard.html")}>My Comics</a></li>
          </ul>
          <div class="nav-user" id="nav-user-container"></div>
        </nav>
        <button type="button" class="icon-btn theme-toggle"></button>
        <button type="button" class="icon-btn nav-toggle" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">${CV.icons.menu}</button>
      </div>
    </header>`;

  const footerHtml = `
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <a href="index.html" class="logo"><span class="logo-mark">${LOGO}</span><span class="logo-text">ComicVault</span></a>
          <p>Read webcomics the way their creators intended.</p>
        </div>
        <nav class="footer-links" aria-label="Footer">
          <a href="browse.html">Browse</a>
          <a href="upload.html">Publish</a>
          <a href="about.html">About</a>
          <a href="terms.html">Terms &amp; rules</a>
          <a href="about.html#contact">Contact</a>
        </nav>
        <p class="footer-copy">&copy; ${new Date().getFullYear()} ComicVault. Built for webcomic creators and readers.</p>
      </div>
    </footer>`;

  const script = document.currentScript;
  if (script && document.body && document.body.dataset.header !== "none") {
    script.insertAdjacentHTML("afterend", headerHtml);
    if (CV.page === "browse.html") document.body.classList.add("page-browse");
    syncThemeUi();
    initHeader();
  }

  function initHeader() {
    document.querySelectorAll(".theme-toggle").forEach((btn) => btn.addEventListener("click", CV.toggleTheme));

    const toggle = document.querySelector(".nav-toggle");
    const nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      toggle.innerHTML = open ? CV.icons.close : CV.icons.menu;
    };
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    // Click outside the menu closes it. composedPath() is used because the
    // toggle's icon is swapped on click, so e.target may no longer be in the page.
    document.addEventListener("click", (e) => {
      const path = e.composedPath();
      if (nav.classList.contains("open") && !path.includes(nav) && !path.includes(toggle)) setOpen(false);
    });
    if (window.matchMedia) {
      const desktop = window.matchMedia("(min-width: 1100px)");
      const onChange = () => desktop.matches && setOpen(false);
      if (desktop.addEventListener) desktop.addEventListener("change", onChange);
    }
  }

  // ---- After the page has loaded ------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.footer !== "none") document.body.insertAdjacentHTML("beforeend", footerHtml);

    // Message saved by the previous page
    try {
      const flash = JSON.parse(sessionStorage.getItem("cv-flash") || "null");
      if (flash && flash.message) {
        sessionStorage.removeItem("cv-flash");
        CV.toast(flash.message, flash.type || "success");
      }
    } catch {
      /* ignore */
    }

    // An email link (sign-up confirmation, password reset) that failed
    const linkError = hashParams.get("error_description");
    if (linkError && CV.page !== "reset-password.html") {
      CV.toast(`That link didn't work: ${linkError}`, "error", 10000);
    }
  });

  // ---- Installable app (only on the real https site, never on localhost) ---
  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker not registered:", err));
    });
  }
})();
