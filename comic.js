/* ==========================================================================
   ComicVault - Series page (comic.html?comic=<slug>)
   Cover, synopsis, author, chapters, "continue reading", owner tools and
   "More like this".
   ========================================================================== */

const SERIES_CARD_FIELDS =
  "id, slug, title, synopsis, genre, reading_mode, cover_url, created_at, profiles(username), chapters(chapter_number, created_at)";

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const esc = CV.escapeHtml;
  const root = document.getElementById("series-root");
  const moreEl = document.getElementById("more-like-this");
  const slug = new URLSearchParams(window.location.search).get("comic");

  function showError(title, message) {
    root.innerHTML = `
      <div class="reader-error">
        <h1>${esc(title)}</h1>
        <p>${esc(message)}</p>
        <a href="browse.html" class="btn">Browse comics</a>
      </div>`;
  }

  if (!slug) return showError("No comic selected", "Pick a comic from the browse page.");

  const [{ data: comic, error }, { data: sessionData }] = await Promise.all([
    db
      .from("comics")
      .select("id, slug, title, synopsis, genre, reading_mode, cover_url, author_id, created_at, profiles(username), chapters(id, chapter_number, title, created_at)")
      .eq("slug", slug)
      .maybeSingle(),
    db.auth.getSession(),
  ]);

  if (error) {
    console.error("Series page error:", error);
    return showError("Couldn't load this comic", "Please try again in a moment.");
  }
  if (!comic) return showError("Comic not found", "It may have been removed, or the link is wrong.");

  document.title = `${comic.title} - ComicVault`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && comic.synopsis) metaDesc.setAttribute("content", comic.synopsis.slice(0, 160));

  const session = sessionData && sessionData.session;
  const isOwner = !!session && session.user.id === comic.author_id;
  const chapters = (comic.chapters || []).slice().sort((a, b) => a.chapter_number - b.chapter_number);
  const mode = CV.mode(comic.reading_mode);
  const author = comic.profiles && comic.profiles.username;
  const saved = CV.progress.get(comic.slug);
  const latestDate = CV.latestDate(chapters);
  const first = chapters[0];
  const latest = chapters[chapters.length - 1];

  // Main reading buttons
  const actions = [];
  if (saved && !saved.done && chapters.some((c) => c.chapter_number === saved.chapter)) {
    const label = saved.upNext ? `Read chapter ${saved.chapter}` : `Continue ch. ${saved.chapter}${saved.page > 1 ? `, page ${saved.page}` : ""}`;
    actions.push(`<a href="${CV.url.reader(comic.slug, saved.chapter, saved.upNext ? 1 : saved.page)}" class="btn btn-large">${esc(label)}</a>`);
    if (first) actions.push(`<a href="${CV.url.reader(comic.slug, first.chapter_number)}" class="btn btn-secondary btn-large">Start from chapter ${first.chapter_number}</a>`);
  } else if (first) {
    actions.push(`<a href="${CV.url.reader(comic.slug, first.chapter_number)}" class="btn btn-large">Start reading</a>`);
    if (latest !== first) actions.push(`<a href="${CV.url.reader(comic.slug, latest.chapter_number)}" class="btn btn-secondary btn-large">Latest: ch. ${latest.chapter_number}</a>`);
  }
  if (isOwner) {
    actions.push(`<a href="edit-comic.html?comic=${encodeURIComponent(comic.slug)}" class="btn btn-outline btn-large">${CV.icons.edit} Edit series</a>`);
    actions.push(`<a href="upload.html?comic=${encodeURIComponent(comic.slug)}" class="btn btn-outline btn-large">+ Add chapter</a>`);
  }

  const meta = [
    author ? `<span>By <a href="${CV.url.profile(comic.author_id)}">${esc(author)}</a></span>` : "",
    comic.genre ? `<a class="tag" href="${CV.url.browse({ genre: comic.genre })}">${esc(CV.genreLabel(comic.genre))}</a>` : "",
    `<span>${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"}</span>`,
    latestDate ? `<span>Updated ${CV.timeAgo(latestDate)}</span>` : "",
  ]
    .filter(Boolean)
    .join('<span class="dot" aria-hidden="true">&bull;</span>');

  const chapterRows = chapters
    .map((ch) => {
      const reading = saved && !saved.done && !saved.upNext && saved.chapter === ch.chapter_number;
      const upNext = saved && saved.upNext && saved.chapter === ch.chapter_number;
      return `
        <li class="chapter-item">
          <a href="${CV.url.reader(comic.slug, ch.chapter_number, reading ? saved.page : undefined)}" class="chapter-row">
            <span class="chapter-row-num">Ch. ${ch.chapter_number}</span>
            <span class="chapter-row-title">${esc(ch.title || `Chapter ${ch.chapter_number}`)}</span>
            ${reading ? '<span class="chapter-pill is-reading">Reading</span>' : upNext ? '<span class="chapter-pill is-reading">Up next</span>' : ""}
            ${CV.isRecent(ch.created_at) ? '<span class="chapter-pill">New</span>' : ""}
            <span class="chapter-row-date">${CV.formatDate(ch.created_at)}</span>
          </a>
          ${
            isOwner
              ? `<a class="chapter-edit" href="edit-chapter.html?comic=${encodeURIComponent(comic.slug)}&chapter=${ch.chapter_number}" aria-label="Edit chapter ${ch.chapter_number}">${CV.icons.edit}<span>Edit</span></a>`
              : ""
          }
        </li>`;
    })
    .join("");

  root.innerHTML = `
    <section class="series-hero">
      ${CV.coverImg(comic.cover_url, comic.title, "series-cover", false).replace('alt=""', `alt="${esc(comic.title)} cover"`)}
      <div class="series-info">
        <div><span class="badge ${mode.cls}">${mode.long}</span></div>
        <h1>${esc(comic.title)}</h1>
        <div class="series-meta">${meta}</div>
        <p class="series-synopsis">${esc(comic.synopsis || "No synopsis yet.")}</p>
        ${actions.length ? `<div class="series-actions">${actions.join("")}</div>` : ""}
      </div>
    </section>

    <section class="section" aria-labelledby="chapters-heading">
      <div class="section-heading-row">
        <h2 class="section-heading" id="chapters-heading">Chapters</h2>
      </div>
      ${chapters.length ? `<ol class="chapter-list">${chapterRows}</ol>` : '<p class="grid-message">No chapters published yet.</p>'}
    </section>`;

  // ---- More like this (same genre) ----------------------------------------
  if (!comic.genre) return;
  const { data: similar, error: similarError } = await db
    .from("comics")
    .select(SERIES_CARD_FIELDS)
    .eq("genre", comic.genre)
    .neq("id", comic.id)
    .order("created_at", { ascending: false })
    .limit(12);
  if (similarError) return console.error("More like this error:", similarError);
  if (!similar || !similar.length) return;

  moreEl.innerHTML = `
    <section class="section" aria-labelledby="similar-heading">
      <div class="section-heading-row">
        <h2 class="section-heading" id="similar-heading">More like this</h2>
        <a href="${CV.url.browse({ genre: comic.genre })}" class="see-all">More ${esc(CV.genreLabel(comic.genre))} &rarr;</a>
      </div>
      ${CV.rowHtml(similar.map((c) => CV.comicCard(c)).join(""), "More like this")}
    </section>`;
  CV.initRows(moreEl);
});
