/* ==========================================================================
   ComicVault - Series Page (comic.html?comic=<slug>)
   Cover, synopsis, author, format, and the full chapter list.
   ========================================================================== */

const MODE_INFO = {
  infinite: { text: "Vertical Scroll", cls: "badge-infinite" },
  rtl: { text: "Manga (Right to Left)", cls: "badge-rtl" },
  ltr: { text: "Western (Left to Right)", cls: "badge-ltr" },
};

const GENRE_LABELS = {
  action: "Action",
  fantasy: "Fantasy",
  romance: "Romance",
  scifi: "Sci-Fi",
  "slice-of-life": "Slice of Life",
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  const root = document.getElementById("series-root");
  const slug = new URLSearchParams(window.location.search).get("comic");

  function showError(title, message) {
    root.innerHTML = `
      <div class="reader-error">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <a href="browse.html" class="btn">Browse comics</a>
      </div>`;
  }

  if (!slug) return showError("No comic selected", "Pick a comic from the browse page.");

  const { data: comic, error } = await db
    .from("comics")
    .select("id, slug, title, synopsis, genre, reading_mode, cover_url, author_id, created_at, profiles(username), chapters(chapter_number, title, created_at)")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Series page error:", error);
    return showError("Couldn't load this comic", "Please try again in a moment.");
  }
  if (!comic) return showError("Comic not found", "It may have been removed or the link is wrong.");

  document.title = `${comic.title} - ComicVault`;

  const chapters = (comic.chapters || []).sort((a, b) => a.chapter_number - b.chapter_number);
  const mode = MODE_INFO[comic.reading_mode] || MODE_INFO.ltr;
  const author = comic.profiles?.username;
  const readUrl = (n) => `reader.html?comic=${encodeURIComponent(comic.slug)}&chapter=${n}`;

  const first = chapters[0];
  const latest = chapters[chapters.length - 1];

  root.innerHTML = `
    <section class="series-hero">
      ${comic.cover_url
        ? `<img src="${escapeHtml(comic.cover_url)}" alt="${escapeHtml(comic.title)} cover" class="series-cover">`
        : `<div class="series-cover cover-fallback">${escapeHtml(comic.title)}</div>`}
      <div class="series-info">
        <div><span class="badge ${mode.cls}">${mode.text}</span></div>
        <h1>${escapeHtml(comic.title)}</h1>
        <div class="series-meta">
          ${author ? `<span>By <strong>${escapeHtml(author)}</strong></span><span class="dot">&bull;</span>` : ""}
          ${comic.genre ? `<a class="tag" href="browse.html?genre=${encodeURIComponent(comic.genre)}">${escapeHtml(GENRE_LABELS[comic.genre] || comic.genre)}</a><span class="dot">&bull;</span>` : ""}
          <span>${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}</span>
        </div>
        <p class="series-synopsis">${escapeHtml(comic.synopsis || "No synopsis yet.")}</p>
        <div class="series-actions">
          ${first ? `<a href="${readUrl(first.chapter_number)}" class="btn btn-large">Start Reading</a>` : ""}
          ${latest && latest !== first ? `<a href="${readUrl(latest.chapter_number)}" class="btn btn-secondary btn-large">Latest: Ch. ${latest.chapter_number}</a>` : ""}
          <a href="upload.html?comic=${encodeURIComponent(comic.slug)}" class="btn btn-outline btn-large hidden" id="add-chapter-btn">+ Add Chapter</a>
        </div>
      </div>
    </section>

    <section>
      <div class="section-heading-row"><h2 class="section-heading">Chapters</h2></div>
      ${chapters.length
        ? `<ol class="chapter-list">
            ${chapters.map((ch) => `
              <li>
                <a href="${readUrl(ch.chapter_number)}" class="chapter-row">
                  <span class="chapter-row-num">Ch. ${ch.chapter_number}</span>
                  <span class="chapter-row-title">${escapeHtml(ch.title || `Chapter ${ch.chapter_number}`)}</span>
                  <span class="chapter-row-date">${formatDate(ch.created_at)}</span>
                </a>
              </li>`).join("")}
          </ol>`
        : `<p class="grid-message">No chapters published yet.</p>`}
    </section>`;

  // Show "Add Chapter" only to the comic's author
  const { data: { session } } = await db.auth.getSession();
  if (session && session.user.id === comic.author_id) {
    document.getElementById("add-chapter-btn").classList.remove("hidden");
  }
});
