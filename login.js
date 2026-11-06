/* ==========================================================================
   ComicVault - Account pages (used by login.html AND signup.html)
   ?next=upload.html  -> where to go after logging in / signing up
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  const params = new URLSearchParams(window.location.search);

  // Only allow redirects to our own pages (e.g. "upload.html?comic=x")
  const rawNext = params.get("next") || "";
  const isSafeNext = /^[a-z0-9-]+\.html(\?.*)?$/i.test(rawNext) && !/^(login|signup)\.html/i.test(rawNext);
  const nextPage = isSafeNext ? rawNext : "index.html";

  // Old links used login.html?tab=signup; send those to the Sign Up page
  if (params.get("tab") === "signup" && document.getElementById("login-form")) {
    window.location.replace(`signup.html${isSafeNext ? `?next=${encodeURIComponent(rawNext)}` : ""}`);
    return;
  }

  // Keep ?next= when hopping between the Log In and Sign Up pages
  if (isSafeNext) {
    document.querySelectorAll("a[data-auth-link]").forEach((a) => {
      a.href = `${a.getAttribute("href")}?next=${encodeURIComponent(rawNext)}`;
    });
  }

  function showMessage(target, message, type) {
    target.textContent = message;
    target.className = `auth-message upload-status-${type}`;
  }

  // ---- Already logged in? Offer to continue or switch account --------------
  db.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    const notice = document.createElement("div");
    notice.className = "auth-message upload-status-info";
    notice.style.margin = "0 0 1.5rem";
    notice.innerHTML = `
      You're already logged in as <strong></strong>.
      <div style="display:flex; gap:0.5rem; margin-top:0.75rem; flex-wrap:wrap;">
        <a href="${nextPage}" class="btn btn-sm">Continue</a>
        <button type="button" class="btn btn-outline btn-sm" id="switch-account-btn">Log out to switch account</button>
      </div>`;
    notice.querySelector("strong").textContent = session.user.email;
    document.querySelector(".auth-tabs").before(notice);

    document.getElementById("switch-account-btn").addEventListener("click", async () => {
      await db.auth.signOut();
      notice.remove();
    });
  });

  // ---- Log in (login.html) ------------------------------------------------
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    const loginBtn = document.getElementById("login-btn");
    const loginMessage = document.getElementById("login-message");

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      loginBtn.disabled = true;
      showMessage(loginMessage, "Logging in...", "info");

      const { error } = await db.auth.signInWithPassword({
        email: document.getElementById("login-email").value.trim(),
        password: document.getElementById("login-password").value,
      });

      if (error) {
        showMessage(loginMessage, error.message, "error");
        loginBtn.disabled = false;
        return;
      }
      showMessage(loginMessage, "Logged in! Redirecting...", "success");
      window.location.href = nextPage;
    });
  }

  // ---- Sign up (signup.html) ----------------------------------------------
  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    const signupBtn = document.getElementById("signup-btn");
    const signupMessage = document.getElementById("signup-message");

    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("signup-username").value.trim();

      if (username.length < 3) {
        return showMessage(signupMessage, "Username must be at least 3 characters.", "error");
      }

      signupBtn.disabled = true;
      showMessage(signupMessage, "Creating account...", "info");

      const { data, error } = await db.auth.signUp({
        email: document.getElementById("signup-email").value.trim(),
        password: document.getElementById("signup-password").value,
        options: { data: { username } }, // read by the trigger that fills public.profiles
      });

      signupBtn.disabled = false;

      if (error) return showMessage(signupMessage, error.message, "error");

      if (data.session) {
        // Email confirmation is off: they're logged in already
        showMessage(signupMessage, "Account created! Redirecting...", "success");
        window.location.href = nextPage;
      } else {
        showMessage(signupMessage, "Account created! Check your email to confirm it, then log in.", "success");
        signupForm.reset();
      }
    });
  }
});
