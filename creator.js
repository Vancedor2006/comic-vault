/* ==========================================================================
   ComicVault - creator.js (used by the Publish and Edit pages)
   --------------------------------------------------------------------------
   - Image checks + compression (resize to a sensible width, convert to WebP)
   - ZIP import (JSZip is downloaded only when someone adds a ZIP)
   - PageList: the reorderable list of chapter pages
   - Uploads that retry automatically, with progress + time estimate
   - Deleting comics/chapters: database rows AND their stored image files
   Needs: common.js, supabase.js
   ========================================================================== */
(function () {
  "use strict";

  const BUCKET = "comics";
  const MB = 1024 * 1024;
  const MAX_INPUT_BYTES = 25 * MB; // largest original we accept
  const MAX_UPLOAD_BYTES = 10 * MB; // storage bucket limit (see upload-setup.sql)
  const PAGE_MAX_WIDTH = 1600;
  const COVER_MAX_WIDTH = 600;
  const MAX_CANVAS_PIXELS = 16000000; // stay under mobile Safari's canvas limit
  const MAX_CANVAS_SIDE = 16000;
  const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  const TYPE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const EXT_TYPE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

  const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

  const formatBytes = (bytes) =>
    bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(1)} MB`;

  const formatEta = (seconds) =>
    seconds < 60 ? `about ${Math.max(1, Math.round(seconds))}s left` : `about ${Math.round(seconds / 60)} min left`;

  // Errors that retrying won't fix (bad file, too big, ...)
  function permanentError(message) {
    const err = new Error(message);
    err.permanent = true;
    return err;
  }

  const isZip = (file) =>
    /\.zip$/i.test(file.name) || ["application/zip", "application/x-zip-compressed", "application/x-zip"].includes(file.type);

  function validateImage(file) {
    if (!TYPE_EXT[file.type]) return `"${file.name}" isn't a supported image (JPG, PNG, WEBP or GIF).`;
    if (file.size > MAX_INPUT_BYTES) return `"${file.name}" is larger than ${MAX_INPUT_BYTES / MB} MB.`;
    if (file.type === "image/gif" && file.size > MAX_UPLOAD_BYTES) {
      return `"${file.name}" is a GIF over 10 MB. GIFs can't be shrunk without losing their animation.`;
    }
    return null;
  }

  // ---- Compression --------------------------------------------------------
  async function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close && bitmap.close() };
      } catch {
        /* fall back to an <img> below */
      }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  }

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  /**
   * Shrinks an image to maxWidth (never enlarges) and re-encodes it as WebP
   * (JPEG on browsers that can't make WebP). GIFs are kept as they are so
   * animations survive. Returns { blob, ext }.
   */
  async function compressImage(file, maxWidth) {
    if (file.type === "image/gif") return { blob: file, ext: "gif" };

    let decoded;
    try {
      decoded = await decodeImage(file);
    } catch {
      throw permanentError(`Couldn't read "${file.name}". Is it a valid image?`);
    }

    try {
      const { source, width, height } = decoded;
      if (!width || !height) throw permanentError(`Couldn't read "${file.name}".`);

      const scale = Math.min(
        1,
        maxWidth / width,
        Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
        MAX_CANVAS_SIDE / width,
        MAX_CANVAS_SIDE / height
      );
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(`Couldn't process "${file.name}" (not enough memory?).`);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, w, h);

      let blob = await canvasToBlob(canvas, "image/webp", 0.85);
      if (!blob || blob.type !== "image/webp") {
        // Browser can't encode WebP: use JPEG on a white background
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
      }
      canvas.width = 0; // release memory sooner (matters on iPhones)
      canvas.height = 0;
      if (!blob) throw new Error(`Couldn't process "${file.name}".`);

      // Already small and optimising didn't help: keep the original file
      if (scale === 1 && blob.size >= file.size && file.size <= MAX_UPLOAD_BYTES) {
        return { blob: file, ext: TYPE_EXT[file.type] };
      }
      if (blob.size > MAX_UPLOAD_BYTES) {
        throw permanentError(`"${file.name}" is still larger than 10 MB after optimising. Try exporting it smaller.`);
      }
      return { blob, ext: blob.type === "image/webp" ? "webp" : "jpg" };
    } finally {
      decoded.cleanup();
    }
  }

  // ---- ZIP import ---------------------------------------------------------
  let jszipPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
      jszipPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = JSZIP_URL;
        script.async = true;
        script.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error("The ZIP reader didn't load.")));
        script.onerror = () => {
          jszipPromise = null;
          reject(new Error("Couldn't load the ZIP reader. Check your connection and try again."));
        };
        document.head.appendChild(script);
      });
    }
    return jszipPromise;
  }

  // Returns the images inside a ZIP as File objects, in folder/filename order
  async function imagesFromZip(zipFile) {
    const JSZip = await loadJSZip();
    let zip;
    try {
      zip = await JSZip.loadAsync(zipFile);
    } catch {
      throw new Error(`"${zipFile.name}" isn't a valid ZIP file.`);
    }
    const entries = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const name = path.split("/").pop();
      if (!name || name.startsWith(".") || /(^|\/)__MACOSX\//.test(path)) return;
      const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
      if (EXT_TYPE[ext]) entries.push({ path, name, ext, entry });
    });
    entries.sort((a, b) => naturalCompare(a.path, b.path));
    const files = [];
    for (const e of entries) {
      const blob = await e.entry.async("blob");
      files.push(new File([blob], e.name, { type: EXT_TYPE[e.ext] }));
    }
    if (!files.length) throw new Error(`"${zipFile.name}" doesn't contain any JPG, PNG, WEBP or GIF images.`);
    return files;
  }

  // ---- Page list (reorderable) --------------------------------------------
  class PageList {
    constructor(container, { onChange } = {}) {
      this.el = container;
      this.items = []; // { id, kind: "existing" | "new", url?, file?, preview, name, size }
      this.onChange = onChange || (() => {});
      this.locked = false;
      this.seq = 0;
      container.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn || this.locked) return;
        const index = Number(btn.closest("[data-index]").dataset.index);
        this.act(btn.dataset.action, index);
      });
      this.render();
    }

    get length() {
      return this.items.length;
    }

    get newItems() {
      return this.items.filter((it) => it.kind === "new");
    }

    setExisting(urls) {
      this.clear(false);
      this.items = urls.map((url) => ({ id: ++this.seq, kind: "existing", url, preview: url, name: "Current page", size: 0 }));
      this.changed();
    }

    /** Adds images and/or ZIPs. Returns { added, errors: [messages] } */
    async addFiles(fileList) {
      const errors = [];
      const plain = [];
      const fromZips = [];
      for (const file of Array.from(fileList)) {
        if (isZip(file)) {
          try {
            fromZips.push(...(await imagesFromZip(file)));
          } catch (err) {
            errors.push(err.message);
          }
        } else {
          plain.push(file);
        }
      }

      // Skip files already in the list (same name + size), e.g. picked twice
      const known = new Set(this.newItems.map((it) => `${it.file.name}:${it.file.size}`));
      const accepted = [];
      plain.sort((a, b) => naturalCompare(a.name, b.name));
      for (const file of plain) {
        const err = validateImage(file);
        if (err) errors.push(err);
        else if (!known.has(`${file.name}:${file.size}`)) {
          known.add(`${file.name}:${file.size}`);
          accepted.push(file);
        }
      }
      for (const file of fromZips) {
        const err = validateImage(file);
        if (err) errors.push(err);
        else accepted.push(file); // ZIP order is kept as-is
      }

      this.items.push(
        ...accepted.map((file) => ({
          id: ++this.seq,
          kind: "new",
          file,
          preview: URL.createObjectURL(file),
          name: file.name,
          size: file.size,
        }))
      );
      if (accepted.length) this.changed();
      return { added: accepted.length, errors };
    }

    act(action, i) {
      const items = this.items;
      let focusIndex = i;
      if (action === "up" && i > 0) {
        [items[i - 1], items[i]] = [items[i], items[i - 1]];
        focusIndex = i - 1;
      } else if (action === "down" && i < items.length - 1) {
        [items[i + 1], items[i]] = [items[i], items[i + 1]];
        focusIndex = i + 1;
      } else if (action === "remove") {
        const [gone] = items.splice(i, 1);
        if (gone && gone.kind === "new") URL.revokeObjectURL(gone.preview);
        focusIndex = Math.min(i, items.length - 1);
      } else {
        return;
      }
      this.changed();
      // Keep keyboard focus on the moved item (or next item after removing)
      const row = this.el.querySelector(`[data-index="${focusIndex}"]`);
      if (row) {
        const same = row.querySelector(`[data-action="${action}"]:not(:disabled)`);
        (same || row.querySelector("button:not(:disabled)")).focus();
      }
    }

    clear(notify = true) {
      this.items.forEach((it) => it.kind === "new" && URL.revokeObjectURL(it.preview));
      this.items = [];
      if (notify) this.changed();
    }

    changed() {
      this.render();
      this.onChange(this);
    }

    render() {
      const esc = CV.escapeHtml;
      const n = this.items.length;
      if (!n) {
        this.el.innerHTML = '<p class="empty-list-note">No pages yet.</p>';
        return;
      }
      const fresh = this.newItems;
      const freshBytes = fresh.reduce((sum, it) => sum + it.size, 0);
      this.el.innerHTML = `
        <p class="page-count-note">${n} page${n === 1 ? "" : "s"}${
          fresh.length && fresh.length !== n ? ` · ${fresh.length} new` : ""
        }${fresh.length ? ` · ${formatBytes(freshBytes)} selected, optimised before upload` : ""} · readers see them in this order</p>
        <ol class="page-items">
          ${this.items
            .map(
              (it, i) => `
            <li class="page-item" data-index="${i}">
              <span class="page-num">${i + 1}</span>
              <img src="${esc(it.preview)}" alt="" class="page-thumb" loading="lazy">
              <span class="page-name" title="${esc(it.name)}">${esc(it.name)}</span>
              ${it.kind === "new" && fresh.length !== n ? '<span class="page-tag">New</span>' : ""}
              <div class="page-actions">
                <button type="button" data-action="up" aria-label="Move page ${i + 1} up" ${i === 0 ? "disabled" : ""}>&uarr;</button>
                <button type="button" data-action="down" aria-label="Move page ${i + 1} down" ${i === n - 1 ? "disabled" : ""}>&darr;</button>
                <button type="button" data-action="remove" aria-label="Remove page ${i + 1}">&times;</button>
              </div>
            </li>`
            )
            .join("")}
        </ol>`;
    }
  }

  // ---- Uploading ----------------------------------------------------------
  async function uploadBlob(db, path, blob) {
    const { error } = await db.storage.from(BUCKET).upload(path, blob, {
      cacheControl: "31536000",
      contentType: blob.type || "application/octet-stream",
      upsert: true, // makes retries safe; every path we use is unique anyway
    });
    if (error) throw new Error(error.message || "Upload failed");
    return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /**
   * Builds upload jobs for images. Each job compresses then uploads one file.
   * pathFor(index, ext) -> storage path. job.path is set before uploading so
   * a rollback can always find it.
   */
  function imageJobs(db, files, maxWidth, pathFor) {
    return files.map((file, index) => {
      const job = {
        weight: Math.max(file.size, 1),
        path: null,
        outBytes: 0,
        run: async () => {
          const { blob, ext } = await compressImage(file, maxWidth);
          job.path = pathFor(index, ext);
          const url = await uploadBlob(db, job.path, blob);
          job.outBytes = blob.size;
          return url;
        },
      };
      return job;
    });
  }

  /** Runs jobs with limited concurrency and retries. Returns the failed jobs. */
  async function runJobs(jobs, { concurrency = 3, retries = 2, onProgress } = {}) {
    const pending = jobs.filter((j) => !j.done);
    const totalWeight = jobs.reduce((sum, j) => sum + j.weight, 0);
    let doneWeight = jobs.filter((j) => j.done).reduce((sum, j) => sum + j.weight, 0);
    const startWeight = doneWeight;
    const started = performance.now();

    const report = () => {
      if (!onProgress) return;
      const elapsed = (performance.now() - started) / 1000;
      const doneNow = doneWeight - startWeight;
      const eta = doneNow > 0 && elapsed > 1.5 ? (elapsed / doneNow) * (totalWeight - doneWeight) : null;
      onProgress({
        done: jobs.filter((j) => j.done).length,
        total: jobs.length,
        fraction: totalWeight ? doneWeight / totalWeight : 1,
        eta,
      });
    };
    report();

    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const job = pending[next++];
        job.error = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            job.result = await job.run();
            job.done = true;
            break;
          } catch (err) {
            job.error = err;
            if (err.permanent || attempt === retries) break;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1) ** 2));
          }
        }
        if (job.done) doneWeight += job.weight;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    return jobs.filter((j) => !j.done);
  }

  // ---- Status box with progress bar and Retry / Cancel buttons ------------
  class StatusUI {
    constructor({ status, progressWrap, progressBar }) {
      this.status = status;
      this.progressWrap = progressWrap;
      this.progressBar = progressBar;
    }

    show(message, type = "info", allowHtml = false) {
      this.status.className = `upload-status upload-status-${type}`;
      this.status.hidden = false;
      if (allowHtml) this.status.innerHTML = message;
      else this.status.textContent = message;
    }

    clear() {
      this.status.hidden = true;
      this.status.textContent = "";
      this.progress(null);
    }

    progress(fraction) {
      if (!this.progressWrap) return;
      if (fraction === null || fraction === undefined) {
        this.progressWrap.hidden = true;
        return;
      }
      this.progressWrap.hidden = false;
      const pct = Math.round(fraction * 100);
      this.progressBar.style.width = `${pct}%`;
      this.progressBar.setAttribute("aria-valuenow", String(pct));
    }

    /** Shows buttons under the current message; resolves with the chosen value */
    ask(choices) {
      return new Promise((resolve) => {
        const box = document.createElement("div");
        box.className = "status-actions";
        choices.forEach(({ value, label, style }) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `btn btn-sm ${style || ""}`;
          btn.textContent = label;
          btn.addEventListener("click", () => {
            box.remove();
            resolve(value);
          });
          box.appendChild(btn);
        });
        this.status.appendChild(box);
        box.querySelector("button").focus();
      });
    }
  }

  /**
   * Uploads all jobs. If some fail, offers "Retry failed images" / "Cancel".
   * Resolves true when everything is uploaded, false if the user cancels.
   */
  async function uploadWithRetry(jobs, ui) {
    for (;;) {
      const failed = await runJobs(jobs, {
        onProgress: ({ done, total, fraction, eta }) => {
          ui.progress(fraction);
          ui.show(`Optimising and uploading images… ${done} of ${total}${eta !== null ? ` · ${formatEta(eta)}` : ""}`);
        },
      });
      if (!failed.length) return true;

      const retryable = failed.some((j) => !(j.error && j.error.permanent));
      const reason = (failed[0].error && failed[0].error.message) || "Unknown error";
      ui.show(
        `${failed.length} image${failed.length === 1 ? "" : "s"} couldn't be uploaded. ${reason}` +
          (retryable ? "" : " Remove that page from the list, then publish again."),
        "error"
      );
      const choice = await ui.ask(
        retryable
          ? [
              { value: "retry", label: "Retry failed images" },
              { value: "cancel", label: "Cancel and undo", style: "btn-outline" },
            ]
          : [{ value: "cancel", label: "OK, undo this upload", style: "btn-outline" }]
      );
      if (choice !== "retry") return false;
    }
  }

  // ---- Stored files -------------------------------------------------------
  function storagePathFromUrl(url) {
    if (typeof url !== "string" || typeof SUPABASE_URL === "undefined") return null;
    const prefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
    if (!url.startsWith(prefix)) return null; // not one of our uploads
    try {
      return decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
    } catch {
      return null;
    }
  }

  async function removePaths(db, paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 100) {
      const { error } = await db.storage.from(BUCKET).remove(unique.slice(i, i + 100));
      if (error) console.warn("Some files couldn't be removed:", error.message);
    }
  }

  const removeFilesByUrl = (db, urls) => removePaths(db, urls.map(storagePathFromUrl));

  // ---- Deleting -----------------------------------------------------------
  async function deleteChapter(db, chapterId) {
    const { data: pages, error: pagesError } = await db.from("pages").select("image_url").eq("chapter_id", chapterId);
    if (pagesError) throw new Error(`Couldn't load the chapter's pages: ${pagesError.message}`);

    const { error: deletePagesError } = await db.from("pages").delete().eq("chapter_id", chapterId);
    if (deletePagesError) throw new Error(`Couldn't delete the pages: ${deletePagesError.message}`);

    const { data: deleted, error } = await db.from("chapters").delete().eq("id", chapterId).select("id");
    if (error) throw new Error(`Couldn't delete the chapter: ${error.message}`);
    if (!deleted || !deleted.length) throw new Error("Couldn't delete this chapter. You can only delete chapters of your own comics.");

    await removeFilesByUrl(db, (pages || []).map((p) => p.image_url));
  }

  async function deleteComic(db, comicId) {
    const { data: comic, error } = await db
      .from("comics")
      .select("id, cover_url, chapters(id, pages(image_url))")
      .eq("id", comicId)
      .maybeSingle();
    if (error) throw new Error(`Couldn't load the comic: ${error.message}`);
    if (!comic) throw new Error("This comic no longer exists.");

    const chapters = comic.chapters || [];
    const chapterIds = chapters.map((c) => c.id);
    const urls = [comic.cover_url, ...chapters.flatMap((c) => (c.pages || []).map((p) => p.image_url))];

    if (chapterIds.length) {
      const { error: pagesError } = await db.from("pages").delete().in("chapter_id", chapterIds);
      if (pagesError) throw new Error(`Couldn't delete the pages: ${pagesError.message}`);
      const { error: chaptersError } = await db.from("chapters").delete().in("id", chapterIds);
      if (chaptersError) throw new Error(`Couldn't delete the chapters: ${chaptersError.message}`);
    }

    const { data: deleted, error: comicError } = await db.from("comics").delete().eq("id", comicId).select("id");
    if (comicError) throw new Error(`Couldn't delete the comic: ${comicError.message}`);
    if (!deleted || !deleted.length) throw new Error("Couldn't delete this comic. You can only delete your own comics.");

    await removeFilesByUrl(db, urls);
  }

  // ---- Misc ---------------------------------------------------------------
  function slugify(text) {
    return (
      text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "comic"
    );
  }

  async function generateUniqueSlug(db, title) {
    const base = slugify(title);
    const { data, error } = await db.from("comics").select("slug").like("slug", `${base}%`);
    if (error) throw error;
    const taken = new Set((data || []).map((r) => r.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  // Returns the logged-in user, or shows a "log in" message and returns null
  async function requireUser(db, container, message) {
    const {
      data: { session },
    } = await db.auth.getSession();
    if (session) return session.user;
    container.innerHTML = `
      <div class="grid-message">
        <h2>Log in required</h2>
        <p>${CV.escapeHtml(message)}</p>
        <a class="btn" href="${CV.url.login()}">Log in</a>
      </div>`;
    return null;
  }

  // Wires the drag-over highlight for file drop zones
  function initDropzones(root = document) {
    root.querySelectorAll(".file-dropzone").forEach((zone) => {
      ["dragenter", "dragover"].forEach((evt) => zone.addEventListener(evt, () => zone.classList.add("is-dragover")));
      ["dragleave", "drop"].forEach((evt) => zone.addEventListener(evt, () => zone.classList.remove("is-dragover")));
    });
  }

  window.CVCreator = {
    BUCKET,
    PAGE_MAX_WIDTH,
    COVER_MAX_WIDTH,
    formatBytes,
    formatEta,
    validateImage,
    compressImage,
    isZip,
    imagesFromZip,
    PageList,
    uploadBlob,
    imageJobs,
    runJobs,
    StatusUI,
    uploadWithRetry,
    storagePathFromUrl,
    removePaths,
    removeFilesByUrl,
    deleteChapter,
    deleteComic,
    slugify,
    generateUniqueSlug,
    requireUser,
    initDropzones,
    permanentError,
  };
})();
