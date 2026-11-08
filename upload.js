/* ==========================================================================
   Comic-Vault - Publish page
   --------------------------------------------------------------------------
   "New series"  -> creates the comic (with cover) and its first chapter
   "New chapter" -> adds a chapter to one of your series
                    (upload.html?comic=<slug> preselects that series)

   On submit: validate -> optimise + upload images (auto-retry, with a
   Retry/Cancel choice if some still fail) -> save rows -> open the reader.
   Anything created by a failed or cancelled attempt is removed again.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  if (!db) return; // no connection: supabase.js shows a message
  const C = window.CVCreator;
  const $ = (id) => document.getElementById(id);

  const form = $("upload-form");
  const modeRadios = form.querySelectorAll('input[name="upload-mode"]');
  const modeExistingRadio = $("mode-existing");
  const seriesSection = $("series-section");
  const existingSection = $("existing-section");
  const existingSelect = $("existing-comic");
  const existingHint = $("existing-hint");
  const chapterLegend = $("chapter-legend");
  const titleInput = $("series-title");
  const synopsisInput = $("series-synopsis");
  const genreSelect = $("series-genre");
  const modeSelect = $("reading-mode");
  const coverInput = $("cover-file");
  const coverPreview = $("cover-preview");
  const chapterNumInput = $("chapter-number");
  const chapterTitleInput = $("chapter-title");
  const pagesInput = $("pages-files");
  const submitBtn = $("submit-btn");

  const ui = new C.StatusUI({ status: $("upload-status"), progressWrap: $("upload-progress"), progressBar: $("upload-progress-bar") });
  const pages = new C.PageList($("pages-preview-list"));
  C.initDropzones(form);

  const preselectSlug = new URLSearchParams(window.location.search).get("comic");
  let currentUser = null;
  let uploadMode = "new";
  let myComics = []; // { id, slug, title, chapterNumbers }
  let coverFile = null;
  let busy = false;

  // ---- Helpers ------------------------------------------------------------
  function setFormLocked(locked) {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = locked;
    });
    pages.locked = locked;
    if (!locked) updateExistingAvailability();
  }

  const selectedComic = () => myComics.find((c) => c.id === existingSelect.value) || null;

  // ---- Mode switching -----------------------------------------------------
  function setMode(mode) {
    uploadMode = mode;
    const isNew = mode === "new";
    seriesSection.hidden = !isNew;
    existingSection.hidden = isNew;
    chapterLegend.textContent = isNew ? "First chapter" : "New chapter";
    submitBtn.textContent = isNew ? "Publish series" : "Publish chapter";
    form.querySelector(`input[name="upload-mode"][value="${mode}"]`).checked = true;
    if (isNew) chapterNumInput.value = 1;
    else suggestNextChapterNumber();
    if (!busy) ui.clear();
  }

  modeRadios.forEach((r) => r.addEventListener("change", () => setMode(r.value)));

  function suggestNextChapterNumber() {
    const comic = selectedComic();
    if (!comic) return;
    const max = comic.chapterNumbers.length ? Math.max(...comic.chapterNumbers) : 0;
    chapterNumInput.value = max + 1;
    existingHint.textContent = comic.chapterNumbers.length
      ? `Published so far: chapter${comic.chapterNumbers.length > 1 ? "s" : ""} ${comic.chapterNumbers.join(", ")}`
      : "No chapters published yet.";
  }
  existingSelect.addEventListener("change", suggestNextChapterNumber);

  function updateExistingAvailability() {
    const none = myComics.length === 0;
    modeExistingRadio.disabled = none;
    modeExistingRadio.closest("label").title = none ? "Publish a series first" : "";
  }

  async function loadMyComics() {
    const { data, error } = await db
      .from("comics")
      .select("id, slug, title, chapters(chapter_number)")
      .eq("author_id", currentUser.id)
      .order("title", { ascending: true });

    if (error) {
      console.error("Could not load your comics:", error);
      existingSelect.innerHTML = '<option value="">Couldn\'t load your comics</option>';
      return;
    }

    myComics = data.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      chapterNumbers: (c.chapters || []).map((ch) => ch.chapter_number).sort((a, b) => a - b),
    }));
    existingSelect.innerHTML = myComics.length
      ? myComics.map((c) => `<option value="${c.id}">${CV.escapeHtml(c.title)}</option>`).join("")
      : '<option value="">You haven\'t published any series yet</option>';
    if (!busy) updateExistingAvailability();

    const preselect = preselectSlug && myComics.find((c) => c.slug === preselectSlug);
    if (preselect) {
      existingSelect.value = preselect.id;
      setMode("existing");
    }
  }

  // ---- Login gate ---------------------------------------------------------
  let authKnown = false;
  function onAuth(user) {
    // getSession and onAuthStateChange both report on load; react to changes only
    if (authKnown && ((user && user.id) || null) === ((currentUser && currentUser.id) || null)) return;
    authKnown = true;
    currentUser = user;
    if (busy) return;

    if (currentUser) {
      setFormLocked(false);
      ui.clear();
      loadMyComics();
    } else {
      setFormLocked(true);
      ui.show(`You need to <a href="${CV.url.login()}">log in</a> before publishing.`, "error", true);
    }
  }

  setFormLocked(true);
  db.auth.getSession().then(({ data: { session } }) => onAuth(session ? session.user : null));
  db.auth.onAuthStateChange((_event, session) => setTimeout(() => onAuth(session ? session.user : null), 0));

  // ---- Cover --------------------------------------------------------------
  function renderCover() {
    coverPreview.innerHTML = "";
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    coverPreview.innerHTML = `
      <figure class="cover-thumb">
        <img src="${url}" alt="Cover preview">
        <button type="button" class="thumb-remove" aria-label="Remove cover">&times;</button>
        <figcaption>${CV.escapeHtml(coverFile.name)} · ${C.formatBytes(coverFile.size)}</figcaption>
      </figure>`;
    coverPreview.querySelector("img").onload = () => URL.revokeObjectURL(url);
    coverPreview.querySelector(".thumb-remove").addEventListener("click", () => {
      coverFile = null;
      renderCover();
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
    renderCover();
  });

  // ---- Pages --------------------------------------------------------------
  pagesInput.addEventListener("change", async () => {
    const files = Array.from(pagesInput.files);
    pagesInput.value = ""; // allow picking the same files again later
    if (!files.length) return;
    const hasZip = files.some(C.isZip);
    if (hasZip) ui.show("Reading ZIP file…");
    const { errors } = await pages.addFiles(files);
    if (errors.length) ui.show(`Skipped ${errors.length} file${errors.length === 1 ? "" : "s"}: ${errors.join(" ")}`, "error");
    else if (hasZip || !busy) ui.clear();
  });

  // ---- Reset --------------------------------------------------------------
  form.addEventListener("reset", () => {
    pages.clear();
    coverFile = null;
    renderCover();
    ui.clear();
    // The browser resets the fields after this handler runs; re-apply the mode afterwards
    setTimeout(() => setMode(uploadMode), 0);
  });

  // ---- Submit -------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const isNew = uploadMode === "new";
    const title = titleInput.value.trim();
    const chapterNumber = Number(chapterNumInput.value);
    const existing = isNew ? null : selectedComic();

    // 1. Validate
    if (!currentUser) return ui.show(`Please <a href="${CV.url.login()}">log in</a> first.`, "error", true);
    if (isNew) {
      if (!title) return fail("Please enter a comic title.", titleInput);
      if (!genreSelect.value) return fail("Please choose a genre.", genreSelect);
      if (!coverFile) return fail("Please add a cover image.", coverInput);
    } else if (!existing) {
      return fail("Please choose which series this chapter belongs to.", existingSelect);
    }
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return fail("Chapter number must be a whole number, 1 or higher.", chapterNumInput);
    if (existing && existing.chapterNumbers.includes(chapterNumber)) {
      return fail(`"${existing.title}" already has a chapter ${chapterNumber}. Pick a different number.`, chapterNumInput);
    }
    if (!pages.length) return fail("Please add at least one page.", pagesInput);

    busy = true;
    setFormLocked(true);
    submitBtn.textContent = "Publishing…";

    const created = { jobs: [], comicId: null, chapterId: null };

    try {
      // 2. Optimise + upload images
      ui.show("Preparing upload…");
      const slug = isNew ? await C.generateUniqueSlug(db, title) : existing.slug;
      const stamp = Date.now();
      const base = `${currentUser.id}/${slug}`;

      const coverJobs = isNew ? C.imageJobs(db, [coverFile], C.COVER_MAX_WIDTH, (_i, ext) => `${base}/cover-${stamp}.${ext}`) : [];
      const pageJobs = C.imageJobs(
        db,
        pages.newItems.map((it) => it.file),
        C.PAGE_MAX_WIDTH,
        (i, ext) => `${base}/ch-${chapterNumber}-${stamp}/${String(i + 1).padStart(3, "0")}.${ext}`
      );
      created.jobs = [...coverJobs, ...pageJobs];

      const ok = await C.uploadWithRetry(created.jobs, ui);
      if (!ok) {
        await rollback(created);
        return finish("Upload cancelled. Nothing was published.", "info");
      }

      // 3. Save rows
      ui.show("Saving…");
      ui.progress(1);
      let comicId = existing && existing.id;

      if (isNew) {
        const { data: comic, error } = await db
          .from("comics")
          .insert({
            title,
            slug,
            synopsis: synopsisInput.value.trim() || null,
            genre: genreSelect.value,
            reading_mode: modeSelect.value,
            cover_url: coverJobs[0].result,
            author_id: currentUser.id,
          })
          .select("id")
          .single();
        if (error) throw new Error(`Could not save the comic: ${error.message}`);
        comicId = created.comicId = comic.id;
      }

      const { data: chapter, error: chapterError } = await db
        .from("chapters")
        .insert({ comic_id: comicId, chapter_number: chapterNumber, title: chapterTitleInput.value.trim() || null })
        .select("id")
        .single();
      if (chapterError) {
        throw new Error(
          chapterError.code === "23505"
            ? `Chapter ${chapterNumber} already exists for this series.`
            : `Could not save the chapter: ${chapterError.message}`
        );
      }
      created.chapterId = chapter.id;

      const { error: pagesError } = await db
        .from("pages")
        .insert(pageJobs.map((job, i) => ({ chapter_id: chapter.id, page_number: i + 1, image_url: job.result })));
      if (pagesError) throw new Error(`Could not save the pages: ${pagesError.message}`);

      // 4. Done
      const before = created.jobs.reduce((sum, j) => sum + j.weight, 0);
      const after = created.jobs.reduce((sum, j) => sum + j.outBytes, 0);
      ui.show(`Published! ${created.jobs.length} images uploaded (${C.formatBytes(before)} → ${C.formatBytes(after)} after optimising). Opening your chapter…`, "success");
      setTimeout(() => {
        window.location.href = CV.url.reader(slug, chapterNumber);
      }, 1400);
    } catch (err) {
      console.error("Upload error:", err);
      ui.show("Something went wrong, undoing the partial upload…", "error");
      await rollback(created);
      finish(err.message || "Upload failed. Please try again.", "error");
    }
  });

  function fail(message, field) {
    ui.show(message, "error");
    if (field) field.focus();
  }

  function finish(message, type) {
    ui.progress(null);
    ui.show(message, type);
    busy = false;
    setFormLocked(false);
    submitBtn.textContent = uploadMode === "new" ? "Publish series" : "Publish chapter";
  }

  async function rollback({ jobs, comicId, chapterId }) {
    try {
      if (chapterId) {
        await db.from("pages").delete().eq("chapter_id", chapterId);
        await db.from("chapters").delete().eq("id", chapterId);
      }
      if (comicId) await db.from("comics").delete().eq("id", comicId);
      await C.removePaths(db, jobs.map((j) => j.path));
    } catch (err) {
      console.warn("Undo after a failed upload was incomplete:", err);
    }
  }
});
