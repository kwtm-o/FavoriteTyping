// script.js — オリジナルUI版
(async () => {
  // DOM参照
  const $ = (sel) => document.querySelector(sel);
  const viewport = $("#viewport");
  const jaLine = $("#line-japanese");
  const roLine = $("#line-romaji");
  const typoLine = $("#line-typo");
  const caret = $("#caret");
  const ghostInput = $("#ghost-input");
  const wpmEl = $("#wpm");
  const accEl = $("#accuracy");
  const errEl = $("#errors");
  const progEl = $("#progress");

  // コントロール類
  const btnStart = $("#btn-start");
  const btnRestart = $("#btn-restart");
  const chkTypos = $("#toggle-indicate-typos");
  const chkCaret = $("#toggle-caret");
  const chkHighlight = $("#toggle-current-highlight");
  const fontSize = $("#font-size");

  // URLから原稿ID取得
  const params = new URLSearchParams(location.search);
  const id = params.get("article") || "kotowaza";

  // データ読み込み
  const articles = await fetch("./articles.json").then(r => r.json());
  const target = articles.find(a => a.id === id);
  const TOKENS = target ? target.data : [{ japanese: "データなし", romaji: "datanashi" }];

  // 状態変数
  let ROMAJI = TOKENS.map(t => t.romaji).join("");
  const TOTAL = ROMAJI.length;
  let states = new Int8Array(TOTAL);
  let typos = {};
  let idx = 0, correct = 0, errors = 0, startTime = 0, started = false, finished = false;

  // テキスト描画
  function render() {
    const jp = TOKENS.map(t => t.japanese).join("");
    jaLine.textContent = jp;

    const roHtml = [];
    for (let i = 0; i < ROMAJI.length; i++) {
      const ch = ROMAJI[i];
      const st = states[i];
      const cur = i === idx;
      const typo = typos[i];
      let cls = "char";
      if (st === 1) cls += " correct";
      else if (st === -1) cls += " wrong";
      if (cur && chkHighlight.checked) cls += " current";
      roHtml.push(`<span class="${cls}" data-i="${i}">${ch}</span>`);
    }
    roLine.innerHTML = roHtml.join("");
    typoLine.innerHTML = Object.keys(typos).length && chkTypos.checked
      ? Object.values(typos).join("")
      : "";
    updateCaret();
  }

  // キャレット移動
  function updateCaret() {
    if (!chkCaret.checked) { caret.style.display = "none"; return; }
    caret.style.display = "block";
    const charEl = roLine.querySelector(`[data-i="${idx}"]`);
    if (!charEl) return;
    const rect = charEl.getBoundingClientRect();
    const base = roLine.getBoundingClientRect();
    caret.style.transform = `translate(${rect.left - base.left}px, ${rect.top - base.top}px)`;
    caret.style.height = `${rect.height}px`;
  }

  // 入力処理
  function handleInput(ch) {
    if (!started) startRun();
    const expect = ROMAJI[idx];
    if (expect == null) return;
    if (ch.toLowerCase() === expect.toLowerCase()) {
      states[idx] = 1;
      correct++;
      delete typos[idx];
    } else {
      states[idx] = -1;
      errors++;
      typos[idx] = ch;
    }
    idx++;
    render();
    updateStats();
    if (idx >= TOTAL) finishRun();
  }

  function handleBack() {
    if (idx <= 0) return;
    idx--;
    if (states[idx] === 1) correct--;
    if (states[idx] === -1) errors--;
    states[idx] = 0;
    delete typos[idx];
    render();
    updateStats();
  }

  // 統計
  function updateStats() {
    const elapsed = (performance.now() - startTime) / 60000;
    const wpm = elapsed > 0 ? Math.round((idx / 5) / elapsed) : 0;
    const acc = idx > 0 ? Math.round((correct / idx) * 100) : 100;
    const prog = Math.round((idx / TOTAL) * 100);
    wpmEl.textContent = wpm;
    accEl.textContent = acc + "%";
    errEl.textContent = errors;
    progEl.textContent = prog + "%";
  }

  // 開始／終了
  function startRun() {
    started = true;
    finished = false;
    startTime = performance.now();
  }
  function finishRun() {
    finished = true;
    ghostInput.blur();
  }
  function resetRun() {
    states.fill(0);
    typos = {};
    idx = 0;
    correct = 0;
    errors = 0;
    started = false;
    finished = false;
    render();
    updateStats();
  }

  // イベント
  document.addEventListener("keydown", (e) => {
    if (finished) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      handleBack();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      handleInput(e.key);
    }
  });
  btnStart.addEventListener("click", startRun);
  btnRestart.addEventListener("click", resetRun);
  fontSize.addEventListener("input", () => {
    roLine.style.fontSize = fontSize.value + "px";
  });
  chkHighlight.addEventListener("change", render);
  chkTypos.addEventListener("change", render);
  chkCaret.addEventListener("change", render);
  window.addEventListener("resize", updateCaret);

  // 初期化
  render();
  updateStats();
})();
