/* ==========================================================================
   Comic-Vault - Edit chapter (edit-chapter.html?comic=<slug>&chapter=<n>)
   Change the number/title, reorder/remove/add pages, or delete the chapter.
   Saving: upload new pages -> update the chapter -> replace the page list
   (restoring the old list if that fails) -> delete removed images.
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
  const numberInput = $("chapter-number");
  const titleInput = $("chapter-title");
  const pagesInput = $("pages-files");
  const saveBtn = $("save-btn");
  const deleteBtn = $("delete-btn");
  const ui = new C.StatusUI({ status: $("edit-status"), progressWrap: $("edit-progress"), progressBar: $("edit-progress-bar") });
  const pageList = new C.PageList($("pages-list"));
  C.initDropzones(form);

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("comic");
  const requestedNumber = Number(params.get("chapter"));

  const user = await C.requireUser(db, root, "Log in to edit your comics.");
  if (!user) {
    subtitle.textContent = "";
    return;
  }

  const notAllowed = (title, message) => {
    subtitle.textContent = "";
    root.innerHTML = `<div class="grid-message"><h2>${esc(title)}</h2><p>${esc(message)}</p><a class="btn" href="dashboard.html">Go to My Comics</a></div>`;
  };

  if (!slug || !requestedNumber) return notAllowed("No chapter selected", "Choose a chapter to edit from My Comics.");

  const { data: comic, error } = await db
    .from("comics")
    .select("id, slug, title, author_id, chapters(id, chapter_number, title)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("Edit chapter error:", error);
    return notAllowed("Couldn't load this chapter", "Please try again in a moment.");
  }
  if (!comic) return notAllowed("Series not found", "It may have been deleted.");
  if (comic.author_id !== user.id) return notAllowed("Not your series", "You can only edit comics you published.");

  const chapter = (comic.chapters || []).find((c) => c.chapter_number === requestedNumber);
  if (!chapter) return notAllowed("Chapter not found", `"${comic.title}" doesn't have a chapter ${requestedNumber}.`);

  let savedUrls = []; // page URLs as currently saved, in order
  let busy = false;

  async function loadPages() {
    const { data, error: pagesError } = await db
      .from("pages")
      .select("page_number, image_url")
      .eq("chapter_id", chapter.id)
      .order("page_number", { ascending: true });
    if (pagesError) throw pagesError;
    return data || [];
  }

  try {
    savedUrls = (await loadPages()).map((p) => p.image_url);
  } catch (err) {
    console.error("Load pages error:", err);
    return notAllowed("Couldn't load the pages", "Please try again in a moment.");
  }

  function renderHeading() {
    document.title = `Edit chapter ${chapter.chapter_number} - ${comic.title} - Comic-Vault`;
    subtitle.innerHTML = `<a href="${CV.url.series(comic.slug)}">${esc(comic.title)}</a> · <a href="${CV.url.reader(
      comic.slug,
      chapter.chapter_number
    )}">Read chapter ${chapter.chapter_number}</a>`;
  }

  renderHeading();
  numberInput.value = chapter.chapter_number;
  titleInput.value = chapter.title || "";
  pageList.setExisting(savedUrls);
  form.hidden = false;

  pagesInput.addEventListener("change", async () => {
    const files = Array.from(pagesInput.files);
    pagesInput.value = "";
    if (!files.length) return;
    if (files.some(C.isZip)) ui.show("Reading ZIP file…");
    const { added, errors } = await pageList.addFiles(files);
    if (errors.length) ui.show(`Skipped ${errors.length} file${errors.length === 1 ? "" : "s"}: ${errors.join(" ")}`, "error");
    else if (added) ui.show(`Added ${added} page${added === 1 ? "" : "s"} at the end. Move them into place, then save.`, "info");
    else ui.clear();
  });

  function lock(locked) {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => (el.disabled = locked));
    pageList.locked = locked;
  }

  function done(message, type, allowHtml = false) {
    ui.progress(null);
    ui.show(message, type, allowHtml);
    busy = false;
    lock(false);
    saveBtn.textContent = "Save changes";
  }

  // ---- Save ---------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    const number = Number(numberInput.value);
    const title = titleInput.value.trim() || null;
    if (!Number.isInteger(number) || number < 1) {
      ui.show("Chapter number must be a whole number, 1 or higher.", "error");
      return numberInput.focus();
    }
    if (comic.chapters.some((c) => c.id !== chapter.id && c.chapter_number === number)) {
      ui.show(`There's already a chapter ${number} in this series. Pick a different number.`, "error");
      return numberInput.focus();
    }
    if (!pageList.length) {
      ui.show("A chapter needs at least one page. To remove the whole chapter, use Delete chapter below.", "error");
      return;
    }

    const items = pageList.items.slice();
    const newItems = items.filter((it) => it.kind === "new");
    const detailsChanged = number !== chapter.chapter_number || title !== (chapter.title || null);
    const finalOrderPreview = items.map((it) => (it.kind === "existing" ? it.url : `new:${it.id}`));
    const pagesChanged = newItems.length > 0 || finalOrderPreview.join("\n") !== savedUrls.join("\n");
    if (!detailsChanged && !pagesChanged) return ui.show("Nothing to save. No changes yet.", "info");

    busy = true;
    lock(true);
    saveBtn.textContent = "Saving…";
    let jobs = [];

    try {
      // 1. Upload new pages
      if (newItems.length) {
        const folder = `${user.id}/${comic.slug}/ch-${number}-${Date.now()}`;
        jobs = C.imageJobs(
          db,
          newItems.map((it) => it.file),
          C.PAGE_MAX_WIDTH,
          (i, ext) => `${folder}/${String(i + 1).padStart(3, "0")}.${ext}`
        );
        const ok = await C.uploadWithRetry(jobs, ui);
        if (!ok) {
          await C.removePaths(db, jobs.map((j) => j.path));
          return done("Cancelled. Nothing was changed.", "info");
        }
      }
      const urlFor = new Map(newItems.map((it, i) => [it.id, jobs[i].result]));
      const finalUrls = items.map((it) => (it.kind === "existing" ? it.url : urlFor.get(it.id)));

      ui.show("Saving…");
      ui.progress(1);

      // 2. Chapter number / title
      if (detailsChanged) {
        const { error: updateError } = await db
          .from("chapters")
          .update({ chapter_number: number, title })
          .eq("id", chapter.id)
          .select("id")
          .single();
        if (updateError) {
          throw new Error(
            updateError.code === "23505"
              ? `There's already a chapter ${number} in this series.`
              : updateError.code === "PGRST116"
                ? "You don't have permission to edit this chapter."
                : `Couldn't save the chapter: ${updateError.message}`
          );
        }
        chapter.chapter_number = number;
        chapter.title = title;
      }

      // 3. Replace the page list (put the old one back if anything fails)
      if (pagesChanged) {
        const oldRows = await loadPages();
        const { error: deleteError } = await db.from("pages").delete().eq("chapter_id", chapter.id);
        if (deleteError) throw new Error(`Couldn't update the pages: ${deleteError.message}`);

        const { error: insertError } = await db
          .from("pages")
          .insert(finalUrls.map((url, i) => ({ chapter_id: chapter.id, page_number: i + 1, image_url: url })));
        if (insertError) {
          const restore = oldRows.map((r) => ({ chapter_id: chapter.id, page_number: r.page_number, image_url: r.image_url }));
          const { error: restoreError } = restore.length ? await db.from("pages").insert(restore) : { error: null };
          if (restoreError) console.error("Couldn't restore the old pages:", restoreError);
          throw new Error(`Couldn't update the pages: ${insertError.message}`);
        }

        // 4. Saved: delete images that are no longer used
        const kept = new Set(finalUrls);
        await C.removeFilesByUrl(db, oldRows.map((r) => r.image_url).filter((url) => !kept.has(url)));
        savedUrls = finalUrls;
        pageList.setExisting(savedUrls);
      }

      renderHeading();
      try {
        history.replaceState(null, "", `edit-chapter.html?comic=${encodeURIComponent(comic.slug)}&chapter=${chapter.chapter_number}`);
      } catch {
        /* opened from disk */
      }
      done(`Saved! <a href="${CV.url.reader(comic.slug, chapter.chapter_number)}">Read the chapter</a>`, "success", true);
    } catch (err) {
      console.error("Save chapter error:", err);
      // New uploads that never made it into the saved page list are removed
      const used = new Set(savedUrls);
      await C.removePaths(db, jobs.filter((j) => j.path && !used.has(j.result)).map((j) => j.path));
      done(err.message || "Couldn't save. Please try again.", "error");
    }
  });

  // ---- Delete -------------------------------------------------------------
  deleteBtn.addEventListener("click", async () => {
    if (busy) return;
    const ok = window.confirm(`Delete chapter ${chapter.chapter_number} of "${comic.title}"? This can't be undone.`);
    if (!ok) return;
    busy = true;
    lock(true);
    deleteBtn.textContent = "Deleting…";
    ui.show("Deleting the chapter and its images…");
    try {
      await C.deleteChapter(db, chapter.id);
      CV.flash(`Chapter ${chapter.chapter_number} of "${comic.title}" was deleted.`);
      window.location.href = "dashboard.html";
    } catch (err) {
      console.error("Delete chapter error:", err);
      busy = false;
      lock(false);
      deleteBtn.textContent = "Delete this chapter";
      ui.show(err.message || "Couldn't delete the chapter.", "error");
    }
  });
});
