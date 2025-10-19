// ========= Typing Practice Main Script =========
// トークン単位の2段表示（上：日本語／下：ローマ字）＋キャレット移動＋ミスタイプ表示
(() => {
  // ========= DOM ヘルパ =========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ========= 要素参照 =========
  const viewport = $("#viewport");
  const lines = $("#lines");
  const caretEl = $("#caret");
  const ghostInput = $("#ghost-input");

  const btnStart = $("#btn-start");
  const btnRestart = $("#btn-restart");
  const toggleIndicateTypos = $("#toggle-indicate-typos");
  const toggleCaret = $("#toggle-caret");
  const toggleCurrentHighlight = $("#toggle-current-highlight");

  const statWpm = $("#wpm");
  const statAccuracy = $("#accuracy");
  const statErrors = $("#errors");
  const statProgress = $("#progress");

  // ========= ユーティリティ =========
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isPrintableKey(e) {
    if (typeof e.key !== "string") return false;
    if (e.key === " " || e.key === "Spacebar") return true;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)
      return e.key !== "Dead";
    return false;
  }

  function isHighlightOn() {
    return viewport.getAttribute("data-highlight-current") !== "off";
  }

  // ========= 隠し入力欄にフォーカス =========
  function focusInput() {
    if (ghostInput) ghostInput.focus();
  }

  // ========= データ読込（articles.jsonからid指定で取得） =========
  async function loadData() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get("id");
    const res = await fetch("./articles.json");
    if (!res.ok) throw new Error("articles.json の読み込みに失敗しました");

    const json = await res.json();
    const article = json.find((a) => a.id === id) || json[0];
    console.log("📄 選択された原稿:", article.title);
    console.log("✅ tokens数:", article.tokens.length);

    return article.tokens;
  }

  // ========= グローバル変数 =========
  let TOKENS = [];
  let ROMAJI = "";
  let TOTAL = 0;
  let states;
  let typos = Object.create(null);

  let charSpans = [];
  let currentIndex = 0;
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;

  let correctCount = 0;
  let errorCount = 0;

  const CARET_IDLE_MS = 650;
  let caretBlinkTimer = null;

  // ========= キャレット制御 =========
  function setCaretBlink(on) {
    if (!caretEl) return;
    caretEl.setAttribute("data-blink", on ? "on" : "off");
  }

  function pauseCaretBlink() {
    setCaretBlink(false);
    if (caretBlinkTimer) clearTimeout(caretBlinkTimer);
    caretBlinkTimer = setTimeout(() => setCaretBlink(true), CARET_IDLE_MS);
  }

  function resumeCaretBlink() {
    if (caretBlinkTimer) clearTimeout(caretBlinkTimer);
    setCaretBlink(true);
  }

  // ========= タイポスタイル =========
  function installTypoStyles() {
    const STYLE_ID = "typing-typo-style";
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `
      .romaji-line .char { display:inline-block; position:relative; vertical-align:baseline; }
      .romaji-line .char.has-typo { display:inline-block; }
      .romaji-line .char .typo-indicator {
        position:absolute; left:50%; transform:translateX(-50%);
        top:calc(80%); color:#414141;
        font-size:0.75em; line-height:1; pointer-events:none; user-select:none; white-space:pre;
      }
      .typos-on .romaji-line { padding-bottom:1.1em; }
      .word-group { display:inline-block; margin-right:.4em; margin-bottom:.3em; }
      .word-group .japanese-line { color:var(--muted); margin:0 0 2px; font-weight:500; }
      .word-group .romaji-line { margin:0; }
    `;
  }

  // ========= 描画処理 =========
  function renderText({ animateCaret = false } = {}) {
    if (!TOKENS.length) return;

    let html = "";
    let offset = 0;
    const highlightOn = isHighlightOn();

    for (const item of TOKENS) {
      let romajiHTML = "";
      for (let i = 0; i < item.romaji.length; i++) {
        const gi = offset + i;
        const ch = escapeHtml(item.romaji[i]);
        const st = states[gi] || 0;
        const isCurrent = gi === currentIndex;
        const typoChar = typos[gi];

        const classes = ["char"];
        if (st !== 0) classes.push("typed");
        if (st === 1) classes.push("correct");
        if (st === -1) classes.push("wrong");
        if (isCurrent && highlightOn) classes.push("current");
        if (typoChar && toggleIndicateTypos?.checked) classes.push("has-typo");

        romajiHTML += `<span class="${classes.join(" ")}" data-index="${gi}">${ch}`;
        if (typoChar && toggleIndicateTypos?.checked) {
          romajiHTML += `<span class="typo-indicator">${escapeHtml(
            typoChar
          )}</span>`;
        }
        romajiHTML += `</span>`;
      }
      offset += item.romaji.length;

      html += `
        <span class="word-group">
          <div class="japanese-text japanese-line">${escapeHtml(
            item.japanese
          )}</div>
          <div class="romaji-text romaji-line">${romajiHTML}</div>
        </span>
      `;
    }

    lines.innerHTML = html;

    const tmp = $$(".romaji-line .char", lines);
    const ordered = new Array(TOTAL);
    for (const el of tmp) {
      const idx = Number(el.dataset.index);
      ordered[idx] = el;
    }
    charSpans = ordered;
    updateCaret(animateCaret);
  }

  // ========= キャレット更新 =========
  function updateCaret(animated = true) {
    if (!toggleCaret.checked) return;
    if (!charSpans.length) return;

    caretEl.style.position = "absolute";
    caretEl.style.background = "var(--caret-color, currentColor)";
    caretEl.style.width = "1.45px";
    caretEl.style.borderRadius = "1px";
    caretEl.style.opacity = "1";
    caretEl.style.transition = animated
      ? "transform 120ms ease, height 120ms ease"
      : "none";

    let targetRect;
    if (currentIndex < charSpans.length && charSpans[currentIndex]) {
      targetRect = charSpans[currentIndex].getBoundingClientRect();
    } else {
      const last = charSpans[charSpans.length - 1];
      const r = last.getBoundingClientRect();
      targetRect = new DOMRect(r.right, r.top, 0, r.height);
    }

    const baseRect = lines.getBoundingClientRect();
    const x = targetRect.left - baseRect.left;
    const y = targetRect.top - baseRect.top;

    caretEl.style.transform = `translate(${x}px, ${y}px)`;
    caretEl.style.height = `${targetRect.height}px`;
  }

  // ========= 入力処理 =========
  function onTypedChar(inputChar) {
    if (finished) return;
    if (!started) startRun();

    const ch = String(inputChar).toLowerCase();
    const expected = ROMAJI[currentIndex];
    if (expected == null) return;

    const isCorrect = ch === expected;
    if (isCorrect) {
      states[currentIndex] = 1;
      correctCount++;
      delete typos[currentIndex];
    } else {
      states[currentIndex] = -1;
      errorCount++;
      if (toggleIndicateTypos.checked) typos[currentIndex] = ch;
    }

    currentIndex++;
    renderText({ animateCaret: true });
    updateStatsUI();
    pauseCaretBlink();

    if (currentIndex >= TOTAL) finished = true;
  }

  // ========= スタート・リセット =========
  function startRun() {
    if (finished) return;
    started = true;
    if (!startTime) startTime = performance.now();
    if (timerId) clearInterval(timerId);
    timerId = setInterval(updateStatsUI, 200);
    focusInput();
  }

  function resetRun() {
    started = false;
    finished = false;
    startTime = 0;
    if (timerId) clearInterval(timerId);
    timerId = null;
    currentIndex = 0;
    correctCount = 0;
    errorCount = 0;

    states = new Int8Array(TOTAL);
    typos = Object.create(null);
    renderText({ animateCaret: false });
    updateStatsUI();
  }

  // ========= 統計表示 =========
  function updateStatsUI() {
    const typed = currentIndex;
    const errors = errorCount;
    let wpm = 0;
    const now = performance.now();
    const elapsedMs = started || finished
      ? Math.max(1, startTime ? now - startTime : 0)
      : 0;
    const elapsedMin = elapsedMs / 60000;
    if (elapsedMin > 0) wpm = Math.round((typed / 5) / elapsedMin);
    const correct = correctCount;
    const acc = typed > 0
      ? Math.max(0, Math.min(100, Math.round((correct / typed) * 100)))
      : 100;
    const prog = TOTAL > 0 ? Math.round((typed / TOTAL) * 100) : 0;

    statWpm.textContent = String(wpm);
    statAccuracy.textContent = `${acc}%`;
    statErrors.textContent = String(errors);
    statProgress.textContent = `${prog}%`;
  }

  // ========= イベントバインド =========
  function bindEvents() {
    btnStart?.addEventListener("click", () => {
      if (finished) resetRun();
      if (!started) startRun();
      focusInput();
    });

    btnRestart?.addEventListener("click", () => {
      resetRun();
      startRun();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        if (currentIndex > 0) {
          currentIndex--;
          states[currentIndex] = 0;
          renderText({ animateCaret: true });
          updateStatsUI();
        }
        return;
      }
      if (isPrintableKey(e)) {
        e.preventDefault();
        onTypedChar(e.key);
      }
    });
  }

  // ========= 初期化 =========
  async function init() {
    installTypoStyles();

    try {
      TOKENS = await loadData();
      ROMAJI = TOKENS.reduce((acc, t) => acc + t.romaji, "");
      TOTAL = ROMAJI.length;
      states = new Int8Array(TOTAL);
      console.log(`✅ 読み込み完了: ${TOKENS.length}トークン, 総文字数=${TOTAL}`);
    } catch (err) {
      console.error("⚠️ データ読込エラー:", err);
      TOKENS = [{ japanese: "読み込み失敗", romaji: "error" }];
      ROMAJI = "error";
      TOTAL = ROMAJI.length;
      states = new Int8Array(TOTAL);
    }

    renderText();
    bindEvents();
    updateStatsUI();
    resumeCaretBlink();
    focusInput();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
