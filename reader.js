/* ==========================================================================
   ComicVault - Reader Engine (Phase 2 Mock Reader)
   ========================================================================== */

// 1. MOCK DATABASE
// In Phase 3, this entire object will be replaced by a single query to Supabase.
const MOCK_DATABASE = {
  "neon-rebel": {
    title: "Neon Rebel",
    readingMode: "infinite", // Options: "infinite", "ltr", "rtl"
    chapters: {
      1: {
        title: "Chapter 1: Cyber City",
        pages: [
          "https://placehold.co/800x1200/1e293b/f97316?text=Neon+Rebel+-+Page+1+(Scroll+Down)",
          "https://placehold.co/800x1200/334155/f97316?text=Neon+Rebel+-+Page+2",
          "https://placehold.co/800x1200/475569/f97316?text=Neon+Rebel+-+Page+3",
          "https://placehold.co/800x1200/0f172a/f97316?text=Neon+Rebel+-+Page+4+(End+of+Chapter)"
        ]
      },
      2: {
        title: "Chapter 2: The Neon Alley",
        pages: [
          "https://placehold.co/800x1200/1e293b/3b82f6?text=Neon+Rebel+Ch.2+-+Page+1",
          "https://placehold.co/800x1200/334155/3b82f6?text=Neon+Rebel+Ch.2+-+Page+2"
        ]
      }
    }
  },
  "shadow-blade": {
    title: "Shadow Blade",
    readingMode: "rtl", // Right-To-Left (Manga)
    chapters: {
      1: {
        title: "Chapter 1: The Way of the Ninja",
        pages: [
          "https://placehold.co/800x1100/1e293b/ef4444?text=Shadow+Blade+Ch.1+-+Page+1+(Cover)",
          "https://placehold.co/800x1100/334155/ef4444?text=Shadow+Blade+Ch.1+-+Page+2+(Click+LEFT+side+for+Next)",
          "https://placehold.co/800x1100/475569/ef4444?text=Shadow+Blade+Ch.1+-+Page+3",
          "https://placehold.co/800x1100/0f172a/ef4444?text=Shadow+Blade+Ch.1+-+Page+4+(End)"
        ]
      }
    }
  },
  "summer-breeze": {
    title: "Summer Breeze",
    readingMode: "ltr", // Left-To-Right (Western)
    chapters: {
      1: {
        title: "Chapter 1: First Day of Sun",
        pages: [
          "https://placehold.co/800x1100/1e293b/10b981?text=Summer+Breeze+Ch.1+-+Page+1+(Click+RIGHT+side+for+Next)",
          "https://placehold.co/800x1100/334155/10b981?text=Summer+Breeze+Ch.1+-+Page+2",
          "https://placehold.co/800x1100/475569/10b981?text=Summer+Breeze+Ch.1+-+Page+3+(End)"
        ]
      }
    }
  }
};

// 2. STATE MANAGEMENT
// Tracks what comic, chapter, and page the reader is currently viewing.
let currentComicKey = "neon-rebel"; // Default fallback
let currentChapterNum = 1;
let currentPageIndex = 0; // 0-indexed for array lookups

// 3. DOM ELEMENT REFERENCES
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

// 4. INITIALIZATION
// Runs when the page loads
window.addEventListener("DOMContentLoaded", () => {
  // Read URL Parameters (e.g. reader.html?comic=shadow-blade&chapter=1)
  const urlParams = new URLSearchParams(window.location.search);
  const comicParam = urlParams.get("comic");
  const chapterParam = urlParams.get("chapter");

  if (comicParam && MOCK_DATABASE[comicParam]) {
    currentComicKey = comicParam;
  }
  if (chapterParam) {
    currentChapterNum = parseInt(chapterParam, 10) || 1;
  }

  loadComicChapter(currentComicKey, currentChapterNum);
  setupEventListeners();
});

// 5. CORE RENDER FUNCTION

function loadComicChapter(comicKey, chapterNum) {
  const comic = MOCK_DATABASE[comicKey];
  const chapter = comic.chapters[chapterNum] || comic.chapters[1];

  // Update Header text
  elements.comicTitle.textContent = comic.title;
  elements.chapterTitle.textContent = chapter.title;

  // Update the Intent Badge based on the comic's mode
  if (comic.readingMode === "infinite") {
    elements.intentBadge.textContent = "Vertical Scroll";
  } else if (comic.readingMode === "rtl") {
    elements.intentBadge.textContent = "Manga Mode (RTL)";
  } else if (comic.readingMode === "ltr") {
    elements.intentBadge.textContent = "Western Mode (LTR)";
  }

  // Reset page position to start of chapter
  currentPageIndex = 0;

  // Render according to Creator's Reading Mode
  if (comic.readingMode === "infinite") {
    renderInfiniteMode(chapter.pages);
  } else {
    renderSinglePageMode(comic.readingMode, chapter.pages);
  }
}

// 6. MODE RENDERERS

// Render Option A: Infinite Scroll (Webtoon / Vertical)
function renderInfiniteMode(pages) {
  elements.infiniteWrapper.style.display = "flex";
  elements.singleWrapper.style.display = "none";
  elements.pageCounter.style.display = "none";

  // Clear existing images and insert new vertical stack
  elements.infiniteWrapper.innerHTML = pages.map((url, index) => `
    <img src="${url}" alt="Page ${index + 1}" class="webtoon-page">
  `).join("");
}

// Render Option B: Single Page View (LTR & RTL)
function renderSinglePageMode(mode, pages) {
  elements.infiniteWrapper.style.display = "none";
  elements.singleWrapper.style.display = "flex";
  elements.pageCounter.style.display = "block";

  // Update image and page totals
  updateSinglePageDisplay(pages);
}

// Updates active image and counters in Single-Page view
function updateSinglePageDisplay(pages) {
  const comic = MOCK_DATABASE[currentComicKey];
  const chapter = comic.chapters[currentChapterNum];

  elements.activeImg.src = chapter.pages[currentPageIndex];
  elements.currentPageNum.textContent = currentPageIndex + 1;
  elements.totalPagesNum.textContent = chapter.pages.length;
}

// 7. NAVIGATION LOGIC (PAGE TURNING)
function turnPage(direction) {
  const comic = MOCK_DATABASE[currentComicKey];
  if (comic.readingMode === "infinite") return; // Page turning disabled in scroll mode

  const chapter = comic.chapters[currentChapterNum];
  const totalPages = chapter.pages.length;

  if (direction === "next") {
    if (currentPageIndex < totalPages - 1) {
      currentPageIndex++;
      updateSinglePageDisplay();
    } else {
      alert("You reached the end of this chapter!");
    }
  } else if (direction === "prev") {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      updateSinglePageDisplay();
    } else {
      alert("You are at the first page of this chapter.");
    }
  }
}

// 8. EVENT LISTENERS
function setupEventListeners() {
  const comic = MOCK_DATABASE[currentComicKey];

  // Click Overlays for Single Page Mode (LTR vs RTL Swap Logic)
  elements.prevBtn.addEventListener("click", () => {
    // In RTL (Manga), the left overlay goes NEXT page
    comic.readingMode === "rtl" ? turnPage("next") : turnPage("prev");
  });

  elements.nextBtn.addEventListener("click", () => {
    // In RTL (Manga), the right overlay goes PREVIOUS page
    comic.readingMode === "rtl" ? turnPage("prev") : turnPage("next");
  });

  // Keyboard Arrow Key Navigation
  document.addEventListener("keydown", (event) => {
    if (comic.readingMode === "infinite") return;

    if (event.key === "ArrowRight") {
      // Right arrow: Next page in LTR, Previous page in RTL
      comic.readingMode === "rtl" ? turnPage("prev") : turnPage("next");
    } else if (event.key === "ArrowLeft") {
      // Left arrow: Previous page in LTR, Next page in RTL
      comic.readingMode === "rtl" ? turnPage("next") : turnPage("prev");
    }
  });

  // Chapter Selector Dropdown Change
  elements.chapterSelect.addEventListener("change", (e) => {
    currentChapterNum = parseInt(e.target.value, 10);
    loadComicChapter(currentComicKey, currentChapterNum);
  });
}