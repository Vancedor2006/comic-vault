/* ==========================================================================
   Comic-Vault - Edit series (edit-comic.html?comic=<slug>)
   Change title, synopsis, genre, reading direction and cover, or delete
   the whole series (rows + stored images). Only the author can do this.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const C = window.CVCreator;
  const esc = CV.escapeHtml;
  const $ = (id) => document.getElementById(id);

  const root = $("edit-root");
  const form = $("edit-form");
  const subtitle = $("edit-subtitle");
  const titleInput = $("series-title");
  const synopsisInput = $("series-synopsis");
  const genreSelect = $("series-genre");
  const modeSelect = $("reading-mode");
  const currentCoverEl = $("current-cover");
  const coverInput = $("cover-file");
  const newCoverEl = $("new-cover");
  const saveBtn = $("save-btn");
  const deleteConfirm = $("delete-confirm");
  const deleteBtn = $("delete-btn");
  const ui = new C.StatusUI({ status: $("edit-status"), progressWrap: $("edit-progress"), progressBar: $("edit-progress-bar") });
  C.initDropzones(form);

  const slug = new URLSearchParams(window.location.search).get("comic");
  const user = await C.requireUser(db, root, "Log in to edit your comics.");
  if (!user) {
    subtitle.textContent = "";
    return;
  }

  const notAllowed = (title, message) => {
    subtitle.textContent = "";
    root.innerHTML = `<div class="grid-message"><h2>${esc(title)}</h2><p>${esc(message)}</p><a class="btn" href="dashboard.html">Go to My Comics</a></div>`;
  };

  if (!slug) return notAllowed("No series selected", "Choose a series to edit from My Comics.");

  const { data: comic, error } = await db
    .from("comics")
    .select("id, slug, title, synopsis, genre, reading_mode, cover_url, author_id, chapters(id)")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Edit series error:", error);
    return notAllowed("Couldn't load this series", "Please try again in a moment.");
  }
  if (!comic) return notAllowed("Series not found", "It may have been deleted.");
  if (comic.author_id !== user.id) return notAllowed("Not your series", "You can only edit comics you published.");

  // ---- Fill the form ------------------------------------------------------
  let coverFile = null;
  let busy = false;

  document.title = `Edit ${comic.title} - Comic-Vault`;
  subtitle.innerHTML = `Editing <a href="${CV.url.series(comic.slug)}">${esc(comic.title)}</a>`;
  titleInput.value = comic.title;
  synopsisInput.value = comic.synopsis || "";
  if (CV.GENRES[comic.genre]) genreSelect.value = comic.genre;
  else {
    genreSelect.insertAdjacentHTML("afterbegin", '<option value="" disabled selected>Select genre</option>');
  }
  modeSelect.value = CV.MODES[comic.reading_mode] ? comic.reading_mode : "ltr";
  $("delete-title").textContent = comic.title;
  const chapterCount = (comic.chapters || []).length;
  $("delete-summary").textContent = `This permanently deletes "${comic.title}", its ${chapterCount} ${
    chapterCount === 1 ? "chapter" : "chapters"
  } and every uploaded page. It can't be undone.`;
  renderCurrentCover();
  form.hidden = false;

  function renderCurrentCover() {
    currentCoverEl.innerHTML = comic.cover_url
      ? `<figure class="cover-thumb"><img src="${esc(comic.cover_url)}" alt="Current cover"><figcaption>Current cover</figcaption></figure>`
      : '<p class="form-hint">No cover yet.</p>';
  }

  function renderNewCover() {
    newCoverEl.innerHTML = "";
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    newCoverEl.innerHTML = `
      <figure class="cover-thumb">
        <img src="${url}" alt="New cover preview">
        <button type="button" class="thumb-remove" aria-label="Keep the current cover instead">&times;</button>
        <figcaption>New cover (saved when you click Save changes)</figcaption>
      </figure>`;
    newCoverEl.querySelector("img").onload = () => URL.revokeObjectURL(url);
    newCoverEl.querySelector(".thumb-remove").addEventListener("click", () => {
      coverFile = null;
      renderNewCover();
      coverInput.focus();
    });
  }

  coverInput.addEventListener("change", () => {
    const file = coverInput.files[0];
    coverInput.value = "";
    if (!file) return;
    const err = C.validateImage(file);
    if (err) return ui.show(err, "error");
    ui.clear();
    coverFile = file;
    renderNewCover();
  });

  modeSelect.addEventListener("change", () => {
    if (modeSelect.value !== comic.reading_mode && chapterCount) {
      ui.show("Heads up: changing the reading direction changes how all existing chapters are read.", "info");
    }
  });

  function lock(locked) {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => (el.disabled = locked));
    if (!locked) deleteBtn.disabled = deleteConfirm.value.trim() !== comic.title.trim();
  }

  // ---- Save ---------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const title = titleInput.value.trim();
    if (!title) {
      ui.show("Please enter a title.", "error");
      return titleInput.focus();
    }
    if (!genreSelect.value) {
      ui.show("Please choose a genre.", "error");
      return genreSelect.focus();
    }

    busy = true;
    lock(true);
    saveBtn.textContent = "Saving…";
    let newCoverJob = null;

    try {
      let coverUrl = comic.cover_url;
      if (coverFile) {
        const jobs = C.imageJobs(db, [coverFile], C.COVER_MAX_WIDTH, (_i, ext) => `${user.id}/${comic.slug}/cover-${Date.now()}.${ext}`);
        newCoverJob = jobs[0];
        const ok = await C.uploadWithRetry(jobs, ui);
        if (!ok) {
          await C.removePaths(db, [newCoverJob.path]);
          return done("Cancelled. Nothing was changed.", "info");
        }
        coverUrl = newCoverJob.result;
      }

      ui.show("Saving…");
      const { error: updateError } = await db
        .from("comics")
        .update({
          title,
          synopsis: synopsisInput.value.trim() || null,
          genre: genreSelect.value,
          reading_mode: modeSelect.value,
          cover_url: coverUrl,
        })
        .eq("id", comic.id)
        .select("id")
        .single();
      if (updateError) {
        throw new Error(
          updateError.code === "PGRST116" ? "You don't have permission to edit this series." : `Couldn't save: ${updateError.message}`
        );
      }

      // Saved: remove the old cover file if it was replaced
      if (coverFile && comic.cover_url && comic.cover_url !== coverUrl) await C.removeFilesByUrl(db, [comic.cover_url]);

      Object.assign(comic, { title, synopsis: synopsisInput.value.trim() || null, genre: genreSelect.value, reading_mode: modeSelect.value, cover_url: coverUrl });
      coverFile = null;
      renderNewCover();
      renderCurrentCover();
      $("delete-title").textContent = comic.title;
      subtitle.innerHTML = `Editing <a href="${CV.url.series(comic.slug)}">${esc(comic.title)}</a>`;
      done(`Saved! <a href="${CV.url.series(comic.slug)}">View the series</a>`, "success", true);
    } catch (err) {
      console.error("Save series error:", err);
      if (newCoverJob && newCoverJob.path) await C.removePaths(db, [newCoverJob.path]);
      done(err.message || "Couldn't save. Please try again.", "error");
    }
  });

  function done(message, type, allowHtml = false) {
    ui.progress(null);
    ui.show(message, type, allowHtml);
    busy = false;
    lock(false);
    saveBtn.textContent = "Save changes";
  }

  // ---- Delete -------------------------------------------------------------
  deleteConfirm.addEventListener("input", () => {
    deleteBtn.disabled = busy || deleteConfirm.value.trim() !== comic.title.trim();
  });

  deleteBtn.addEventListener("click", async () => {
    if (busy || deleteConfirm.value.trim() !== comic.title.trim()) return;
    busy = true;
    lock(true);
    deleteBtn.textContent = "Deleting…";
    ui.show("Deleting the series and its images…");
    try {
      await C.deleteComic(db, comic.id);
      CV.progress.remove(comic.slug);
      CV.flash(`"${comic.title}" was deleted.`);
      window.location.href = "dashboard.html";
    } catch (err) {
      console.error("Delete series error:", err);
      busy = false;
      lock(false);
      deleteBtn.textContent = "Delete this series";
      ui.show(err.message || "Couldn't delete the series.", "error");
    }
  });
});
