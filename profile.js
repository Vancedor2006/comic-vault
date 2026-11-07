/* ==========================================================================
   ComicVault - Creator profile (profile.html?id=<user id>)
   Shows the creator's name, avatar, join date and all of their series.
   ========================================================================== */

const PROFILE_COMIC_FIELDS =
  "id, slug, title, synopsis, genre, reading_mode, cover_url, created_at, profiles(username), chapters(chapter_number, created_at)";

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const esc = CV.escapeHtml;
  const root = document.getElementById("profile-root");
  const id = new URLSearchParams(window.location.search).get("id");

  function showError(title, message) {
    root.innerHTML = `
      <div class="reader-error">
        <h1>${esc(title)}</h1>
        <p>${esc(message)}</p>
        <a href="browse.html" class="btn">Browse comics</a>
      </div>`;
  }

  if (!id) return showError("No creator selected", "Open a creator from one of their comics.");

  const [{ data: profile, error }, { data: comics, error: comicsError }, { data: sessionData }] = await Promise.all([
    db.from("profiles").select("id, username, avatar_url, created_at").eq("id", id).maybeSingle(),
    db.from("comics").select(PROFILE_COMIC_FIELDS).eq("author_id", id).order("created_at", { ascending: false }),
    db.auth.getSession(),
  ]);

  if (error || comicsError) {
    console.error("Profile error:", error || comicsError);
    return showError("Couldn't load this creator", "Please try again in a moment.");
  }
  if (!profile) return showError("Creator not found", "This account may have been removed.");

  const name = profile.username || "Unnamed creator";
  const isMe = !!(sessionData && sessionData.session && sessionData.session.user.id === profile.id);
  const list = comics || [];
  document.title = `${name} - ComicVault`;

  root.innerHTML = `
    <section class="profile-header">
      <div class="profile-avatar" aria-hidden="true">
        ${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="">` : esc(name.charAt(0).toUpperCase())}
      </div>
      <div class="profile-info">
        <h1>${esc(name)}</h1>
        <p>${list.length} series${profile.created_at ? ` · Joined ${new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` : ""}</p>
        ${isMe ? '<div><a href="dashboard.html" class="btn btn-secondary btn-sm">Manage my comics</a></div>' : ""}
      </div>
    </section>

    <section class="section" aria-labelledby="profile-comics-heading" style="margin-top: 1rem;">
      <div class="section-heading-row">
        <h2 class="section-heading" id="profile-comics-heading">${isMe ? "Your series" : `Series by ${esc(name)}`}</h2>
      </div>
      ${
        list.length
          ? `<div class="comic-grid">${list.map((c) => CV.comicCard(c)).join("")}</div>`
          : `<p class="grid-message">${isMe ? 'You haven\'t published anything yet. <a href="upload.html">Publish your first series</a>.' : "No series published yet."}</p>`
      }
    </section>`;
});
