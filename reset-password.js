/* ==========================================================================
   ComicVault - Password reset (reset-password.html)
   Step 1: send a reset email.
   Step 2: the email link brings the user back here (logged in for recovery)
           and they choose a new password.
   Note: the email link only works on the live website, and Supabase must
   list it under Authentication -> URL Configuration -> Redirect URLs.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const $ = (id) => document.getElementById(id);

  const requestForm = $("request-form");
  const requestBtn = $("request-btn");
  const requestMsg = $("request-message");
  const updateForm = $("update-form");
  const updateBtn = $("update-btn");
  const updateMsg = $("update-message");

  const show = (target, message, type) => {
    target.textContent = message;
    target.className = `auth-message upload-status-${type}`;
  };

  function showUpdateForm() {
    requestForm.hidden = true;
    updateForm.hidden = false;
    $("new-password").focus();
  }

  // ---- Arriving from the email link? --------------------------------------
  const hash = new URLSearchParams((CV.initialHash || "").replace(/^#/, ""));
  let fromRecovery = hash.get("type") === "recovery";
  try {
    if (sessionStorage.getItem("cv-recovery") === "1") fromRecovery = true;
  } catch {
    /* ignore */
  }

  if (hash.get("error_description")) {
    show(requestMsg, "That reset link has expired or was already used. Enter your email to get a new one.", "error");
  } else if (fromRecovery) {
    showUpdateForm();
    show(updateMsg, "Checking your reset link…", "info");
    const {
      data: { session },
    } = await db.auth.getSession();
    if (session) {
      updateMsg.textContent = "";
      updateMsg.className = "auth-message";
    } else {
      updateForm.hidden = true;
      requestForm.hidden = false;
      show(requestMsg, "That reset link has expired or was already used. Enter your email to get a new one.", "error");
    }
  }

  db.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") setTimeout(showUpdateForm, 0);
  });

  // ---- Step 1: send the email --------------------------------------------
  requestForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (window.location.protocol === "file:") {
      show(requestMsg, "Password reset links only work on the live website, not on a file opened from your computer.", "error");
      return;
    }
    requestBtn.disabled = true;
    show(requestMsg, "Sending…", "info");
    const email = $("reset-email").value.trim();
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("reset-password.html", window.location.href).href,
    });
    requestBtn.disabled = false;
    if (error) return show(requestMsg, error.message, "error");
    // Same message whether or not the account exists (doesn't reveal who's registered)
    show(requestMsg, "If an account uses that email, a reset link is on its way. Check your inbox (and spam folder).", "success");
  });

  // ---- Step 2: save the new password --------------------------------------
  updateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("new-password").value;
    if (password.length < 6) return show(updateMsg, "The password must be at least 6 characters.", "error");
    if (password !== $("confirm-password").value) return show(updateMsg, "The two passwords don't match.", "error");

    updateBtn.disabled = true;
    show(updateMsg, "Saving…", "info");
    const { error } = await db.auth.updateUser({ password });
    if (error) {
      updateBtn.disabled = false;
      return show(updateMsg, error.message, "error");
    }
    try {
      sessionStorage.removeItem("cv-recovery");
    } catch {
      /* ignore */
    }
    show(updateMsg, "Password updated! Taking you to the home page…", "success");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  });
});
