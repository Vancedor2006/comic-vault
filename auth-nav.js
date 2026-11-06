/* ==========================================================================
   ComicVault - Shared header: session-aware nav, active link, mobile menu
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  const navContainer = document.getElementById("nav-user-container");

  // ---- Highlight the link for the current page ----------------------------
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a[href]").forEach((a) => {
    if (a.getAttribute("href") === currentPage) {
      a.classList.add("active");
      a.setAttribute("aria-current", "page");
    }
  });

  // ---- Mobile menu toggle -------------------------------------------------
  const toggle = document.querySelector(".nav-toggle");
  const siteNav = document.getElementById("site-nav");
  if (toggle && siteNav) {
    toggle.addEventListener("click", () => {
      const open = siteNav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.innerHTML = open ? "&times;" : "&#9776;";
    });
  }

  if (!navContainer || !db) return;

  // Send people back to the page they were on after logging in
  const here = currentPage + window.location.search;
  const onAuthPage = currentPage === "login.html" || currentPage === "signup.html";
  const next = onAuthPage ? "" : `next=${encodeURIComponent(here)}`;

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderLoggedOut() {
    navContainer.innerHTML = `
      <a href="login.html${next ? `?${next}` : ""}" class="btn btn-ghost btn-sm">Log In</a>
      <a href="signup.html${next ? `?${next}` : ""}" class="btn btn-primary btn-sm">Sign Up</a>`;
  }

  let renderedUserId = null;
  async function renderLoggedIn(user) {
    if (renderedUserId === user.id) return; // avoid double render on page load
    renderedUserId = user.id;

    const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
    const username = profile?.username || user.user_metadata?.username || "Creator";

    navContainer.innerHTML = `
      <span class="nav-username">Hi, <strong>${escapeHtml(username)}</strong></span>
      <button type="button" id="logout-btn" class="btn btn-outline btn-sm">Log Out</button>`;

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await db.auth.signOut();
      window.location.href = "index.html";
    });
  }

  db.auth.getSession().then(({ data: { session } }) => {
    if (session) renderLoggedIn(session.user);
    else renderLoggedOut();
  });

  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) renderLoggedIn(session.user);
    else if (event === "SIGNED_OUT") {
      renderedUserId = null;
      renderLoggedOut();
    }
  });
});
