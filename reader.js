/* ==========================================================================
   ComicVault - Reader Engine (Phase 3 Supabase Integration)
   ========================================================================== */

// 1. STATE MANAGEMENT
let currentComicSlug = "neon-rebel";
let currentChapterNum = 1;
let currentPageIndex = 0;
let currentPagesList = [];

// 2. DOM ELEMENT REFERENCES
const elements = {
  comicTitle: document.getElementById("comic-title"),
  chapterTitle: document.getElementById("chapter-title"),
  chapterSelect: document.getElementById("chapter-select"),
  intentBadge: document.getElementById("creator-intent-badge"),
  
  infiniteWrapper: document.getElementById("infinite-wrapper"),
  singleWrapper: document.getElementById("single-page-wrapper"),
  activeImg: document.getElementById("active-page-img"),
  
  prevBtn: document.getElementById("prev-page-btn"),
  nextBtn: document.getElementById("next-page-btn"),
  
  pageCounter: document.getElementById("page-counter"),
  currentPageNum: document.getElementById("current-page-num"),
  totalPagesNum: document.getElementById("total-pages-num")
};

// 3. INITIALIZATION
window.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const comicParam = urlParams.get("comic");
  const chapterParam = urlParams.get("chapter");

  if (comicParam) currentComicSlug = comicParam;
  if (chapterParam) currentChapterNum = parseInt(chapterParam, 10) || 1;

  loadComicChapter(currentComicSlug, currentChapterNum);
  setupEventListeners();
});

// 4. SUPABASE DATABASE QUERY & RENDER
async function loadComicChapter(comicSlug, chapterNum) {
  try {
    // A. Fetch Comic Record
    const { data: comic, error: comicError } = await window.supabaseClient
      .from("comics")
      .select("*")
      .eq("slug", comicSlug)
      .single();

    if (comicError || !comic) {
      throw new Error("Comic not found in database.");
    }

    // B. Fetch Chapter Record
    const { data: chapter, error: chapterError } = await window.supabaseClient
      .from("chapters")
      .select("*")
      .eq("comic_id", comic.id)
      .eq("chapter_number", chapterNum)
      .single();

    if (chapterError || !chapter) {
      throw new Error(`Chapter ${chapterNum} not found for this comic.`);
    }

    // C. Fetch Pages
    const { data: pages, error: pagesError } = await window.supabaseClient
      .from("pages")
      .select("image_url")
      .eq("chapter_id", chapter.id)
      .order("page_number", { ascending: true });

    if (pagesError) throw pagesError;

    currentPagesList = pages.map(p => p.image_url);
    currentPageIndex = 0;

    // D. Update UI
    elements.comicTitle.textContent = comic.title;
    elements.chapterTitle.textContent = chapter.title || `Chapter ${chapter.chapter_number}`;

    if (comic.reading_mode === "infinite") {
      elements.intentBadge.textContent = "Vertical Scroll";
      renderInfiniteMode(currentPagesList);
    } else if (comic.reading_mode === "rtl") {
      elements.intentBadge.textContent = "Manga Mode (RTL)";
      renderSinglePageMode(comic.reading_mode, currentPagesList);
    } else {
      elements.intentBadge.textContent = "Western Mode (LTR)";
      renderSinglePageMode(comic.reading_mode, currentPagesList);
    }

  } catch (err) {
    console.error("Supabase Reader Error:", err.message);
    alert(err.message || "Failed to load comic chapter.");
  }
}

// 5. RENDER MODES
function renderInfiniteMode(pageUrls) {
  elements.infiniteWrapper.style.display = "flex";
  elements.singleWrapper.style.display = "none";
  elements.pageCounter.style.display = "none";

  elements.infiniteWrapper.innerHTML = pageUrls.map((url, index) => `
    <img src="${url}" alt="Page ${index + 1}" class="webtoon-page">
  `).join("");
}

function renderSinglePageMode(mode, pageUrls) {
  elements.infiniteWrapper.style.display = "none";
  elements.singleWrapper.style.display = "flex";
  elements.pageCounter.style.display = "block";

  updateSinglePageDisplay();
}

function updateSinglePageDisplay() {
  if (currentPagesList.length === 0) return;
  
  elements.activeImg.src = currentPagesList[currentPageIndex];
  elements.currentPageNum.textContent = currentPageIndex + 1;
  elements.totalPagesNum.textContent = currentPagesList.length;
}

// 6. PAGE TURNING NAVIGATION
function turnPage(direction, readingMode) {
  if (readingMode === "infinite" || currentPagesList.length === 0) return;

  const totalPages = currentPagesList.length;

  if (direction === "next") {
    if (currentPageIndex < totalPages - 1) {
      currentPageIndex++;
      updateSinglePageDisplay();
    } else {
      alert("End of chapter!");
    }
  } else if (direction === "prev") {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      updateSinglePageDisplay();
    }
  }
}

// 7. EVENT LISTENERS
function setupEventListeners() {
  elements.prevBtn.addEventListener("click", async () => {
    const mode = await getCurrentReadingMode();
    mode === "rtl" ? turnPage("next", mode) : turnPage("prev", mode);
  });

  elements.nextBtn.addEventListener("click", async () => {
    const mode = await getCurrentReadingMode();
    mode === "rtl" ? turnPage("prev", mode) : turnPage("next", mode);
  });

  document.addEventListener("keydown", async (e) => {
    const mode = await getCurrentReadingMode();
    if (mode === "infinite") return;

    if (e.key === "ArrowRight") {
      mode === "rtl" ? turnPage("prev", mode) : turnPage("next", mode);
    } else if (e.key === "ArrowLeft") {
      mode === "rtl" ? turnPage("next", mode) : turnPage("prev", mode);
    }
  });
}

// Helper to check current reading mode
async function getCurrentReadingMode() {
  const { data } = await window.supabaseClient
    .from("comics")
    .select("reading_mode")
    .eq("slug", currentComicSlug)
    .single();
  return data ? data.reading_mode : "ltr";
}