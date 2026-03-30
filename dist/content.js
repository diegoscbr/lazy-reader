(() => {
  // content/parser.js
  var MAX_DEPTH = 50;
  var SKIP_TAGS = /* @__PURE__ */ new Set(["NAV", "HEADER", "FOOTER", "ASIDE"]);
  var PROSE_TAGS = /* @__PURE__ */ new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "DD", "DT", "FIGCAPTION"]);
  function findContentRoot(doc) {
    const article = doc.querySelector("article");
    if (article) return article;
    const main = doc.querySelector("main");
    if (main) return main;
    return doc.body;
  }
  function splitSentences(text) {
    const sentences = [];
    const regex = /[^.!?]*[.!?]+[\s]?|[^.!?]+$/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const trimmed = match[0].trim();
      if (trimmed.length > 0) {
        sentences.push({ text: trimmed, startIndex: match.index });
      }
    }
    if (sentences.length === 0 && text.trim().length > 0) {
      sentences.push({ text: text.trim(), startIndex: 0 });
    }
    return sentences;
  }
  function getTextContent(node) {
    return node.textContent.replace(/\s+/g, " ").trim();
  }
  function detectLanguage(codeEl) {
    const cls = codeEl.className || "";
    const match = cls.match(/language-(\w+)/);
    return match ? match[1] : "code";
  }
  function countLines(text) {
    return text.split("\n").filter((line) => line.trim().length > 0).length;
  }
  function tableToText(tableEl) {
    const rows = tableEl.querySelectorAll("tr");
    const parts = [];
    rows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      const cellTexts = cells.map((c) => c.textContent.trim()).filter(Boolean);
      if (cellTexts.length > 0) {
        parts.push(`Row ${i + 1}: ${cellTexts.join(", ")}.`);
      }
    });
    return parts.join(" ");
  }
  function walkAndClassify(root, depth = 0) {
    if (depth > MAX_DEPTH) return [];
    const segments = [];
    for (const child of root.children) {
      const tag = child.tagName;
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === "PRE") {
        const codeEl = child.querySelector("code");
        if (codeEl) {
          const lang = detectLanguage(codeEl);
          const lines = countLines(codeEl.textContent);
          segments.push({
            type: "code",
            text: `Code block: ${lines} lines of ${lang}.`,
            node: child,
            sentences: [{ text: `Code block: ${lines} lines of ${lang}.`, startIndex: 0 }]
          });
        }
        continue;
      }
      if (tag === "TABLE") {
        const text = tableToText(child);
        if (text.length > 0) {
          segments.push({ type: "table", text, node: child, sentences: splitSentences(text) });
        }
        continue;
      }
      if (PROSE_TAGS.has(tag)) {
        const text = getTextContent(child);
        if (text.length > 0) {
          segments.push({ type: "prose", text, node: child, sentences: splitSentences(text) });
        }
        continue;
      }
      const nested = walkAndClassify(child, depth + 1);
      segments.push(...nested);
    }
    return segments;
  }
  function parsePageContent(doc) {
    const root = findContentRoot(doc);
    if (!root) return [];
    return walkAndClassify(root);
  }

  // content/tts-client.js
  var MIN_SPEED = 0.5;
  var MAX_SPEED = 3;
  var TTSClient = class {
    constructor() {
      this._eventCallback = null;
      this._segmentChangeCallback = null;
      this._messageListener = (msg) => this._handleMessage(msg);
      chrome.runtime.onMessage.addListener(this._messageListener);
    }
    speak(segments) {
      this._send({ cmd: "speak", segments });
    }
    pause() {
      this._send({ cmd: "pause" });
    }
    resume() {
      this._send({ cmd: "resume" });
    }
    stop() {
      this._send({ cmd: "stop" });
    }
    setSpeed(rate) {
      const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
      this._send({ cmd: "speed", rate: clamped });
    }
    skipForward() {
      this._send({ cmd: "skipForward" });
    }
    skipBack() {
      this._send({ cmd: "skipBack" });
    }
    onEvent(callback) {
      this._eventCallback = callback;
    }
    onSegmentChange(callback) {
      this._segmentChangeCallback = callback;
    }
    destroy() {
      chrome.runtime.onMessage.removeListener(this._messageListener);
      this._eventCallback = null;
      this._segmentChangeCallback = null;
    }
    _send(msg) {
      chrome.runtime.sendMessage(msg, () => {
        if (chrome.runtime.lastError) {
          console.error("Lazy Reader: message send failed", chrome.runtime.lastError.message);
        }
      });
    }
    _handleMessage(msg) {
      if (msg.event === "segmentChange" && this._segmentChangeCallback) {
        this._segmentChangeCallback(msg.segmentIndex);
        return;
      }
      if (msg.event && this._eventCallback) {
        this._eventCallback(msg);
      }
    }
  };

  // content/highlighter.js
  var Highlighter = class {
    constructor() {
      this.mode = "sentence";
      this._currentSegment = null;
      this._sentenceIndex = 0;
      this._sentenceSpans = [];
      this._originalHTML = null;
    }
    setMode(mode) {
      this.mode = mode;
    }
    highlightSegment(segment) {
      this.cleanup();
      this._currentSegment = segment;
      this._sentenceIndex = 0;
      if (this.mode === "sentence") {
        this._wrapSentences(segment);
        this._activateSentence(0);
      }
    }
    advanceSentence() {
      if (!this._currentSegment) return;
      if (this._sentenceIndex >= this._sentenceSpans.length - 1) return;
      this._deactivateAll();
      this._sentenceIndex++;
      this._activateSentence(this._sentenceIndex);
    }
    cleanup() {
      if (!this._currentSegment) return;
      const node = this._currentSegment.node;
      if (this._originalHTML !== null && node) {
        node.innerHTML = this._originalHTML;
      }
      this._currentSegment = null;
      this._sentenceIndex = 0;
      this._sentenceSpans = [];
      this._originalHTML = null;
    }
    _wrapSentences(segment) {
      const node = segment.node;
      this._originalHTML = node.innerHTML;
      this._sentenceSpans = [];
      const fullText = node.textContent;
      const sentences = segment.sentences;
      if (sentences.length === 0) return;
      let html = "";
      let lastEnd = 0;
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i];
        const start = fullText.indexOf(s.text, lastEnd);
        if (start === -1) continue;
        if (start > lastEnd) {
          html += escapeHTML(fullText.slice(lastEnd, start));
        }
        html += `<span class="lazy-reader-sentence" data-sentence="${i}">${escapeHTML(s.text)}</span>`;
        lastEnd = start + s.text.length;
      }
      if (lastEnd < fullText.length) {
        html += escapeHTML(fullText.slice(lastEnd));
      }
      node.innerHTML = html;
      this._sentenceSpans = Array.from(node.querySelectorAll(".lazy-reader-sentence"));
    }
    _activateSentence(index) {
      if (index >= 0 && index < this._sentenceSpans.length) {
        this._sentenceSpans[index].classList.add("lazy-reader-active");
      }
    }
    _deactivateAll() {
      for (const span of this._sentenceSpans) {
        span.classList.remove("lazy-reader-active");
      }
    }
  };
  function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // content/player.js
  var SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  var Player = class {
    constructor() {
      this._host = null;
      this._shadow = null;
      this._callbacks = {
        playPause: null,
        close: null,
        skipForward: null,
        skipBack: null,
        speedChange: null
      };
      this._state = { playing: false, speed: 1 };
    }
    create() {
      if (this._host) return;
      this._host = document.createElement("div");
      this._host.id = "lazy-reader-player";
      this._shadow = this._host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = this._getCSS();
      this._shadow.appendChild(style);
      const bar = document.createElement("div");
      bar.className = "lazy-reader-bar";
      bar.innerHTML = `
      <button data-action="skipback" title="Skip back">\u23EE</button>
      <button data-action="playpause" title="Play/Pause">\u25B6</button>
      <button data-action="skipforward" title="Skip forward">\u23ED</button>
      <div class="lazy-reader-divider"></div>
      <div class="lazy-reader-speed" data-action="speed" title="Click to change speed">1.0x</div>
      <div class="lazy-reader-divider"></div>
      <button data-action="close" title="Close">\u2715</button>
    `;
      bar.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (!action) return;
        switch (action) {
          case "playpause":
            this._callbacks.playPause?.();
            break;
          case "close":
            this._callbacks.close?.();
            break;
          case "skipforward":
            this._callbacks.skipForward?.();
            break;
          case "skipback":
            this._callbacks.skipBack?.();
            break;
          case "speed":
            this._cycleSpeed();
            break;
        }
      });
      this._shadow.appendChild(bar);
      document.body.appendChild(this._host);
    }
    updateState(partial) {
      this._state = { ...this._state, ...partial };
      if (!this._shadow) return;
      const playBtn = this._shadow.querySelector('[data-action="playpause"]');
      if (playBtn) {
        playBtn.textContent = this._state.playing ? "\u23F8" : "\u25B6";
      }
      const speedEl = this._shadow.querySelector('[data-action="speed"]');
      if (speedEl) {
        speedEl.textContent = `${this._state.speed.toFixed(1)}x`;
      }
    }
    destroy() {
      this._host?.remove();
      this._host = null;
      this._shadow = null;
    }
    onPlayPause(cb) {
      this._callbacks = { ...this._callbacks, playPause: cb };
    }
    onClose(cb) {
      this._callbacks = { ...this._callbacks, close: cb };
    }
    onSkipForward(cb) {
      this._callbacks = { ...this._callbacks, skipForward: cb };
    }
    onSkipBack(cb) {
      this._callbacks = { ...this._callbacks, skipBack: cb };
    }
    onSpeedChange(cb) {
      this._callbacks = { ...this._callbacks, speedChange: cb };
    }
    _cycleSpeed() {
      const currentIndex = SPEED_OPTIONS.indexOf(this._state.speed);
      const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
      const newSpeed = SPEED_OPTIONS[nextIndex];
      this.updateState({ speed: newSpeed });
      this._callbacks.speedChange?.(newSpeed);
    }
    _getCSS() {
      return `
      :host {
        all: initial;
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: monospace, sans-serif;
        font-size: 13px;
      }
      .lazy-reader-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        background: rgba(30, 30, 30, 0.92);
        color: #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
        opacity: 0.6;
        transition: opacity 0.2s ease;
        user-select: none;
      }
      .lazy-reader-bar:hover { opacity: 1; }
      .lazy-reader-bar button {
        background: none;
        border: none;
        color: #e0e0e0;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        line-height: 1;
      }
      .lazy-reader-bar button:hover { background: rgba(255, 255, 255, 0.1); }
      .lazy-reader-speed {
        padding: 4px 8px;
        min-width: 40px;
        text-align: center;
        cursor: pointer;
        border-radius: 4px;
      }
      .lazy-reader-speed:hover { background: rgba(255, 255, 255, 0.1); }
      .lazy-reader-divider {
        width: 1px;
        height: 16px;
        background: rgba(255, 255, 255, 0.2);
        margin: 0 2px;
      }
    `;
    }
  };

  // content/storage.js
  var DEFAULT_SETTINGS = Object.freeze({
    speed: 1,
    voiceId: "",
    ttsProvider: "local"
  });
  function loadSettings() {
    return new Promise((resolve) => {
      const keys = Object.keys(DEFAULT_SETTINGS);
      chrome.storage.local.get(keys, (result) => {
        resolve({ ...DEFAULT_SETTINGS, ...result });
      });
    });
  }
  var saveTimer = null;
  function saveSettings(partial) {
    clearTimeout(saveTimer);
    return new Promise((resolve) => {
      saveTimer = setTimeout(() => {
        chrome.storage.local.set(partial, () => {
          if (chrome.runtime.lastError) {
            console.error("Lazy Reader: storage write failed", chrome.runtime.lastError.message);
          }
          resolve();
        });
      }, 300);
    });
  }

  // content/content.js
  if (window.__lazyReaderActive) {
    window.__lazyReaderCleanup?.();
  } else {
    init();
  }
  async function init() {
    window.__lazyReaderActive = true;
    const settings = await loadSettings();
    const segments = parsePageContent(document);
    if (segments.length === 0) {
      showToast("No readable content found on this page.");
      window.__lazyReaderActive = false;
      return;
    }
    const tts = new TTSClient();
    const highlighter = new Highlighter();
    const player = new Player();
    highlighter.setMode("sentence");
    let currentSegmentIndex = 0;
    let playing = false;
    player.create();
    player.updateState({ playing: false, speed: settings.speed });
    player.onPlayPause(() => {
      if (playing) {
        tts.pause();
        playing = false;
      } else {
        if (currentSegmentIndex === 0 && !playing) {
          tts.speak(segments);
          highlighter.highlightSegment(segments[0]);
        } else {
          tts.resume();
        }
        playing = true;
      }
      player.updateState({ playing });
    });
    player.onClose(() => cleanup());
    player.onSkipForward(() => tts.skipForward());
    player.onSkipBack(() => tts.skipBack());
    player.onSpeedChange((speed) => {
      tts.setSpeed(speed);
      saveSettings({ speed });
    });
    tts.onEvent((msg) => {
      if (msg.event === "sentence") {
        highlighter.advanceSentence();
      } else if (msg.event === "end") {
        playing = false;
        player.updateState({ playing: false });
        highlighter.cleanup();
      } else if (msg.event === "error") {
        showToast(`TTS error: ${msg.message}`);
        cleanup();
      }
    });
    tts.onSegmentChange((index) => {
      currentSegmentIndex = index;
      if (index < segments.length) {
        highlighter.highlightSegment(segments[index]);
      }
    });
    const keepaliveInterval = setInterval(() => {
      if (playing) {
        chrome.runtime.sendMessage({ cmd: "keepalive" }).catch(() => {
        });
      }
    }, 2e4);
    function onPageHide() {
      cleanup();
    }
    window.addEventListener("beforeunload", onPageHide);
    function cleanup() {
      tts.stop();
      tts.destroy();
      highlighter.cleanup();
      player.destroy();
      clearInterval(keepaliveInterval);
      window.removeEventListener("beforeunload", onPageHide);
      window.__lazyReaderActive = false;
      window.__lazyReaderCleanup = null;
    }
    window.__lazyReaderCleanup = cleanup;
    tts.speak(segments);
    highlighter.highlightSegment(segments[0]);
    playing = true;
    player.updateState({ playing: true });
  }
  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = `
    position: fixed; bottom: 80px; right: 20px; z-index: 2147483647;
    background: rgba(30,30,30,0.92); color: #e0e0e0; padding: 8px 16px;
    border-radius: 6px; font-size: 13px; font-family: monospace;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4e3);
  }
})();
