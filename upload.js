/* ==========================================================================
   ComicVault - Creator Upload Engine
   --------------------------------------------------------------------------
   Two modes:
     "new"      -> create a series (comics row + cover) and its first chapter
     "existing" -> add a chapter to a series the user already authored
                   (upload.html?comic=<slug> preselects one)

   Flow on submit:
     1. Validate
     2. Upload images to Storage bucket "comics":
          {user_id}/{slug}/cover.ext
          {user_id}/{slug}/ch-{n}-{timestamp}/001.ext, 002.ext ...
     3. Insert rows: (comics) -> chapters -> pages
     4. On failure, delete everything created in this attempt
     5. Redirect to the reader
   ========================================================================== */

const STORAGE_BUCKET = "comics";
const MAX_FILE_MB = 10;
const UPLOAD_CONCURRENCY = 3;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

document.addEventListener("DOMContentLoaded", () => {
  const db = window.supabaseClient;
  const $ = (id) => document.getElementById(id);

  // ---- DOM references -----------------------------------------------------
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
  const pagesList = $("pages-preview-list");
  const submitBtn = $("submit-btn");
  const statusEl = $("upload-status");
  const progressWrap = $("upload-progress");
  const progressBar = $("upload-progress-bar");

  // ---- State --------------------------------------------------------------
  const preselectSlug = new URLSearchParams(window.location.search).get("comic");
  let currentUser = null;
  let uploadMode = "new";
  let myComics = [];       // [{ id, slug, title, chapterNumbers: [] }]
  let coverFile = null;
  let pageFiles = [];      // [{ file, url }]
  let isUploading = false;

  // ---- Helpers ------------------------------------------------------------
  function showStatus(message, type = "info", allowHtml = false) {
    statusEl.className = `upload-status upload-status-${type}`;
    if (allowHtml) statusEl.innerHTML = message;
    else statusEl.textContent = message;
  }

  function clearStatus() {
    statusEl.className = "upload-status hidden";
    statusEl.textContent = "";
  }

  function setProgress(done, total) {
    progressWrap.classList.remove("hidden");
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressBar.setAttribute("aria-valuenow", String(pct));
  }

  function setFormLocked(locked) {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => { el.disabled = locked; });
    if (!locked) updateExistingAvailability();
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "comic";
  }

  function fileExtension(file) {
    const fromName = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
    if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
    return file.type.split("/")[1] || "png";
  }

  // Natural sort so "2.png" comes before "10.png"
  const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

  function validateImage(file) {
    if (!ALLOWED_TYPES.includes(file.type)) return `"${file.name}" isn't a supported image (JPG, PNG, WEBP or GIF).`;
    if (file.size > MAX_FILE_MB * 1024 * 1024) return `"${file.name}" is larger than ${MAX_FILE_MB} MB.`;
    return null;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const selectedComic = () => myComics.find((c) => c.id === existingSelect.value) || null;

  // ---- Mode switching -----------------------------------------------------
  function setMode(mode) {
    uploadMode = mode;
    const isNew = mode === "new";
    seriesSection.classList.toggle("hidden", !isNew);
    existingSection.classList.toggle("hidden", isNew);
    chapterLegend.textContent = isNew ? "First chapter" : "New chapter";
    submitBtn.textContent = isNew ? "Publish series" : "Publish chapter";
    form.querySelector(`input[name="upload-mode"][value="${mode}"]`).checked = true;

    if (isNew) chapterNumInput.value = 1;
    else suggestNextChapterNumber();
    clearStatus();
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
      existingSelect.innerHTML = `<option value="">Couldn't load your comics</option>`;
      return;
    }

    myComics = data.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      chapterNumbers: (c.chapters || []).map((ch) => ch.chapter_number).sort((a, b) => a - b),
    }));

    existingSelect.innerHTML = myComics.length
      ? myComics.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join("")
      : `<option value="">You haven't published any series yet</option>`;
    updateExistingAvailability();

    const preselect = preselectSlug && myComics.find((c) => c.slug === preselectSlug);
    if (preselect) {
      existingSelect.value = preselect.id;
      setMode("existing");
    }
  }

  // ---- Auth gate ----------------------------------------------------------
  let authKnown = false;
  function onAuth(user) {
    // getSession and onAuthStateChange both report on load; only react to real changes
    if (authKnown && (user?.id || null) === (currentUser?.id || null)) return;
    authKnown = true;
    currentUser = user;
    if (isUploading) return;

    if (currentUser) {
      setFormLocked(false);
      clearStatus();
      loadMyComics();
    } else {
      setFormLocked(true);
      const next = encodeURIComponent("upload.html" + window.location.search);
      showStatus(`You need to <a href="login.html?next=${next}">log in</a> before publishing.`, "error", true);
    }
  }

  setFormLocked(true);
  db.auth.getSession().then(({ data: { session } }) => onAuth(session ? session.user : null));
  db.auth.onAuthStateChange((_event, session) => onAuth(session ? session.user : null));

  // ---- Cover preview ------------------------------------------------------
  function renderCover() {
    coverPreview.innerHTML = "";
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    coverPreview.innerHTML = `
      <div class="cover-thumb">
        <img src="${url}" alt="Cover preview">
        <button type="button" class="thumb-remove" aria-label="Remove cover">&times;</button>
      </div>`;
    coverPreview.querySelector("img").onload = () => URL.revokeObjectURL(url);
    coverPreview.querySelector(".thumb-remove").addEventListener("click", () => {
      coverFile = null;
      renderCover();
    });
  }

  coverInput.addEventListener("change", () => {
    const file = coverInput.files[0];
    coverInput.value = "";
    if (!file) return;
    const err = validateImage(file);
    if (err) return showStatus(err, "error");
    clearStatus();
    coverFile = file;
    renderCover();
  });

  // ---- Pages list ---------------------------------------------------------
  function renderPages() {
    if (pageFiles.length === 0) {
      pagesList.innerHTML = '<p class="empty-list-note">No pages selected yet.</p>';
      return;
    }
    pagesList.innerHTML = `
      <p class="page-count-note">${pageFiles.length} page${pageFiles.length === 1 ? "" : "s"} &middot; readers will see them in this order</p>
      <ol class="page-items">
        ${pageFiles.map((p, i) => `
          <li class="page-item" data-index="${i}">
            <span class="page-num">${i + 1}</span>
            <img src="${p.url}" alt="" class="page-thumb">
            <span class="page-name" title="${escapeHtml(p.file.name)}">${escapeHtml(p.file.name)}</span>
            <div class="page-actions">
              <button type="button" data-action="up" aria-label="Move up" ${i === 0 ? "disabled" : ""}>&uarr;</button>
              <button type="button" data-action="down" aria-label="Move down" ${i === pageFiles.length - 1 ? "disabled" : ""}>&darr;</button>
              <button type="button" data-action="remove" aria-label="Remove page">&times;</button>
            </div>
          </li>`).join("")}
      </ol>`;
  }

  pagesList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || isUploading) return;
    const i = Number(btn.closest(".page-item").dataset.index);
    const action = btn.dataset.action;

    if (action === "up" && i > 0) [pageFiles[i - 1], pageFiles[i]] = [pageFiles[i], pageFiles[i - 1]];
    else if (action === "down" && i < pageFiles.length - 1) [pageFiles[i + 1], pageFiles[i]] = [pageFiles[i], pageFiles[i + 1]];
    else if (action === "remove") {
      URL.revokeObjectURL(pageFiles[i].url);
      pageFiles.splice(i, 1);
    }
    renderPages();
  });

  pagesInput.addEventListener("change", () => {
    const incoming = Array.from(pagesInput.files);
    pagesInput.value = "";
    if (!incoming.length) return;

    const errors = [];
    const valid = [];
    for (const file of incoming) {
      const err = validateImage(file);
      if (err) errors.push(err);
      else valid.push(file);
    }

    const existing = new Set(pageFiles.map((p) => `${p.file.name}:${p.file.size}`));
    const fresh = valid
      .filter((f) => !existing.has(`${f.name}:${f.size}`))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));

    pageFiles = pageFiles.concat(fresh);
    renderPages();

    if (errors.length) showStatus(`Skipped ${errors.length} file(s): ${errors.join(" ")}`, "error");
    else clearStatus();
  });

  // Drag-over highlight
  document.querySelectorAll(".file-dropzone").forEach((zone) => {
    ["dragenter", "dragover"].forEach((evt) => zone.addEventListener(evt, () => zone.classList.add("is-dragover")));
    ["dragleave", "drop"].forEach((evt) => zone.addEventListener(evt, () => zone.classList.remove("is-dragover")));
  });

  // ---- Reset --------------------------------------------------------------
  form.addEventListener("reset", () => {
    pageFiles.forEach((p) => URL.revokeObjectURL(p.url));
    pageFiles = [];
    coverFile = null;
    renderCover();
    renderPages();
    clearStatus();
    progressWrap.classList.add("hidden");
    // Native reset runs after this handler; restore mode-dependent fields afterwards
    setTimeout(() => setMode(uploadMode), 0);
  });

  // ---- Supabase operations ------------------------------------------------
  async function generateUniqueSlug(title) {
    const base = slugify(title);
    const { data, error } = await db.from("comics").select("slug").like("slug", `${base}%`);
    if (error) throw error;
    const taken = new Set((data || []).map((r) => r.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async function uploadFile(path, file) {
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(`Upload failed for "${file.name}": ${error.message}`);
    return db.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function runWithConcurrency(jobs, limit, onDone) {
    const results = new Array(jobs.length);
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]();
        onDone();
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
    return results;
  }

  // Undo everything created during a failed attempt
  async function rollback({ uploadedPaths, comicId, chapterId }) {
    try {
      if (chapterId) {
        await db.from("pages").delete().eq("chapter_id", chapterId);
        await db.from("chapters").delete().eq("id", chapterId);
      }
      if (comicId) await db.from("comics").delete().eq("id", comicId);
      if (uploadedPaths.length) await db.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
    } catch (err) {
      console.warn("Rollback after failed upload was incomplete:", err);
    }
  }

  // ---- Submit -------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isUploading) return;

    const isNew = uploadMode === "new";
    const chapterNumber = parseInt(chapterNumInput.value, 10);
    const existing = isNew ? null : selectedComic();
    const title = titleInput.value.trim();

    // 1. Validate
    if (!currentUser) return showStatus('Please <a href="login.html?next=upload.html">log in</a> first.', "error", true);
    if (isNew) {
      if (!title) return showStatus("Please enter a comic title.", "error");
      if (!genreSelect.value) return showStatus("Please choose a genre.", "error");
      if (!coverFile) return showStatus("Please add a cover image.", "error");
    } else if (!existing) {
      return showStatus("Please choose which series this chapter belongs to.", "error");
    }
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return showStatus("Chapter number must be 1 or higher.", "error");
    if (existing && existing.chapterNumbers.includes(chapterNumber)) {
      return showStatus(`"${existing.title}" already has a chapter ${chapterNumber}. Pick a different number.`, "error");
    }
    if (!pageFiles.length) return showStatus("Please add at least one page.", "error");

    isUploading = true;
    setFormLocked(true);
    submitBtn.textContent = "Publishing...";

    const created = { uploadedPaths: [], comicId: null, chapterId: null };

    try {
      // 2. Upload images
      showStatus("Preparing upload...", "info");
      const slug = isNew ? await generateUniqueSlug(title) : existing.slug;
      const basePath = `${currentUser.id}/${slug}`;
      const totalFiles = pageFiles.length + (isNew ? 1 : 0);
      let doneFiles = 0;
      const tick = () => {
        doneFiles++;
        setProgress(doneFiles, totalFiles);
        showStatus(`Uploading images... ${doneFiles} / ${totalFiles}`, "info");
      };
      setProgress(0, totalFiles);

      let coverUrl = null;
      if (isNew) {
        const coverPath = `${basePath}/cover-${Date.now()}.${fileExtension(coverFile)}`;
        created.uploadedPaths.push(coverPath); // tracked before upload so rollback never misses it
        coverUrl = await uploadFile(coverPath, coverFile);
        tick();
      }

      // Timestamped folder so a re-upload never collides with old files
      const chapterFolder = `${basePath}/ch-${chapterNumber}-${Date.now()}`;
      const pageJobs = pageFiles.map((p, i) => async () => {
        const path = `${chapterFolder}/${String(i + 1).padStart(3, "0")}.${fileExtension(p.file)}`;
        created.uploadedPaths.push(path);
        return uploadFile(path, p.file);
      });
      const pageUrls = await runWithConcurrency(pageJobs, UPLOAD_CONCURRENCY, tick);

      // 3. Insert rows
      showStatus("Saving...", "info");
      let comicId = existing?.id;

      if (isNew) {
        const { data: comic, error } = await db
          .from("comics")
          .insert({
            title,
            slug,
            synopsis: synopsisInput.value.trim() || null,
            genre: genreSelect.value,
            reading_mode: modeSelect.value,
            cover_url: coverUrl,
            author_id: currentUser.id, // FK -> profiles.id (same as auth user id)
          })
          .select("id")
          .single();
        if (error) throw new Error(`Could not save comic: ${error.message}`);
        comicId = created.comicId = comic.id;
      }

      const { data: chapter, error: chapterError } = await db
        .from("chapters")
        .insert({
          comic_id: comicId,
          chapter_number: chapterNumber,
          title: chapterTitleInput.value.trim() || null,
        })
        .select("id")
        .single();
      if (chapterError) {
        const dup = chapterError.code === "23505";
        throw new Error(dup ? `Chapter ${chapterNumber} already exists for this series.` : `Could not save chapter: ${chapterError.message}`);
      }
      created.chapterId = chapter.id;

      const { error: pagesError } = await db.from("pages").insert(
        pageUrls.map((url, i) => ({ chapter_id: chapter.id, page_number: i + 1, image_url: url }))
      );
      if (pagesError) throw new Error(`Could not save pages: ${pagesError.message}`);

      // 4. Done
      showStatus("Published! Opening your chapter...", "success");
      setTimeout(() => {
        window.location.href = `reader.html?comic=${encodeURIComponent(slug)}&chapter=${chapterNumber}`;
      }, 1000);
    } catch (err) {
      console.error("Upload error:", err);
      showStatus("Something went wrong, undoing partial upload...", "error");
      await rollback(created);
      showStatus(err.message || "Upload failed. Please try again.", "error");
      progressWrap.classList.add("hidden");
      isUploading = false;
      setFormLocked(false);
      submitBtn.textContent = uploadMode === "new" ? "Publish series" : "Publish chapter";
    }
  });
});
