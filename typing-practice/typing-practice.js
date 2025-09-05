// src/typing-practice/typing-practice.js
// トークン単位の2段表示（上：日本語／下：ローマ字）＋キャレット移動＋ミスタイプ直下表示
(() => {
  // ========= DOM ヘルパ =========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ========= 要素参照 =========
  const viewport = $("#viewport");
  const lines = $("#lines"); // ここに2段ブロックを描画
  const caretEl = $("#caret");
  const liveRegion = $("#live-region");
  const ghostInput = $("#ghost-input");

  const btnStart = $("#btn-start");
  const btnRestart = $("#btn-restart");
  const toggleIndicateTypos = $("#toggle-indicate-typos");
  const toggleCaret = $("#toggle-caret");
  const toggleCurrentHighlight = $("#toggle-current-highlight");
  const fontSizeSlider = $("#font-size");

  const statWpm = $("#wpm");
  const statAccuracy = $("#accuracy");
  const statErrors = $("#errors");
  const statProgress = $("#progress");

  const lineTypo = $("#line-typo"); // 旧構造（非表示化だけ行う）

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
    // 通常の印字可能キー（記号/数字/英字/スペース）
    if (typeof e.key !== "string") return false;
    if (e.key === " " || e.key === "Spacebar") return true;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // IME合成中などの "Dead" は除外
      return e.key !== "Dead";
    }
    return false;
  }

  // ========= データ =========
  function loadData() {
    const script = $("#ja-romaji-data");
    if (script) {
      try {
        const json = JSON.parse(script.textContent.trim());
        if (Array.isArray(json) && json.length) return json;
      } catch (e) {
        console.warn("JSON parse failed, fallback to global JA_ROMAJI_DATA", e);
      }
    }
    if (Array.isArray(window.JA_ROMAJI_DATA) && window.JA_ROMAJI_DATA.length) {
      return window.JA_ROMAJI_DATA;
    }
    return [{ japanese: "サンプル", romaji: "sanpuru" }];
  }

  let TOKENS = loadData();
  let ROMAJI = TOKENS.map(t => t.romaji).join("");
  let TOTAL = ROMAJI.length;

  // ========= 状態 =========
  // 0:未入力, 1:正解, -1:ミス
  let states = new Int8Array(TOTAL);
  // ミスタイプの最後の1文字（index -> char）
  let typos = Object.create(null);

  let charSpans = []; // data-index 順で参照
  let currentIndex = 0;
  let started = false;
  let finished = false;
  let startTime = 0;
  let timerId = null;

  let correctCount = 0;
  let errorCount = 0;

  // ▼ここに追加（キャレット点滅制御）
  const CARET_IDLE_MS = 650;
  let caretBlinkTimer = null;

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
  // ▲ここまで

  // ========= タイポ表示用の簡易スタイルを注入 =========
  // 置き換え: ミスタイプ表示用スタイルを再定義（inline-flexを廃止）
function installTypoStyles() {
  const STYLE_ID = "typing-typo-style";
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    /* 文字はベースライン固定のまま */
    .romaji-line .char {
      display: inline-block;
      position: relative;   /* インジケータを絶対配置するため */
      vertical-align: baseline;
    }
    /* has-typoでも display を変えない（inline-flexにしない） */
    .romaji-line .char.has-typo {
      display: inline-block;
    }
    /* ミスタイプは文字の「下」に絶対配置（親の高さを変えない） */
    .romaji-line .char .typo-indicator {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      top: calc(100% + 0.15em); /* 文字のベースラインより少し下 */
      color: var(--bad, #d32f2f);
      font-size: 0.75em;
      line-height: 1;
      pointer-events: none;
      user-select: none;
      white-space: pre;
    }
    /* トグルONのときだけ、行全体に下余白を確保して重なりを防ぐ */
    .typos-on .romaji-line {
      padding-bottom: 1.1em; /* インジケータの高さぶんを確保 */
    }

    /* （お好み）2段ブロックのマージン */
    .word-group {
      display: inline-block;
      margin-right: .4em;
      margin-bottom: .3em;
    }
    .word-group .japanese-line {
      color: var(--muted);
      margin: 0 0 2px;
      font-weight: 500;
    }
    .word-group .romaji-line {
      margin: 0;
    }
  `;
}


  // ========= 2段表示（トークン単位） =========
  function renderText({ animateCaret = false } = {}) {
    let html = "";
    let offset = 0;

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
        if (isCurrent) classes.push("current");
        if (typoChar && toggleIndicateTypos?.checked) classes.push("has-typo");

        romajiHTML += `<span class="${classes.join(" ")}" data-index="${gi}">${ch}`;
        if (typoChar && toggleIndicateTypos?.checked) {
          romajiHTML += `<span class="typo-indicator">${escapeHtml(typoChar)}</span>`;
        }
        romajiHTML += `</span>`;
      }
      offset += item.romaji.length;

      html += `
        <span class="word-group">
          <div class="japanese-text japanese-line">${escapeHtml(item.japanese)}</div>
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

  // ========= キャレット =========
  function updateCaret(animated = true) {
    if (!toggleCaret.checked) return;

    caretEl.style.position = "absolute";
    caretEl.style.willChange = "transform, height";
    caretEl.style.pointerEvents = "none";
    caretEl.style.background = "var(--caret-color, currentColor)";
    caretEl.style.width = "2px";
    caretEl.style.borderRadius = "1px";
    caretEl.style.opacity = "1";
    caretEl.style.transition = animated ? "transform 120ms ease, height 120ms ease" : "none";

    let targetRect;
    if (currentIndex < charSpans.length && charSpans[currentIndex]) {
      targetRect = charSpans[currentIndex].getBoundingClientRect();
    } else if (charSpans.length) {
      const last = charSpans[charSpans.length - 1];
      const r = last.getBoundingClientRect();
      targetRect = new DOMRect(r.right, r.top, 0, r.height);
    } else {
      const base = lines.getBoundingClientRect();
      targetRect = new DOMRect(base.left, base.top, 0, base.height);
    }

    const baseRect = lines.getBoundingClientRect();
    const x = targetRect.left - baseRect.left;
    const y = targetRect.top - baseRect.top;

    caretEl.style.transform = `translate(${x}px, ${y}px)`;
    caretEl.style.height = `${targetRect.height}px`;
  }

  function updateCaretVisibility() {
  caretEl.style.display = toggleCaret.checked ? "block" : "none";
  if (toggleCaret.checked) {
    updateCaret(false);
    resumeCaretBlink(); // 表示時は点滅ONに戻す
  } else {
    if (caretBlinkTimer) clearTimeout(caretBlinkTimer);
  }
}

  // ========= タイプ処理 =========
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
      if (typos[currentIndex]) delete typos[currentIndex];
    } else {
      states[currentIndex] = -1;
      errorCount++;
      if (toggleIndicateTypos.checked) {
        typos[currentIndex] = ch;
      }
    }

    currentIndex++;
    renderText({ animateCaret: true });
    updateStatsUI();
    pauseCaretBlink(); // ← これを追加

    if (currentIndex >= TOTAL) {
      completeRun();
    }
  }

  function handleBackspace() {
    if (finished || currentIndex <= 0) return;

    currentIndex--;
    if (states[currentIndex] === 1) correctCount = Math.max(0, correctCount - 1);
    if (states[currentIndex] === -1) errorCount = Math.max(0, errorCount - 1);

    states[currentIndex] = 0;
    if (typos[currentIndex]) delete typos[currentIndex];

    renderText({ animateCaret: true });
    updateStatsUI();
    pauseCaretBlink(); // ← これを追加
  }

  // ========= スタート／リセット／完了 =========
  function startRun() {
    if (finished) return;
    started = true;
    btnStart.setAttribute("aria-pressed", "true");
    if (!startTime) startTime = performance.now();

    if (timerId) clearInterval(timerId);
    timerId = setInterval(updateStatsUI, 200);

    focusInput();
  }

  function resetRun({ rebuild = true } = {}) {
    started = false;
    finished = false;
    startTime = 0;
    if (timerId) clearInterval(timerId);
    timerId = null;
    currentIndex = 0;
    correctCount = 0;
    errorCount = 0;

    btnStart.setAttribute("aria-pressed", "false");

    if (rebuild) {
      ROMAJI = TOKENS.map(t => t.romaji).join("");
      TOTAL = ROMAJI.length;
      states = new Int8Array(TOTAL);
      typos = Object.create(null);
    } else {
      states.fill(0);
      typos = Object.create(null);
    }

    renderText({ animateCaret: false });
    updateStatsUI();
  }

  function completeRun() {
    finished = true;
    started = false;
    if (timerId) clearInterval(timerId);
    timerId = null;

    renderText({ animateCaret: true });
    updateStatsUI();

    liveRegion.textContent = "完了しました。お疲れさまでした。";
    ghostInput.blur();
  }

  // ========= UI/入力 =========
  function focusInput() {
    ghostInput.value = "";
    ghostInput.focus({ preventScroll: true });
    viewport.focus({ preventScroll: true });
  }

  function onViewportClick() {
    focusInput();
  }

  // ghost-input（モバイル含む）
  function onGhostInput() {
    const val = ghostInput.value;
    if (!val) return;
    for (const ch of val) {
      if (finished) break;
      onTypedChar(ch);
    }
    ghostInput.value = "";
  }

  function onKeyDown(e) {
    // グローバルで制御キー処理＋フォールバック入力
    // 1) 制御キー
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      handleBackspace();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      resetRun({ rebuild: false });
      startRun();
      return;
    }
    if (e.key === "Tab" || e.key === "Escape") {
      // 既定動作のまま
      return;
    }

    // 2) 印字可能キーのフォールバック
    // ghost-input がフォーカスされていない場合に拾って処理
    if (isPrintableKey(e) && document.activeElement !== ghostInput) {
      e.preventDefault(); // スクロールやフォーカス移動を防止
      onTypedChar(e.key);
      // 以後は ghost-input にフォーカスを戻す
      focusInput();
    }
  }

  // 置き換え: トグルに応じて余白クラスを付け外し
function updateIndicateTyposUI() {
  if (lineTypo) {
    lineTypo.setAttribute("aria-hidden", "true");
    lineTypo.style.display = "none";
  }
  // ここを追加：ONのときだけ余白を付ける
  lines.classList.toggle("typos-on", toggleIndicateTypos.checked);
  renderText({ animateCaret: false });
}

  function syncFontSize() {
    const size = Number(fontSizeSlider.value || 20);
    lines.style.fontSize = `${size}px`;
    updateCaret(false);
  }

  function updateCurrentHighlightUI() {
  // ONなら data-highlight-current="on"、OFFなら "off"
  const on = toggleCurrentHighlight ? toggleCurrentHighlight.checked : true;
  viewport.setAttribute("data-highlight-current", on ? "on" : "off");
}

  // ========= 統計 =========
  function updateStatsUI() {
    const typed = currentIndex;
    const errors = errorCount;

    let wpm = 0;
    const now = performance.now();
    const elapsedMs = started || finished ? Math.max(1, (startTime ? now - startTime : 0)) : 0;
    const elapsedMin = elapsedMs / 60000;
    if (elapsedMin > 0) {
      wpm = Math.round((typed / 5) / elapsedMin);
    }

    const correct = correctCount;
    const acc = typed > 0 ? Math.max(0, Math.min(100, Math.round((correct / typed) * 100))) : 100;
    const prog = TOTAL > 0 ? Math.round((typed / TOTAL) * 100) : 0;

    statWpm.textContent = String(wpm);
    statAccuracy.textContent = `${acc}%`;
    statErrors.textContent = String(errors);
    statProgress.textContent = `${prog}%`;
  }

  // ========= リサイズ対応 =========
  function onResize() {
    updateCaret(false);
  }

  // ========= イベントバインド =========
  function bindEvents() {
    btnStart?.addEventListener("click", () => {
      if (finished) resetRun({ rebuild: false });
      if (!started) startRun();
      focusInput();
      toggleCurrentHighlight?.addEventListener("change", updateCurrentHighlightUI);
    });

    btnRestart?.addEventListener("click", () => {
      resetRun({ rebuild: false });
      startRun();
    });

    toggleIndicateTypos?.addEventListener("change", updateIndicateTyposUI);
    toggleCaret?.addEventListener("change", updateCaretVisibility);
    fontSizeSlider?.addEventListener("input", syncFontSize);

    viewport?.addEventListener("click", onViewportClick);
    ghostInput?.addEventListener("input", onGhostInput);

    // グローバル keydown: 制御キー処理とフォールバック入力
    document.addEventListener("keydown", onKeyDown);

    window.addEventListener("resize", onResize);
  }

  // ========= 初期化 =========
  function init() {
    installTypoStyles();
    updateIndicateTyposUI();
    renderText({ animateCaret: false });
    bindEvents();
    updateStatsUI();
    updateCaretVisibility();
    syncFontSize();
    resumeCaretBlink(); // ← 初期は点滅させておく
    updateCurrentHighlightUI();

    // 初期フォーカスを与えて、入力開始ですぐ反応するように
    focusInput();

    viewport.setAttribute("aria-label", "トークン単位の2段表示（上：日本語、下：ローマ字）。ローマ字入力で判定します。");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
