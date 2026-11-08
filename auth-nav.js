/* ==========================================================================
   Comic-Vault - Header features that need Supabase
   - Account area (Log In / Sign Up, or avatar + My Comics + Log Out)
   - Live search suggestions in the header search box
   - Password-reset links that land on the wrong page
   Loaded on every page after supabase.js (header HTML comes from common.js).
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  if (!db || !window.CV) return;
  const esc = CV.escapeHtml;

  // ---- Account area -------------------------------------------------------
  const userBox = document.getElementById("nav-user-container");
  const dashboardLink = document.querySelector(".nav-dashboard");
  const onAuthPage = CV.page === "login.html" || CV.page === "signup.html";
  const nextQs = onAuthPage ? "" : `?next=${encodeURIComponent(CV.here)}`;

  function renderLoggedOut() {
    if (!userBox) return;
    if (dashboardLink) dashboardLink.hidden = true;
    userBox.innerHTML = `
      <a href="login.html${nextQs}" class="btn btn-ghost btn-sm">Log In</a>
      <a href="signup.html${nextQs}" class="btn btn-sm">Sign Up</a>`;
  }

  let renderedUserId = null;
  async function renderLoggedIn(user) {
    if (!userBox || renderedUserId === user.id) return;
    renderedUserId = user.id;
    if (dashboardLink) dashboardLink.hidden = false;

    const fallbackName = (user.user_metadata && user.user_metadata.username) || "Creator";
    paint(fallbackName, null);

    const { data: profile } = await db.from("profiles").select("username, avatar_url").eq("id", user.id).maybeSingle();
    if (renderedUserId !== user.id) return; // logged out meanwhile
    paint((profile && profile.username) || fallbackName, profile && profile.avatar_url);

    function paint(name, avatarUrl) {
      const initial = esc((name || "?").trim().charAt(0).toUpperCase() || "?");
      userBox.innerHTML = `
        <a class="nav-avatar" href="${CV.url.profile(user.id)}" title="Your profile" aria-label="Your profile (${esc(name)})">
          ${avatarUrl ? `<img src="${esc(avatarUrl)}" alt="">` : initial}
        </a>
        <span class="nav-username">${esc(name)}</span>
        <button type="button" class="btn btn-outline btn-sm" data-logout>Log Out</button>`;
      userBox.querySelector("[data-logout]").addEventListener("click", async () => {
        await db.auth.signOut();
        window.location.href = "index.html";
      });
    }
  }

  db.auth.getSession().then(({ data: { session } }) => {
    if (session) renderLoggedIn(session.user);
    else renderLoggedOut();
  });

  db.auth.onAuthStateChange((event, session) => {
    // Supabase recommends not calling other Supabase methods directly inside
    // this callback, so the work is deferred with setTimeout.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY" && CV.page !== "reset-password.html") {
        try {
          sessionStorage.setItem("cv-recovery", "1");
        } catch {
          /* ignore */
        }
        window.location.href = "reset-password.html";
        return;
      }
      if (event === "SIGNED_IN" && session) renderLoggedIn(session.user);
      else if (event === "SIGNED_OUT") {
        renderedUserId = null;
        renderLoggedOut();
      }
    }, 0);
  });

  // ---- Search suggestions -------------------------------------------------
  document.querySelectorAll(".header-search").forEach(initSearch);

  function initSearch(form) {
    const input = form.querySelector('input[type="search"]');
    const list = form.querySelector(".search-suggestions");
    if (!input || !list) return;

    let active = -1;
    let requestId = 0;
    const options = () => Array.from(list.querySelectorAll('[role="option"]'));

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function open() {
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function setActive(index) {
      const opts = options();
      active = index;
      opts.forEach((li, i) => {
        li.classList.toggle("is-active", i === index);
        li.setAttribute("aria-selected", String(i === index));
      });
      const current = opts[index];
      if (current) {
        input.setAttribute("aria-activedescendant", current.id);
        current.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    async function fetchSuggestions(query) {
      const id = ++requestId;
      const { data, error } = await db
        .from("comics")
        .select("slug, title, cover_url, genre, profiles(username)")
        .ilike("title", CV.likePattern(query))
        .order("title", { ascending: true })
        .limit(6);
      if (id !== requestId || input.value.trim() !== query) return; // outdated
      if (error) console.error("Search suggestions error:", error);
      render(query, error ? [] : data || []);
    }

    function render(query, comics) {
      const base = input.id;
      list.innerHTML =
        comics
          .map((c, i) => {
            const meta = [c.profiles && c.profiles.username, CV.genreLabel(c.genre)].filter(Boolean).join(" · ");
            return `
              <li role="option" id="${base}-opt-${i}" class="suggestion" aria-selected="false" data-href="${esc(CV.url.series(c.slug))}">
                ${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="" loading="lazy">` : '<span class="sugg-fallback"></span>'}
                <span class="sugg-text"><span class="sugg-title">${esc(c.title)}</span>${meta ? `<span class="sugg-meta">${esc(meta)}</span>` : ""}</span>
              </li>`;
          })
          .join("") +
        (comics.length ? "" : `<li class="suggestion-empty" role="presentation">No titles match “${esc(query)}”</li>`) +
        `<li role="option" id="${base}-opt-all" class="suggestion suggestion-all" aria-selected="false" data-href="${esc(CV.url.browse({ q: query }))}">See all results for “${esc(query)}”</li>`;
      active = -1;
      open();
    }

    const debouncedFetch = CV.debounce(fetchSuggestions, 200);

    input.addEventListener("input", () => {
      const query = input.value.trim();
      if (query.length < 2) {
        requestId++; // cancel anything in flight
        close();
        return;
      }
      debouncedFetch(query);
    });

    input.addEventListener("keydown", (e) => {
      const opts = options();
      if (list.hidden || !opts.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((active + 1) % opts.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active <= 0 ? opts.length - 1 : active - 1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        window.location.href = opts[active].dataset.href;
      } else if (e.key === "Escape") {
        e.stopPropagation(); // don't also close the mobile menu
        close();
      }
    });

    // Keep focus in the box while clicking a suggestion
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const option = e.target.closest('[role="option"]');
      if (option) window.location.href = option.dataset.href;
    });

    input.addEventListener("focus", () => {
      if (input.value.trim().length >= 2 && options().length) open();
    });
    input.addEventListener("blur", () => setTimeout(close, 150));

    // An empty search just opens the browse page
    form.addEventListener("submit", (e) => {
      if (!input.value.trim()) {
        e.preventDefault();
        window.location.href = "browse.html";
      }
    });
  }
});
