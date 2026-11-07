/* ==========================================================================
   ComicVault - My Comics (dashboard.html)
   Lists the logged-in user's series with quick links to view, edit,
   add chapters and edit individual chapters.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const C = window.CVCreator;
  const esc = CV.escapeHtml;
  const root = document.getElementById("dashboard-root");

  const user = await C.requireUser(db, root, "Log in to see and manage the comics you've published.");
  if (!user) return;

  const { data: comics, error } = await db
    .from("comics")
    .select("id, slug, title, genre, reading_mode, cover_url, created_at, chapters(id, chapter_number, title, created_at)")
    .eq("author_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Dashboard error:", error);
    root.innerHTML = '<p class="grid-message">Couldn\'t load your comics. Please try again later.</p>';
    return;
  }

  if (!comics.length) {
    root.innerHTML = `
      <div class="grid-message">
        <h2>You haven't published anything yet</h2>
        <p>Start your first series. You can add more chapters any time.</p>
        <a href="upload.html" class="btn">Publish your first series</a>
      </div>`;
    return;
  }

  root.innerHTML = `<ul class="dash-list">${comics.map(renderComic).join("")}</ul>`;

  function renderComic(comic) {
    const chapters = (comic.chapters || []).slice().sort((a, b) => a.chapter_number - b.chapter_number);
    const mode = CV.mode(comic.reading_mode);
    const latest = CV.latestDate(chapters);
    const slugParam = encodeURIComponent(comic.slug);
    const series = CV.url.series(comic.slug);

    return `
      <li class="dash-item">
        <a href="${series}" tabindex="-1" aria-hidden="true">
          ${comic.cover_url ? `<img src="${esc(comic.cover_url)}" alt="" class="dash-cover" loading="lazy">` : `<span class="dash-cover-fallback">No cover</span>`}
        </a>
        <div class="dash-main">
          <h2 class="dash-title"><a href="${series}">${esc(comic.title)}</a></h2>
          <div class="dash-meta">
            <span class="badge ${mode.cls}">${mode.short}</span>
            ${comic.genre ? `<span>${esc(CV.genreLabel(comic.genre))}</span>` : ""}
            <span>${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}</span>
            <span>${latest ? `Updated ${CV.timeAgo(latest)}` : `Created ${CV.timeAgo(comic.created_at)}`}</span>
          </div>
          <div class="dash-actions">
            <a class="btn btn-sm" href="upload.html?comic=${slugParam}">+ Add chapter</a>
            <a class="btn btn-sm btn-secondary" href="edit-comic.html?comic=${slugParam}">${CV.icons.edit} Edit details</a>
            <a class="btn btn-sm btn-ghost" href="${series}">View</a>
          </div>
        </div>
        ${
          chapters.length
            ? `<details class="dash-chapters">
                <summary>Chapters (${chapters.length})</summary>
                <ol class="dash-chapter-list">
                  ${chapters
                    .map(
                      (ch) => `
                    <li class="dash-chapter">
                      <span class="dash-ch-num">Ch. ${ch.chapter_number}</span>
                      <span class="dash-chapter-title">${esc(ch.title || `Chapter ${ch.chapter_number}`)}</span>
                      <span class="dash-chapter-date">${CV.formatDate(ch.created_at)}</span>
                      <a class="btn btn-sm btn-ghost" href="${CV.url.reader(comic.slug, ch.chapter_number)}">Read</a>
                      <a class="btn btn-sm btn-secondary" href="edit-chapter.html?comic=${slugParam}&chapter=${ch.chapter_number}" aria-label="Edit chapter ${ch.chapter_number}">Edit</a>
                    </li>`
                    )
                    .join("")}
                </ol>
              </details>`
            : ""
        }
      </li>`;
  }
});
