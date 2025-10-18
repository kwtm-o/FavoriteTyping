// script.js
// 共通スクリプト：タイピング練習アプリの中核処理
// index.html（記事リスト）では使われず、typing.htmlで initTypingApp(data) が呼ばれる

export function initTypingApp(tokens) {
  // ========= DOM参照 =========
  const viewport = document.querySelector("#viewport");
  const lines = document.querySelector("#lines");
  const caretEl = document.querySelector("#caret");
  const liveRegion = document.querySelector("#live-region");
  const ghostInput = document.querySelector("#ghost-input");

  const btnStart = document.querySelector("#btn-start");
  const btnRestart = document.querySelector("#btn-restart");
  const toggleIndicateTypos = document.querySelector("#toggle-indicate-typos");
  const toggleCaret = document.querySelector("#toggle-caret");
  const toggleCurrentHighlight = document.querySelector("#toggle-current-highlight");
  const fontSizeSlider = document.querySelector("#font-size");

  const statWpm = document.querySelector("#wpm");
  const statAccuracy = document.querySelector("#accuracy");
  const statErrors = document.querySelector("#errors");
  const statProgress = document.querySelector("#progress");

  // ========= データと状態 =========
  const TOKENS = tokens;
  let ROMAJI = TOKENS.map(t => t.romaji).join("");
  const TOTAL = ROMAJI.length;

  let states = new Int8Array(TOTAL); // 0:未入力, 1:正解, -1:ミス
  let typos = Object.create(null);   // index -> last wrong char
  let charSpans = [];

  let currentIndex = 0;
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;
  let correctCount = 0;
  let errorCount = 0;

  // ========= キャレット点滅制御 =========
  const CARET_IDLE_MS = 650;
  let caretBlinkTimer = null;

  function setCaretBlink(on) {
    caretEl.setAttribute("data-blink", on ? "on" : "off");
  }
  function pauseCaretBlink() {
    setCaretBlink(false);
    clearTimeout(caretBlinkTimer);
    caretBlinkTimer = setTimeout(() => setCaretBlink(true), CARET_IDLE_MS);
  }

  // ========= 表示関連 =========
  function renderText({ animateCaret = false } = {}) {
    let html = "";
    let offset = 0;
    const highlightOn = toggleCurrentHighlight?.checked;

    for (const item of TOKENS) {
      let romajiHTML = "";
      for (let i = 0; i < item.romaji.length; i++) {
        const gi = offset + i;
        const ch = item.romaji[i];
        const st = states[gi];
        const isCurrent = gi === currentIndex;
        const typoChar = typos[gi];
        const classes = ["char"];
        if (st === 1) classes.push("correct");
        if (st === -1) classes.push("wrong");
        if (isCurrent && highlightOn) classes.push("current");

        romajiHTML += `<span class="${classes.join(" ")}" data-index="${gi}">${ch}`;
        if (typoChar && toggleIndicateTypos?.checked) {
          romajiHTML += `<span class="typo-indicator">${typoChar}</span>`;
        }
        romajiHTML += `</span>`;
      }
      offset += item.romaji.length;

      html += `
        <span class="word-group">
          <div class="japanese-text japanese-line">${item.japanese}</div>
          <div class="romaji-text romaji-line">${romajiHTML}</div>
        </span>
      `;
    }

    lines.innerHTML = html;

    // 各文字要素の参照リストを再構築
    const tmp = Array.from(lines.querySelectorAll(".romaji-line .char"));
    const ordered = new Array(TOTAL);
    for (const el of tmp) ordered[Number(el.dataset.index)] = el;
    charSpans = ordered;

    updateCaret(animateCaret);
  }

  function updateCaret(animated = true) {
    if (!toggleCaret.checked) return;
    const target = charSpans[currentIndex] || charSpans[charSpans.length - 1];
    if (!target) return;

    const baseRect = lines.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const x = rect.left - baseRect.left;
    const y = rect.top - baseRect.top;

    caretEl.style.transform = `translate(${x}px, ${y}px)`;
    caretEl.style.height = `${rect.height}px`;
    caretEl.style.transition = animated ? "transform 120ms ease, height 120ms ease" : "none";
  }

  // ========= タイプ処理 =========
  function onTypedChar(ch) {
    if (finished) return;
    if (!started) startRun();

    const expected = ROMAJI[currentIndex];
    if (!expected) return;

    const isCorrect = ch.toLowerCase() === expected.toLowerCase();
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

    if (currentIndex >= TOTAL) completeRun();
  }

  function handleBackspace() {
    if (currentIndex <= 0) return;
    currentIndex--;
    if (states[currentIndex] === 1) correctCount--;
    if (states[currentIndex] === -1) errorCount--;
    states[currentIndex] = 0;
    delete typos[currentIndex];
    renderText({ animateCaret: true });
    updateStatsUI();
  }

  // ========= 統計・UI制御 =========
  function updateStatsUI() {
    const typed = currentIndex;
    const errors = errorCount;
    const elapsedMin = (performance.now() - startTime) / 60000;
    const wpm = elapsedMin > 0 ? Math.round((typed / 5) / elapsedMin) : 0;
    const acc = typed > 0 ? Math.round((correctCount / typed) * 100) : 100;
    const prog = TOTAL > 0 ? Math.round((typed / TOTAL) * 100) : 0;

    statWpm.textContent = wpm;
    statAccuracy.textContent = acc + "%";
    statErrors.textContent = errors;
    statProgress.textContent = prog + "%";
  }

  function startRun() {
    started = true;
    startTime = performance.now();
    btnStart.setAttribute("aria-pressed", "true");
    timerId = setInterval(updateStatsUI, 200);
    ghostInput.focus({ preventScroll: true });
  }

  function resetRun() {
    clearInterval(timerId);
    started = false;
    finished = false;
    startTime = 0;
    currentIndex = 0;
    correctCount = 0;
    errorCount = 0;
    states.fill(0);
    typos = Object.create(null);
    renderText({ animateCaret: false });
    updateStatsUI();
  }

  function completeRun() {
    finished = true;
    clearInterval(timerId);
    liveRegion.textContent = "完了しました。お疲れさまでした。";
    ghostInput.blur();
  }

  // ========= イベント =========
  btnStart.addEventListener("click", () => {
    if (!started) startRun();
  });

  btnRestart.addEventListener("click", () => {
    resetRun();
    startRun();
  });

  fontSizeSlider.addEventListener("input", () => {
    lines.style.fontSize = `${fontSizeSlider.value}px`;
    updateCaret(false);
  });

  toggleCaret.addEventListener("change", () => {
    caretEl.style.display = toggleCaret.checked ? "block" : "none";
    updateCaret(false);
  });

  toggleCurrentHighlight.addEventListener("change", () => {
    renderText({ animateCaret: false });
  });

  toggleIndicateTypos.addEventListener("change", () => {
    renderText({ animateCaret: false });
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      handleBackspace();
    } else if (e.key.length === 1 && !e.isComposing) {
      onTypedChar(e.key);
    }
  });

  window.addEventListener("resize", () => updateCaret(false));
  viewport.addEventListener("click", () => ghostInput.focus());

  // ========= 初期化 =========
  renderText();
  updateStatsUI();
  updateCaret(false);
  setCaretBlink(true);
  ghostInput.focus();
}
