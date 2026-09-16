/**
 * SystemDesignCards — Spaced repetition flashcard app
 *
 * SM-2 algorithm + gamification + study/reels modes
 */
(function () {
  "use strict";

  // ── Config ──
  const NEW_CARDS_PER_DAY_DEFAULT = 10;
  const LEVEL_UNLOCK_THRESHOLDS = { 2: 20, 3: 50, 4: 100 }; // mastered cards needed
  const XP_MAP = { 1: 0, 2: 1, 3: 2, 4: 3 }; // rating → XP

  // ── State ──
  let allCards = [];
  let cardState = {};   // { [id]: { ef, interval, repetitions, nextReview, status } }
  let gamification = { xp: 0, streak: 0, lastStudyDate: null, unlockedLevels: [1, 2] };
  let settings = { theme: "dark", newPerDay: NEW_CARDS_PER_DAY_DEFAULT };
  let studyQueue = [];
  let studyIndex = 0;
  let sessionStats = { reviewed: 0, correct: 0, xpEarned: 0 };
  let selectedLevel = "all";

  // ── DOM ──
  const $ = (s) => document.getElementById(s);
  const loader = $("loader");
  const loaderFill = loader.querySelector(".loader-fill");

  // ═══════════════════════════
  // SM-2 ALGORITHM
  // ═══════════════════════════
  function sm2(card, rating) {
    // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
    let { ef, interval, repetitions } = card;
    ef = ef || 2.5;
    interval = interval || 0;
    repetitions = repetitions || 0;

    if (rating < 2) {
      // Failed — reset
      repetitions = 0;
      interval = 0;
    } else {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 3;
      else interval = Math.round(interval * ef);
      repetitions++;
    }

    // Update easiness factor
    const q = rating + 1; // map 1-4 to 2-5 for SM-2 formula
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    ef = Math.max(1.3, ef);

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + Math.max(interval, 0));

    const status = (repetitions >= 3 && interval >= 7) ? "mastered" :
                   (repetitions > 0) ? "learning" : "new";

    return { ef, interval, repetitions, nextReview: nextReview.toISOString(), status };
  }

  // ═══════════════════════════
  // DATA LOADING
  // ═══════════════════════════
  async function loadCards() {
    loaderFill.style.width = "20%";
    try {
      const resp = await fetch("cards.json");
      if (!resp.ok) throw new Error("No cards");
      allCards = await resp.json();
    } catch {
      allCards = [];
    }
    loaderFill.style.width = "60%";
    loadState();
    loaderFill.style.width = "80%";

    // Initialize state for new cards
    for (const card of allCards) {
      if (!cardState[card.id]) {
        cardState[card.id] = { ef: 2.5, interval: 0, repetitions: 0, nextReview: null, status: "new" };
      }
    }
    loaderFill.style.width = "100%";
  }

  // ═══════════════════════════
  // PERSISTENCE
  // ═══════════════════════════
  function loadState() {
    try {
      const s = localStorage.getItem("sdc-state");
      if (s) cardState = JSON.parse(s);
      const g = localStorage.getItem("sdc-gamification");
      if (g) gamification = JSON.parse(g);
      const st = localStorage.getItem("sdc-settings");
      if (st) settings = { ...settings, ...JSON.parse(st) };
    } catch { /* fresh start */ }
  }

  function saveState() {
    localStorage.setItem("sdc-state", JSON.stringify(cardState));
    localStorage.setItem("sdc-gamification", JSON.stringify(gamification));
    localStorage.setItem("sdc-settings", JSON.stringify(settings));
  }

  // ═══════════════════════════
  // STREAK & GAMIFICATION
  // ═══════════════════════════
  function updateStreak() {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    if (gamification.lastStudyDate === today) return; // already counted
    if (gamification.lastStudyDate === yesterday) {
      gamification.streak++;
    } else if (gamification.lastStudyDate !== today) {
      gamification.streak = 1;
    }
    gamification.lastStudyDate = today;
    saveState();
  }

  function addXP(rating) {
    const xp = XP_MAP[rating] || 0;
    if (xp === 0) return 0;
    gamification.xp += xp;
    saveState();
    showXPPopup(xp);
    return xp;
  }

  function showXPPopup(amount) {
    const el = $("xp-popup");
    el.textContent = `+${amount} XP`;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 600);
  }

  function checkLevelUnlock() {
    const mastered = Object.values(cardState).filter(s => s.status === "mastered").length;
    for (const [level, threshold] of Object.entries(LEVEL_UNLOCK_THRESHOLDS)) {
      const lvl = parseInt(level);
      if (mastered >= threshold && !gamification.unlockedLevels.includes(lvl)) {
        gamification.unlockedLevels.push(lvl);
        saveState();
        showLevelToast(lvl);
      }
    }
  }

  function showLevelToast(level) {
    const names = { 2: "Core Patterns", 3: "Real Systems", 4: "Expert" };
    $("toast-text").textContent = `🎉 Level ${level} Unlocked: ${names[level]}!`;
    $("level-toast").classList.remove("hidden");
    setTimeout(() => $("level-toast").classList.add("hidden"), 3000);
  }

  // ═══════════════════════════
  // STUDY MODE
  // ═══════════════════════════
  function getStudyQueue() {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const todayNewKey = `sdc-new-${today}`;
    const newToday = parseInt(localStorage.getItem(todayNewKey) || "0", 10);
    const maxNew = settings.newPerDay;

    // Filter by selected level
    let eligible = allCards;
    if (selectedLevel !== "all") {
      eligible = allCards.filter(c => c.level === parseInt(selectedLevel));
    }

    // Only show unlocked levels
    eligible = eligible.filter(c => gamification.unlockedLevels.includes(c.level));

    // Due reviews
    const due = eligible.filter(c => {
      const s = cardState[c.id];
      return s && s.nextReview && new Date(s.nextReview) <= now && s.status !== "new";
    });

    // New cards (up to daily limit)
    const newCards = eligible.filter(c => cardState[c.id]?.status === "new");
    const newBatch = newCards.slice(0, Math.max(0, maxNew - newToday));

    // Mix: due first, then new
    return [...due, ...newBatch];
  }

  function startStudy() {
    studyQueue = getStudyQueue();
    if (studyQueue.length === 0) {
      alert("No cards due! Come back later or increase your daily new card limit.");
      return;
    }
    studyIndex = 0;
    sessionStats = { reviewed: 0, correct: 0, xpEarned: 0 };
    $("study-summary").classList.add("hidden");
    $("card-area").classList.remove("hidden");
    $("session-complete").classList.add("hidden");
    showCard();
  }

  function showCard() {
    if (studyIndex >= studyQueue.length) {
      finishSession();
      return;
    }
    const card = studyQueue[studyIndex];
    const flashcard = $("flashcard");
    flashcard.classList.remove("flipped");
    flashcard.setAttribute("data-card-level", card.level);

    $("card-level-tag").textContent = `L${card.level}`;
    $("card-level-tag-back").textContent = `L${card.level}`;
    $("card-category").textContent = card.category;
    $("card-question").textContent = card.front;
    $("card-answer").textContent = card.back;
    $("card-source").textContent = card.source || "";

    // Diagram
    const diagramEl = $("card-diagram");
    if (card.diagram_svg) {
      diagramEl.innerHTML = `<img src="${card.diagram_svg}" alt="Architecture diagram" class="diagram-img">`;
    } else if (card.diagram) {
      diagramEl.innerHTML = `<pre>${escapeHtml(card.diagram)}</pre>`;
    } else {
      diagramEl.innerHTML = "";
    }

    $("rating-buttons").classList.add("hidden");
    $("card-counter").textContent = `${studyIndex + 1} / ${studyQueue.length}`;
    $("card-progress-fill").style.setProperty("--progress", `${(studyIndex / studyQueue.length) * 100}%`);
  }

  function flipCard() {
    $("flashcard").classList.add("flipped");
    $("rating-buttons").classList.remove("hidden");
  }

  function rateCard(rating) {
    const card = studyQueue[studyIndex];
    const newState = sm2(cardState[card.id], rating);
    cardState[card.id] = newState;

    sessionStats.reviewed++;
    if (rating >= 3) sessionStats.correct++;
    const xp = addXP(rating);
    sessionStats.xpEarned += xp;

    // Track new cards shown today
    if (!cardState[card.id].nextReview || cardState[card.id].status === "new") {
      const today = new Date().toISOString().split("T")[0];
      const key = `sdc-new-${today}`;
      localStorage.setItem(key, String(parseInt(localStorage.getItem(key) || "0", 10) + 1));
    }

    updateStreak();
    checkLevelUnlock();
    saveState();

    studyIndex++;
    showCard();
  }

  function finishSession() {
    $("card-area").classList.add("hidden");
    $("session-complete").classList.remove("hidden");
    $("session-stats").innerHTML = `
      Cards reviewed: ${sessionStats.reviewed}<br>
      Correct: ${sessionStats.correct}/${sessionStats.reviewed}<br>
      XP earned: ⚡ ${sessionStats.xpEarned}
    `;
    updateSummary();
    updateTopBar();
  }

  // ═══════════════════════════
  // REELS MODE
  // ═══════════════════════════
  function initReels() {
    const container = $("reels-container");
    container.innerHTML = "";

    const eligible = allCards.filter(c => gamification.unlockedLevels.includes(c.level));
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);

    for (const card of shuffled.slice(0, 50)) {
      const el = document.createElement("div");
      el.className = "reel-card";
      el.innerHTML = `
        <div class="reel-flashcard" data-card-level="${card.level}">
          <div class="card-level-tag">${"🟢🟡🟠🔴"[card.level - 1]} Level ${card.level}</div>
          <div class="card-category">${escapeHtml(card.category)}</div>
          <div class="card-question">${escapeHtml(card.front)}</div>
          <div class="card-hint">Tap to reveal</div>
          <div class="card-answer">${escapeHtml(card.back)}${
            card.diagram_svg ? `<img src="${card.diagram_svg}" alt="Diagram" class="diagram-img" style="margin-top:12px;max-width:100%;border-radius:8px;background:#fff">` :
            card.diagram ? `<pre style="margin-top:12px;font-size:0.7rem;color:var(--text-muted)">${escapeHtml(card.diagram)}</pre>` : ""
          }</div>
        </div>
        <div class="reel-page-label">${escapeHtml(card.source || "")}</div>
      `;
      el.querySelector(".reel-flashcard").addEventListener("click", function () {
        this.classList.toggle("revealed");
      });
      container.appendChild(el);
    }
  }

  // ═══════════════════════════
  // UI UPDATES
  // ═══════════════════════════
  function updateSummary() {
    const total = allCards.filter(c => gamification.unlockedLevels.includes(c.level)).length;
    const mastered = Object.values(cardState).filter(s => s.status === "mastered").length;
    const queue = getStudyQueue();
    const newCount = allCards.filter(c => cardState[c.id]?.status === "new" &&
      gamification.unlockedLevels.includes(c.level)).length;

    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
    $("ring-pct").textContent = `${pct}%`;
    const circumference = 2 * Math.PI * 52; // r=52
    $("ring-progress").style.strokeDashoffset = circumference * (1 - pct / 100);

    $("stat-due").textContent = queue.length;
    $("stat-new").textContent = newCount;
    $("stat-mastered").textContent = mastered;

    // Level buttons
    document.querySelectorAll(".level-btn[data-level]").forEach(btn => {
      const lvl = btn.dataset.level;
      if (lvl === "all") return;
      const n = parseInt(lvl);
      if (gamification.unlockedLevels.includes(n)) {
        btn.classList.remove("locked");
      } else {
        btn.classList.add("locked");
      }
    });

    $("total-cards-count").textContent = allCards.length;
  }

  function updateTopBar() {
    $("streak-badge").textContent = `🔥 ${gamification.streak}`;
    $("xp-badge").textContent = `⚡ ${gamification.xp} XP`;
  }

  function renderStats() {
    const total = allCards.length;
    const mastered = Object.values(cardState).filter(s => s.status === "mastered").length;
    const learning = Object.values(cardState).filter(s => s.status === "learning").length;
    const newC = total - mastered - learning;

    let html = `
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-num">${gamification.streak}</span><span class="stat-label">Day Streak</span></div>
        <div class="stat-card"><span class="stat-num">${gamification.xp}</span><span class="stat-label">Total XP</span></div>
        <div class="stat-card"><span class="stat-num">${mastered}</span><span class="stat-label">Mastered</span></div>
        <div class="stat-card"><span class="stat-num">${learning}</span><span class="stat-label">Learning</span></div>
      </div>
      <h3 style="margin:12px 0 8px;font-size:0.9rem">Level Progress</h3>
      <div class="level-progress">`;

    const levelNames = { 1: "Foundations", 2: "Core Patterns", 3: "Real Systems", 4: "Expert" };
    const levelColors = { 1: "var(--green)", 2: "var(--yellow)", 3: "var(--orange)", 4: "var(--red)" };
    const levelIcons = { 1: "🟢", 2: "🟡", 3: "🟠", 4: "🔴" };

    for (let lvl = 1; lvl <= 4; lvl++) {
      const lvlCards = allCards.filter(c => c.level === lvl);
      const lvlMastered = lvlCards.filter(c => cardState[c.id]?.status === "mastered").length;
      const pct = lvlCards.length > 0 ? Math.round((lvlMastered / lvlCards.length) * 100) : 0;
      const locked = !gamification.unlockedLevels.includes(lvl);

      html += `<div class="level-row" ${locked ? 'style="opacity:0.4"' : ""}>
        <span class="level-icon">${levelIcons[lvl]}</span>
        <span style="font-size:0.8rem;min-width:90px">${levelNames[lvl]}</span>
        <div class="level-bar"><div class="level-bar-fill" style="width:${pct}%;background:${levelColors[lvl]}"></div></div>
        <span class="level-pct">${lvlMastered}/${lvlCards.length}</span>
      </div>`;
    }
    html += "</div>";
    $("stats-body").innerHTML = html;
  }

  // ═══════════════════════════
  // EVENTS
  // ═══════════════════════════
  // ═══════════════════════════
  // READ MODE (book pages)
  // ═══════════════════════════
  let readBook = "vol1";
  let readPage = 1;
  let readManifests = {};
  let readInitialized = false;

  async function initRead() {
    const bookSel = $("book-select");
    const img = $("read-page-img");
    const slider = $("read-slider");
    const pageNum = $("read-page-num");

    async function loadManifest(book) {
      if (readManifests[book]) return readManifests[book];
      try {
        const r = await fetch(`book/${book}/manifest.json`);
        if (!r.ok) return null;
        const m = await r.json();
        readManifests[book] = m;
        return m;
      } catch { return null; }
    }

    async function showPage() {
      const m = await loadManifest(readBook);
      if (!m) { img.alt = "Book not available"; return; }
      const total = m.total_pages;
      readPage = Math.max(1, Math.min(total, readPage));
      slider.max = total;
      slider.value = readPage;
      pageNum.textContent = `${readPage} / ${total}`;
      img.classList.add("loading");
      img.onload = () => img.classList.remove("loading");
      img.src = `book/${readBook}/page-${String(readPage).padStart(3, "0")}.webp`;
      localStorage.setItem(`sdc-read-${readBook}`, String(readPage));
    }

    // Only bind events once
    if (!readInitialized) {
      readInitialized = true;
      bookSel.addEventListener("change", () => {
        readBook = bookSel.value;
        readPage = parseInt(localStorage.getItem(`sdc-read-${readBook}`) || "1", 10);
        showPage();
      });
      $("read-prev").addEventListener("click", () => { readPage--; showPage(); });
      $("read-next").addEventListener("click", () => { readPage++; showPage(); });
      slider.addEventListener("input", () => { pageNum.textContent = `${slider.value} / ${slider.max}`; });
      slider.addEventListener("change", () => { readPage = parseInt(slider.value, 10); showPage(); });
      document.addEventListener("keydown", (e) => {
        if ($("read-view").classList.contains("hidden")) return;
        if (e.key === "ArrowRight") { readPage++; showPage(); }
        if (e.key === "ArrowLeft") { readPage--; showPage(); }
      });
    }

    readPage = parseInt(localStorage.getItem(`sdc-read-${readBook}`) || "1", 10);
    showPage();
  }

  function setupEvents() {
    // Flashcard tap to flip
    $("flashcard").addEventListener("click", () => {
      if (!$("flashcard").classList.contains("flipped")) flipCard();
    });

    // Rating buttons
    document.querySelectorAll(".rate-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        rateCard(parseInt(btn.dataset.rating));
      });
    });

    // Start study
    $("btn-start-study").addEventListener("click", startStudy);
    $("btn-more-cards").addEventListener("click", startStudy);
    $("btn-back-home").addEventListener("click", () => {
      $("session-complete").classList.add("hidden");
      $("card-area").classList.add("hidden");
      $("study-summary").classList.remove("hidden");
      updateSummary();
    });

    // Mode tabs
    document.querySelectorAll(".mode-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const mode = tab.dataset.mode;
        $("study-view").classList.toggle("hidden", mode !== "study");
        $("reels-view").classList.toggle("hidden", mode !== "reels");
        $("read-view").classList.toggle("hidden", mode !== "read");
        if (mode === "reels") initReels();
        if (mode === "study") updateSummary();
        if (mode === "read") initRead();
      });
    });

    // Level selector
    document.querySelectorAll(".level-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("locked")) return;
        document.querySelectorAll(".level-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedLevel = btn.dataset.level;
        updateSummary();
      });
    });

    // Stats
    $("btn-stats").addEventListener("click", () => {
      renderStats();
      $("stats-panel").classList.remove("hidden");
      $("overlay").classList.remove("hidden");
    });
    $("close-stats").addEventListener("click", closePanels);

    // Settings
    $("btn-settings").addEventListener("click", () => {
      $("settings-panel").classList.remove("hidden");
      $("overlay").classList.remove("hidden");
      $("theme-select").value = settings.theme;
      $("daily-new-select").value = settings.newPerDay;
    });
    $("close-settings").addEventListener("click", closePanels);
    $("theme-select").addEventListener("change", () => {
      settings.theme = $("theme-select").value;
      document.body.className = `theme-${settings.theme}`;
      saveState();
    });
    $("daily-new-select").addEventListener("change", () => {
      settings.newPerDay = parseInt($("daily-new-select").value, 10);
      saveState();
      updateSummary();
    });
    $("btn-reset").addEventListener("click", () => {
      if (confirm("Reset ALL progress? Streak, XP, card states — everything?")) {
        localStorage.clear();
        location.reload();
      }
    });

    $("overlay").addEventListener("click", closePanels);
  }

  function closePanels() {
    $("stats-panel").classList.add("hidden");
    $("settings-panel").classList.add("hidden");
    $("overlay").classList.add("hidden");
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ═══════════════════════════
  // INIT
  // ═══════════════════════════
  async function init() {
    await loadCards();
    document.body.className = `theme-${settings.theme}`;
    updateTopBar();
    updateSummary();
    setupEvents();
    setTimeout(() => loader.classList.add("hidden"), 300);
  }

  init();
})();
