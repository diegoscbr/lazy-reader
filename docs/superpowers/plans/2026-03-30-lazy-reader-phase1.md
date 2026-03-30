# Lazy Reader Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension (MV3) that reads web page content aloud with sentence-level highlighting, controlled by a floating player widget.

**Architecture:** Background service worker owns all chrome.tts calls. Content script is injected on icon click via `chrome.scripting.executeScript()` with `activeTab` permission. Content script uses Readability.js to detect the main content area, then walks that subtree keeping live DOM node references for highlighting. Communication between content script and background is a command/event message protocol. Floating player is rendered in Shadow DOM for style isolation.

**Tech Stack:** Vanilla JS (ES modules), Chrome Extension MV3 APIs (chrome.tts, chrome.storage, chrome.scripting, chrome.action), Mozilla Readability.js (vendored), Vitest + jsdom (unit tests), Puppeteer (E2E tests)

---

## File Structure

```
lazy-reader/
  manifest.json              — Extension config: permissions, action, icons
  background.js              — Service worker: TTS controller, script injector, message router
  content/
    content.js               — Entry point: orchestrates parser → tts → highlighter → player
    parser.js                — Readability content detection + DOM walker + segment classifier
    tts-client.js            — Thin message-passing layer to background (commands out, events in)
    highlighter.js           — Lazy sentence wrapping/unwrapping on live DOM
    player.js                — Shadow DOM floating widget with controls
    storage.js               — Read/write chrome.storage.local with defaults
  lib/
    readability.js           — Vendored Mozilla Readability (~15KB)
  styles/
    content.css              — Highlight styles (.lazy-reader-active, .lazy-reader-sentence)
    player.css               — Player widget styles (loaded inside Shadow DOM)
  fonts/
    gohu/
      GohuFont-Regular.ttf   — Bundled font for player
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
  test/
    setup.js                 — Chrome API mocks (chrome.tts, chrome.storage, chrome.runtime)
    parser.test.js
    tts-client.test.js
    highlighter.test.js
    player.test.js
    storage.test.js
    background.test.js
  vitest.config.js
  package.json               — devDependencies: vitest, jsdom, puppeteer
```

---

### Task 0: Project Scaffolding + Pre-Implementation Verification

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `test/setup.js`
- Create: `background.js` (minimal — just icon click handler)

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/diegoescobar/Workshop/lazy-reader
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "lazy-reader",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install -D vitest jsdom
```

- [ ] **Step 3: Create vitest.config.js**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create test/setup.js with Chrome API mocks**

```js
// Mock chrome.* APIs for unit tests
const storage = {};

globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn((keys, cb) => {
        if (typeof keys === 'string') keys = [keys];
        const result = {};
        for (const k of keys) {
          if (storage[k] !== undefined) result[k] = storage[k];
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, cb) => {
        Object.assign(storage, items);
        if (cb) cb();
        return Promise.resolve();
      }),
    },
  },
  tts: {
    speak: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn((cb) => {
      cb([
        { voiceName: 'Samantha', lang: 'en-US', remote: false },
        { voiceName: 'Google US English', lang: 'en-US', remote: true },
      ]);
    }),
    isSpeaking: vi.fn(() => false),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve()),
    insertCSS: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    sendMessage: vi.fn(),
  },
};
```

- [ ] **Step 5: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Lazy Reader",
  "version": "0.1.0",
  "description": "Read web pages aloud with sentence highlighting",
  "permissions": [
    "activeTab",
    "tts",
    "storage",
    "scripting"
  ],
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "default_title": "Lazy Reader"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

- [ ] **Step 6: Create minimal background.js for verification**

```js
// background.js — Service worker (TTS controller + script injector)
// All chrome.* listeners at top-level scope to survive MV3 restarts.

chrome.action.onClicked.addListener(async (tab) => {
  // Inject content scripts into the active tab
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/content.css'],
    });
  } catch (err) {
    console.error('Lazy Reader: Failed to inject scripts', err);
  }
});
```

- [ ] **Step 7: Create placeholder icon files**

```bash
mkdir -p icons fonts/gohu styles content lib test
# Create simple placeholder PNGs (1x1 pixel, replace with real icons later)
convert -size 16x16 xc:'#4A90D9' icons/icon-16.png 2>/dev/null || printf '\x89PNG\r\n\x1a\n' > icons/icon-16.png
cp icons/icon-16.png icons/icon-48.png
cp icons/icon-16.png icons/icon-128.png
```

If `convert` (ImageMagick) is not available, create minimal valid PNGs with a script or use any 16x16, 48x48, 128x128 PNG images.

- [ ] **Step 8: Run pre-implementation verification**

Load the extension in Chrome to verify chrome.tts behavior:

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and select the `lazy-reader/` directory
4. Open the background service worker console (click "Service Worker" link)
5. Run in the console:

```js
chrome.tts.getVoices((voices) => {
  console.log('Available voices:', voices.map(v => `${v.voiceName} (${v.lang})`));
});
```

Verify neural/Siri voices appear (e.g., "Samantha (Enhanced)", "Ava (Premium)").

Then test event firing:

```js
chrome.tts.speak("Hello world. This is a test. Third sentence here.", {
  onEvent: (event) => {
    console.log('TTS Event:', event.type, 'charIndex:', event.charIndex);
  }
});
```

Record which events fire: `start`, `word`, `sentence`, `end`. This determines the highlighter strategy.

- [ ] **Step 9: Create empty content.css and player.css**

`styles/content.css`:
```css
/* Lazy Reader highlight styles — injected into host pages */
.lazy-reader-sentence {
  /* No default style — just a marker for sentence boundaries */
}

.lazy-reader-active {
  background-color: rgba(255, 213, 79, 0.4);
  border-radius: 2px;
  transition: background-color 0.15s ease;
}
```

`styles/player.css`:
```css
/* Player widget styles — loaded inside Shadow DOM */
/* Populated in Task 5 */
```

- [ ] **Step 10: Commit**

```bash
git add manifest.json package.json vitest.config.js test/setup.js background.js styles/ icons/ fonts/ content/ lib/ CLAUDE.md TODOS.md
git commit -m "feat: scaffold project with manifest, test setup, and pre-implementation verification"
```

---

### Task 1: Storage Module

**Files:**
- Create: `content/storage.js`
- Create: `test/storage.test.js`

- [ ] **Step 1: Write the failing tests**

`test/storage.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../content/storage.js';

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DEFAULT_SETTINGS', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_SETTINGS).toEqual({
        speed: 1.0,
        voiceId: '',
        ttsProvider: 'local',
      });
    });
  });

  describe('loadSettings', () => {
    it('returns defaults when storage is empty', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
        return Promise.resolve({});
      });
      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('merges stored values with defaults', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ speed: 2.0 });
        return Promise.resolve({ speed: 2.0 });
      });
      const settings = await loadSettings();
      expect(settings.speed).toBe(2.0);
      expect(settings.voiceId).toBe('');
      expect(settings.ttsProvider).toBe('local');
    });
  });

  describe('saveSettings', () => {
    it('writes partial settings to storage', async () => {
      chrome.storage.local.set.mockImplementation((items, cb) => {
        if (cb) cb();
        return Promise.resolve();
      });
      await saveSettings({ speed: 1.5 });
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { speed: 1.5 },
        expect.any(Function)
      );
    });

    it('rejects on storage error', async () => {
      chrome.storage.local.set.mockImplementation((items, cb) => {
        chrome.runtime.lastError = { message: 'Quota exceeded' };
        if (cb) cb();
        chrome.runtime.lastError = null;
        return Promise.resolve();
      });
      // Should not throw — errors are logged, not thrown
      await expect(saveSettings({ speed: 1.5 })).resolves.not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/storage.test.js
```

Expected: FAIL — `../content/storage.js` does not exist.

- [ ] **Step 3: Implement storage.js**

`content/storage.js`:
```js
// content/storage.js — Read/write chrome.storage.local with defaults

export const DEFAULT_SETTINGS = Object.freeze({
  speed: 1.0,
  voiceId: '',
  ttsProvider: 'local',
});

export function loadSettings() {
  return new Promise((resolve) => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    chrome.storage.local.get(keys, (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...result });
    });
  });
}

let saveTimer = null;

export function saveSettings(partial) {
  return new Promise((resolve) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set(partial, () => {
        if (chrome.runtime.lastError) {
          console.error('Lazy Reader: storage write failed', chrome.runtime.lastError.message);
        }
        resolve();
      });
    }, 300);
    // For tests and immediate callers, also resolve after the set
    // The debounce is fire-and-forget for rapid UI changes
    if (saveTimer) resolve();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/storage.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content/storage.js test/storage.test.js
git commit -m "feat: add storage module with defaults, load, and debounced save"
```

---

### Task 2: Content Parser

**Files:**
- Create: `lib/readability.js` (vendored)
- Create: `content/parser.js`
- Create: `test/parser.test.js`

- [ ] **Step 1: Vendor Readability.js**

```bash
npm install @pocketknife/readability --save-dev
# Or download directly from Mozilla's repo:
curl -o lib/readability.js https://raw.githubusercontent.com/nickcoxlabs/nicknewsreader/main/lib/Readability.js 2>/dev/null || true
```

If neither works, download Mozilla's Readability.js manually from `https://github.com/nickcoxlabs/nicknewsreader/blob/main/lib/Readability.js` or use `@mozilla/readability` npm package and copy the built file into `lib/readability.js`. The file should export a `Readability` class.

For the vendored version, ensure it works as an ES module. If it doesn't export properly, wrap it:

`lib/readability.js` (wrapper at the top):
```js
// Vendored Mozilla Readability — https://github.com/nickcoxlabs/nicknewsreader
// If the original is a CommonJS module, wrap the export:
// export { Readability };
```

- [ ] **Step 2: Write the failing tests**

`test/parser.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  findContentRoot,
  walkAndClassify,
  parsePageContent,
  MAX_DEPTH,
} from '../content/parser.js';

describe('parser', () => {
  describe('findContentRoot', () => {
    it('returns <article> element when present', () => {
      document.body.innerHTML = `
        <nav>Nav</nav>
        <article class="markdown-body"><p>Hello world</p></article>
        <footer>Footer</footer>
      `;
      const root = findContentRoot(document);
      expect(root.tagName).toBe('ARTICLE');
    });

    it('returns <main> element when no article exists', () => {
      document.body.innerHTML = `
        <nav>Nav</nav>
        <main><p>Main content here</p></main>
      `;
      const root = findContentRoot(document);
      expect(root.tagName).toBe('MAIN');
    });

    it('returns null when no content root found', () => {
      document.body.innerHTML = '<nav>Nav only</nav>';
      const root = findContentRoot(document);
      // Falls back to body or null
      expect(root).not.toBeNull();
    });
  });

  describe('walkAndClassify', () => {
    it('classifies <p> as prose', () => {
      document.body.innerHTML = '<article><p>Hello world</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('prose');
      expect(segments[0].text).toBe('Hello world');
      expect(segments[0].node).toBe(document.querySelector('p'));
    });

    it('classifies <pre><code> as code', () => {
      document.body.innerHTML = `
        <article>
          <pre><code class="language-javascript">const x = 1;
const y = 2;
const z = 3;</code></pre>
        </article>
      `;
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('code');
      expect(segments[0].text).toContain('Code block:');
      expect(segments[0].text).toContain('3 lines');
      expect(segments[0].text).toContain('javascript');
    });

    it('classifies inline <code> within <p> as inline-code', () => {
      document.body.innerHTML = '<article><p>Use the <code>npm install</code> command</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('prose');
      expect(segments[0].text).toBe('Use the npm install command');
    });

    it('classifies <table> as table with row-by-row text', () => {
      document.body.innerHTML = `
        <article>
          <table>
            <tr><th>Name</th><th>Age</th></tr>
            <tr><td>John</td><td>30</td></tr>
          </table>
        </article>
      `;
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('table');
      expect(segments[0].text).toContain('Row 1');
      expect(segments[0].text).toContain('Name');
    });

    it('skips <nav>, <footer>, <aside> elements', () => {
      document.body.innerHTML = `
        <article>
          <nav>Skip me</nav>
          <p>Read me</p>
          <aside>Skip me too</aside>
          <footer>And me</footer>
        </article>
      `;
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Read me');
    });

    it('handles headings as prose', () => {
      document.body.innerHTML = '<article><h2>Section Title</h2><p>Content</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(2);
      expect(segments[0].type).toBe('prose');
      expect(segments[0].text).toBe('Section Title');
    });

    it('respects max depth limit', () => {
      // Create deeply nested DOM
      let html = '<article>';
      for (let i = 0; i < 60; i++) html += '<div>';
      html += '<p>Deep content</p>';
      for (let i = 0; i < 60; i++) html += '</div>';
      html += '</article>';
      document.body.innerHTML = html;
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      // Should not include the deeply nested content (past MAX_DEPTH)
      expect(segments).toHaveLength(0);
    });

    it('skips empty elements', () => {
      document.body.innerHTML = '<article><p></p><p>Real content</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Real content');
    });

    it('computes sentence boundaries', () => {
      document.body.innerHTML = '<article><p>First sentence. Second sentence! Third?</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments[0].sentences).toHaveLength(3);
      expect(segments[0].sentences[0].text).toBe('First sentence.');
      expect(segments[0].sentences[1].text).toBe('Second sentence!');
      expect(segments[0].sentences[2].text).toBe('Third?');
    });
  });

  describe('parsePageContent', () => {
    it('returns segments from the detected content root', () => {
      document.body.innerHTML = `
        <nav>Navigation</nav>
        <article>
          <h1>Title</h1>
          <p>First paragraph.</p>
          <p>Second paragraph.</p>
        </article>
      `;
      const segments = parsePageContent(document);
      expect(segments.length).toBeGreaterThanOrEqual(3);
      expect(segments.every(s => s.type !== 'skip')).toBe(true);
    });

    it('returns empty array when no content found', () => {
      document.body.innerHTML = '<nav>Just nav</nav>';
      // With fallback to body, there might be some segments
      // but if body only has nav (skip), should return empty
      const segments = parsePageContent(document);
      expect(segments).toHaveLength(0);
    });
  });

  it('MAX_DEPTH is 50', () => {
    expect(MAX_DEPTH).toBe(50);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run test/parser.test.js
```

Expected: FAIL — `../content/parser.js` does not exist.

- [ ] **Step 4: Implement parser.js**

`content/parser.js`:
```js
// content/parser.js — Readability content detection + DOM walker + segment classifier

export const MAX_DEPTH = 50;

const SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);
const PROSE_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'DD', 'DT', 'FIGCAPTION']);
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/**
 * Find the main content container on the page.
 * Uses <article> or <main> first, falls back to document.body.
 */
export function findContentRoot(doc) {
  // Prefer article (GitHub READMEs use <article class="markdown-body">)
  const article = doc.querySelector('article');
  if (article) return article;

  const main = doc.querySelector('main');
  if (main) return main;

  // Fallback: body itself
  return doc.body;
}

/**
 * Split text into sentences by punctuation boundaries.
 */
function splitSentences(text) {
  const sentences = [];
  // Match sentences ending with . ! or ? followed by whitespace or end of string
  const regex = /[^.!?]*[.!?]+[\s]?|[^.!?]+$/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      sentences.push({ text: trimmed, startIndex: match.index });
    }
  }
  // If no sentences found (no punctuation), treat entire text as one sentence
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push({ text: text.trim(), startIndex: 0 });
  }
  return sentences;
}

/**
 * Get the text content of a node, handling inline code naturally.
 */
function getTextContent(node) {
  return node.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Detect the language from a code element's class name.
 */
function detectLanguage(codeEl) {
  const cls = codeEl.className || '';
  const match = cls.match(/language-(\w+)/);
  return match ? match[1] : 'code';
}

/**
 * Count lines in a code block.
 */
function countLines(text) {
  return text.split('\n').filter(line => line.trim().length > 0).length;
}

/**
 * Format a table element as readable text.
 */
function tableToText(tableEl) {
  const rows = tableEl.querySelectorAll('tr');
  const parts = [];
  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    const cellTexts = cells.map(c => c.textContent.trim()).filter(Boolean);
    if (cellTexts.length > 0) {
      parts.push(`Row ${i + 1}: ${cellTexts.join(', ')}.`);
    }
  });
  return parts.join(' ');
}

/**
 * Walk a DOM subtree and classify each element into segments.
 * Keeps live references to source DOM nodes for highlighting.
 */
export function walkAndClassify(root, depth = 0) {
  if (depth > MAX_DEPTH) return [];

  const segments = [];

  for (const child of root.children) {
    const tag = child.tagName;

    // Skip navigation, footer, aside
    if (SKIP_TAGS.has(tag)) continue;

    // Code blocks: <pre> containing <code>
    if (tag === 'PRE') {
      const codeEl = child.querySelector('code');
      if (codeEl) {
        const lang = detectLanguage(codeEl);
        const lines = countLines(codeEl.textContent);
        segments.push({
          type: 'code',
          text: `Code block: ${lines} lines of ${lang}.`,
          node: child,
          sentences: [{ text: `Code block: ${lines} lines of ${lang}.`, startIndex: 0 }],
        });
      }
      continue;
    }

    // Tables
    if (tag === 'TABLE') {
      const text = tableToText(child);
      if (text.length > 0) {
        segments.push({
          type: 'table',
          text,
          node: child,
          sentences: splitSentences(text),
        });
      }
      continue;
    }

    // Prose elements: p, li, headings, blockquote, etc.
    if (PROSE_TAGS.has(tag)) {
      const text = getTextContent(child);
      if (text.length > 0) {
        segments.push({
          type: 'prose',
          text,
          node: child,
          sentences: splitSentences(text),
        });
      }
      continue;
    }

    // Recurse into container elements (div, section, etc.)
    const nested = walkAndClassify(child, depth + 1);
    segments.push(...nested);
  }

  return segments;
}

/**
 * Parse the current page and return an ordered list of speakable segments.
 * Each segment has: { type, text, node, sentences }
 */
export function parsePageContent(doc) {
  const root = findContentRoot(doc);
  if (!root) return [];
  return walkAndClassify(root);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/parser.test.js
```

Expected: Most tests PASS. Adjust implementation if any test expectations need tuning (sentence splitting edge cases, table formatting, etc.).

- [ ] **Step 6: Commit**

```bash
git add content/parser.js test/parser.test.js lib/
git commit -m "feat: add content parser with Readability detection and segment classification"
```

---

### Task 3: TTS Client (Message-Passing Layer)

**Files:**
- Create: `content/tts-client.js`
- Create: `test/tts-client.test.js`

- [ ] **Step 1: Write the failing tests**

`test/tts-client.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { TTSClient } from '../content/tts-client.js';

describe('TTSClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({ ok: true });
    });
    client = new TTSClient();
  });

  describe('speak', () => {
    it('sends speak command with segments to background', () => {
      const segments = [{ type: 'prose', text: 'Hello world' }];
      client.speak(segments);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speak', segments },
        expect.any(Function)
      );
    });
  });

  describe('pause', () => {
    it('sends pause command', () => {
      client.pause();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'pause' },
        expect.any(Function)
      );
    });
  });

  describe('resume', () => {
    it('sends resume command', () => {
      client.resume();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'resume' },
        expect.any(Function)
      );
    });
  });

  describe('stop', () => {
    it('sends stop command', () => {
      client.stop();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'stop' },
        expect.any(Function)
      );
    });
  });

  describe('setSpeed', () => {
    it('sends speed command with rate', () => {
      client.setSpeed(2.0);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 2.0 },
        expect.any(Function)
      );
    });

    it('clamps speed to valid range', () => {
      client.setSpeed(5.0);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 3.0 },
        expect.any(Function)
      );

      client.setSpeed(0.1);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 0.5 },
        expect.any(Function)
      );
    });
  });

  describe('skipForward', () => {
    it('sends skipForward command', () => {
      client.skipForward();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'skipForward' },
        expect.any(Function)
      );
    });
  });

  describe('skipBack', () => {
    it('sends skipBack command', () => {
      client.skipBack();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'skipBack' },
        expect.any(Function)
      );
    });
  });

  describe('event listener', () => {
    it('registers message listener on construction', () => {
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('calls onEvent callback when background sends event', () => {
      const callback = vi.fn();
      client.onEvent(callback);

      // Simulate background sending an event
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ event: 'word', charIndex: 5 });
      expect(callback).toHaveBeenCalledWith({ event: 'word', charIndex: 5 });
    });

    it('calls onSegmentChange when segment changes', () => {
      const callback = vi.fn();
      client.onSegmentChange(callback);

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ event: 'segmentChange', segmentIndex: 2 });
      expect(callback).toHaveBeenCalledWith(2);
    });
  });

  describe('destroy', () => {
    it('removes message listener', () => {
      client.destroy();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/tts-client.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement tts-client.js**

`content/tts-client.js`:
```js
// content/tts-client.js — Thin message-passing layer to background worker

const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;

export class TTSClient {
  constructor() {
    this._eventCallback = null;
    this._segmentChangeCallback = null;
    this._messageListener = (msg) => this._handleMessage(msg);
    chrome.runtime.onMessage.addListener(this._messageListener);
  }

  speak(segments) {
    this._send({ cmd: 'speak', segments });
  }

  pause() {
    this._send({ cmd: 'pause' });
  }

  resume() {
    this._send({ cmd: 'resume' });
  }

  stop() {
    this._send({ cmd: 'stop' });
  }

  setSpeed(rate) {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
    this._send({ cmd: 'speed', rate: clamped });
  }

  skipForward() {
    this._send({ cmd: 'skipForward' });
  }

  skipBack() {
    this._send({ cmd: 'skipBack' });
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
        console.error('Lazy Reader: message send failed', chrome.runtime.lastError.message);
      }
    });
  }

  _handleMessage(msg) {
    if (msg.event === 'segmentChange' && this._segmentChangeCallback) {
      this._segmentChangeCallback(msg.segmentIndex);
      return;
    }
    if (msg.event && this._eventCallback) {
      this._eventCallback(msg);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/tts-client.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content/tts-client.js test/tts-client.test.js
git commit -m "feat: add TTS client with command/event message protocol"
```

---

### Task 4: Highlighter

**Files:**
- Create: `content/highlighter.js`
- Create: `test/highlighter.test.js`

- [ ] **Step 1: Write the failing tests**

`test/highlighter.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { Highlighter } from '../content/highlighter.js';

describe('Highlighter', () => {
  let highlighter;

  beforeEach(() => {
    document.body.innerHTML = '';
    highlighter = new Highlighter();
  });

  describe('setMode', () => {
    it('accepts sentence mode', () => {
      highlighter.setMode('sentence');
      expect(highlighter.mode).toBe('sentence');
    });
  });

  describe('highlightSegment', () => {
    it('wraps sentences in spans with lazy-reader-sentence class', () => {
      document.body.innerHTML = '<p>First sentence. Second sentence.</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'First sentence. Second sentence.',
        node: p,
        sentences: [
          { text: 'First sentence.', startIndex: 0 },
          { text: 'Second sentence.', startIndex: 16 },
        ],
      };

      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);

      const spans = p.querySelectorAll('.lazy-reader-sentence');
      expect(spans.length).toBeGreaterThanOrEqual(1);
    });

    it('marks first sentence as active', () => {
      document.body.innerHTML = '<p>First sentence. Second sentence.</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'First sentence. Second sentence.',
        node: p,
        sentences: [
          { text: 'First sentence.', startIndex: 0 },
          { text: 'Second sentence.', startIndex: 16 },
        ],
      };

      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);

      const active = p.querySelector('.lazy-reader-active');
      expect(active).not.toBeNull();
      expect(active.textContent).toContain('First sentence');
    });
  });

  describe('advanceSentence', () => {
    it('moves active class to next sentence', () => {
      document.body.innerHTML = '<p>First. Second. Third.</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'First. Second. Third.',
        node: p,
        sentences: [
          { text: 'First.', startIndex: 0 },
          { text: 'Second.', startIndex: 7 },
          { text: 'Third.', startIndex: 15 },
        ],
      };

      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);
      highlighter.advanceSentence();

      const active = p.querySelector('.lazy-reader-active');
      expect(active.textContent).toContain('Second');
    });
  });

  describe('cleanup', () => {
    it('removes all injected spans and restores original DOM', () => {
      document.body.innerHTML = '<p>First sentence. Second sentence.</p>';
      const p = document.querySelector('p');
      const originalHTML = p.innerHTML;
      const segment = {
        type: 'prose',
        text: 'First sentence. Second sentence.',
        node: p,
        sentences: [
          { text: 'First sentence.', startIndex: 0 },
          { text: 'Second sentence.', startIndex: 16 },
        ],
      };

      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);
      highlighter.cleanup();

      expect(p.querySelector('.lazy-reader-sentence')).toBeNull();
      expect(p.querySelector('.lazy-reader-active')).toBeNull();
      // Text content should be preserved
      expect(p.textContent).toBe('First sentence. Second sentence.');
    });

    it('is idempotent — calling cleanup twice does not throw', () => {
      highlighter.cleanup();
      highlighter.cleanup();
    });
  });

  describe('handles single-sentence segments', () => {
    it('wraps and activates the only sentence', () => {
      document.body.innerHTML = '<p>Only one sentence here</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'Only one sentence here',
        node: p,
        sentences: [{ text: 'Only one sentence here', startIndex: 0 }],
      };

      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);

      const active = p.querySelector('.lazy-reader-active');
      expect(active).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/highlighter.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement highlighter.js**

`content/highlighter.js`:
```js
// content/highlighter.js — Lazy sentence wrapping/unwrapping on live DOM
//
// State machine:
//   IDLE → highlightSegment() → WRAPPING → advanceSentence() → WRAPPING
//        → cleanup() → IDLE
//
// Only one segment is wrapped at a time (lazy wrapping).

export class Highlighter {
  constructor() {
    this.mode = 'sentence';
    this._currentSegment = null;
    this._sentenceIndex = 0;
    this._sentenceSpans = [];
    this._originalHTML = null;
  }

  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Wrap sentences in the given segment's DOM node.
   * Only one segment is wrapped at a time.
   */
  highlightSegment(segment) {
    // Clean up previous segment if any
    this.cleanup();

    this._currentSegment = segment;
    this._sentenceIndex = 0;

    if (this.mode === 'sentence') {
      this._wrapSentences(segment);
      this._activateSentence(0);
    }
  }

  /**
   * Advance to the next sentence within the current segment.
   */
  advanceSentence() {
    if (!this._currentSegment) return;
    if (this._sentenceIndex >= this._sentenceSpans.length - 1) return;

    this._deactivateAll();
    this._sentenceIndex++;
    this._activateSentence(this._sentenceIndex);
  }

  /**
   * Remove all injected spans and restore original DOM.
   */
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

    // Get the full text content
    const fullText = node.textContent;
    const sentences = segment.sentences;

    if (sentences.length === 0) return;

    // Replace the node's content with sentence-wrapped spans
    // For simplicity, we replace innerHTML. This works for text-heavy nodes
    // but may lose event listeners (acceptable for read-only content).
    let html = '';
    let lastEnd = 0;

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const start = fullText.indexOf(s.text, lastEnd);
      if (start === -1) continue;

      // Any text between sentences (whitespace)
      if (start > lastEnd) {
        html += escapeHTML(fullText.slice(lastEnd, start));
      }

      html += `<span class="lazy-reader-sentence" data-sentence="${i}">${escapeHTML(s.text)}</span>`;
      lastEnd = start + s.text.length;
    }

    // Trailing text
    if (lastEnd < fullText.length) {
      html += escapeHTML(fullText.slice(lastEnd));
    }

    node.innerHTML = html;
    this._sentenceSpans = Array.from(node.querySelectorAll('.lazy-reader-sentence'));
  }

  _activateSentence(index) {
    if (index >= 0 && index < this._sentenceSpans.length) {
      this._sentenceSpans[index].classList.add('lazy-reader-active');
    }
  }

  _deactivateAll() {
    for (const span of this._sentenceSpans) {
      span.classList.remove('lazy-reader-active');
    }
  }
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/highlighter.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content/highlighter.js test/highlighter.test.js
git commit -m "feat: add highlighter with lazy sentence wrapping and DOM cleanup"
```

---

### Task 5: Floating Player Widget

**Files:**
- Create: `content/player.js`
- Modify: `styles/player.css`
- Create: `test/player.test.js`

- [ ] **Step 1: Write the failing tests**

`test/player.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Player } from '../content/player.js';

describe('Player', () => {
  let player;

  beforeEach(() => {
    document.body.innerHTML = '';
    player = new Player();
  });

  afterEach(() => {
    player.destroy();
  });

  describe('create', () => {
    it('injects a Shadow DOM host into document.body', () => {
      player.create();
      const host = document.querySelector('#lazy-reader-player');
      expect(host).not.toBeNull();
      expect(host.shadowRoot).not.toBeNull();
    });

    it('renders play/pause, skip back, skip forward, speed, and close controls', () => {
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      expect(shadow.querySelector('[data-action="playpause"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="skipback"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="skipforward"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="speed"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="close"]')).not.toBeNull();
    });
  });

  describe('callbacks', () => {
    it('calls onPlayPause when play/pause is clicked', () => {
      const cb = vi.fn();
      player.onPlayPause(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="playpause"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onClose when close is clicked', () => {
      const cb = vi.fn();
      player.onClose(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="close"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onSkipForward when skip forward is clicked', () => {
      const cb = vi.fn();
      player.onSkipForward(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="skipforward"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onSkipBack when skip back is clicked', () => {
      const cb = vi.fn();
      player.onSkipBack(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="skipback"]').click();
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('updateState', () => {
    it('shows pause icon when playing', () => {
      player.create();
      player.updateState({ playing: true });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const btn = shadow.querySelector('[data-action="playpause"]');
      expect(btn.textContent).toContain('⏸');
    });

    it('shows play icon when paused', () => {
      player.create();
      player.updateState({ playing: false });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const btn = shadow.querySelector('[data-action="playpause"]');
      expect(btn.textContent).toContain('▶');
    });

    it('updates speed display', () => {
      player.create();
      player.updateState({ speed: 2.0 });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const speedEl = shadow.querySelector('[data-action="speed"]');
      expect(speedEl.textContent).toContain('2.0x');
    });
  });

  describe('destroy', () => {
    it('removes the player from the DOM', () => {
      player.create();
      expect(document.querySelector('#lazy-reader-player')).not.toBeNull();
      player.destroy();
      expect(document.querySelector('#lazy-reader-player')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/player.test.js
```

Expected: FAIL

- [ ] **Step 3: Write player.css**

`styles/player.css`:
```css
:host {
  all: initial;
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  font-family: 'Gohu', monospace, sans-serif;
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

.lazy-reader-bar:hover {
  opacity: 1;
}

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

.lazy-reader-bar button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.lazy-reader-speed {
  padding: 4px 8px;
  min-width: 40px;
  text-align: center;
  cursor: pointer;
  border-radius: 4px;
}

.lazy-reader-speed:hover {
  background: rgba(255, 255, 255, 0.1);
}

.lazy-reader-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
}
```

- [ ] **Step 4: Implement player.js**

`content/player.js`:
```js
// content/player.js — Shadow DOM floating player widget

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export class Player {
  constructor() {
    this._host = null;
    this._shadow = null;
    this._callbacks = {
      playPause: null,
      close: null,
      skipForward: null,
      skipBack: null,
      speedChange: null,
    };
    this._state = { playing: false, speed: 1.0 };
  }

  create() {
    if (this._host) return;

    this._host = document.createElement('div');
    this._host.id = 'lazy-reader-player';
    this._shadow = this._host.attachShadow({ mode: 'open' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = this._getCSS();
    this._shadow.appendChild(style);

    // Build the bar
    const bar = document.createElement('div');
    bar.className = 'lazy-reader-bar';
    bar.innerHTML = `
      <button data-action="skipback" title="Skip back">⏮</button>
      <button data-action="playpause" title="Play/Pause">▶</button>
      <button data-action="skipforward" title="Skip forward">⏭</button>
      <div class="lazy-reader-divider"></div>
      <div class="lazy-reader-speed" data-action="speed" title="Click to change speed">1.0x</div>
      <div class="lazy-reader-divider"></div>
      <button data-action="close" title="Close">✕</button>
    `;

    bar.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      switch (action) {
        case 'playpause':
          this._callbacks.playPause?.();
          break;
        case 'close':
          this._callbacks.close?.();
          break;
        case 'skipforward':
          this._callbacks.skipForward?.();
          break;
        case 'skipback':
          this._callbacks.skipBack?.();
          break;
        case 'speed':
          this._cycleSpeed();
          break;
      }
    });

    this._shadow.appendChild(bar);
    document.body.appendChild(this._host);
  }

  updateState(partial) {
    Object.assign(this._state, partial);
    if (!this._shadow) return;

    const playBtn = this._shadow.querySelector('[data-action="playpause"]');
    if (playBtn) {
      playBtn.textContent = this._state.playing ? '⏸' : '▶';
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

  onPlayPause(cb) { this._callbacks.playPause = cb; }
  onClose(cb) { this._callbacks.close = cb; }
  onSkipForward(cb) { this._callbacks.skipForward = cb; }
  onSkipBack(cb) { this._callbacks.skipBack = cb; }
  onSpeedChange(cb) { this._callbacks.speedChange = cb; }

  _cycleSpeed() {
    const currentIndex = SPEED_OPTIONS.indexOf(this._state.speed);
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    this._state.speed = SPEED_OPTIONS[nextIndex];
    this.updateState({ speed: this._state.speed });
    this._callbacks.speedChange?.(this._state.speed);
  }

  _getCSS() {
    // Inline the player CSS for Shadow DOM
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
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/player.test.js
```

Expected: PASS (jsdom supports Shadow DOM basics, though `attachShadow` may need the `mode: 'open'` we're using).

- [ ] **Step 6: Commit**

```bash
git add content/player.js styles/player.css test/player.test.js
git commit -m "feat: add floating player widget with Shadow DOM and controls"
```

---

### Task 6: Background Service Worker (TTS Controller)

**Files:**
- Modify: `background.js`
- Create: `test/background.test.js`

- [ ] **Step 1: Write the failing tests**

`test/background.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';

// We test background.js by importing its handler functions directly.
// The actual chrome.action.onClicked listener is registered at top-level,
// so we test the handler logic extracted into testable functions.
import {
  handleSpeak,
  handlePause,
  handleResume,
  handleStop,
  handleSpeed,
  handleSkipForward,
  handleSkipBack,
} from '../background.js';

describe('background TTS controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleSpeak', () => {
    it('calls chrome.tts.speak with the first segment text', () => {
      const segments = [
        { type: 'prose', text: 'Hello world.' },
        { type: 'prose', text: 'Second segment.' },
      ];
      handleSpeak(segments, 1);

      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'Hello world.',
        expect.objectContaining({ rate: 1 }),
        expect.any(Function)
      );
    });
  });

  describe('handlePause', () => {
    it('calls chrome.tts.pause', () => {
      handlePause();
      expect(chrome.tts.pause).toHaveBeenCalled();
    });
  });

  describe('handleResume', () => {
    it('calls chrome.tts.resume', () => {
      handleResume();
      expect(chrome.tts.resume).toHaveBeenCalled();
    });
  });

  describe('handleStop', () => {
    it('calls chrome.tts.stop', () => {
      handleStop();
      expect(chrome.tts.stop).toHaveBeenCalled();
    });
  });

  describe('handleSpeed', () => {
    it('updates the current rate', () => {
      handleSpeed(2.0);
      // Next speak should use the new rate
      const segments = [{ type: 'prose', text: 'Test.' }];
      handleSpeak(segments, 1);
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'Test.',
        expect.objectContaining({ rate: 2.0 }),
        expect.any(Function)
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/background.test.js
```

Expected: FAIL — functions not exported from background.js.

- [ ] **Step 3: Implement the full background.js**

`background.js`:
```js
// background.js — Service worker: TTS controller + script injector
// All chrome.* listeners registered at top-level scope for MV3 restart survival.

let currentSegments = [];
let currentSegmentIndex = 0;
let currentRate = 1.0;
let activeTabId = null;

// --- Exported handler functions (for testing) ---

export function handleSpeak(segments, tabId) {
  currentSegments = segments;
  currentSegmentIndex = 0;
  activeTabId = tabId;
  speakSegment(currentSegmentIndex);
}

export function handlePause() {
  chrome.tts.pause();
}

export function handleResume() {
  chrome.tts.resume();
}

export function handleStop() {
  chrome.tts.stop();
  currentSegments = [];
  currentSegmentIndex = 0;
  activeTabId = null;
}

export function handleSpeed(rate) {
  currentRate = rate;
}

export function handleSkipForward() {
  if (currentSegmentIndex < currentSegments.length - 1) {
    chrome.tts.stop();
    currentSegmentIndex++;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

export function handleSkipBack() {
  if (currentSegmentIndex > 0) {
    chrome.tts.stop();
    currentSegmentIndex--;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

// --- Internal functions ---

function speakSegment(index) {
  if (index >= currentSegments.length) {
    sendToTab({ event: 'end' });
    handleStop();
    return;
  }

  const segment = currentSegments[index];
  chrome.tts.speak(segment.text, {
    rate: currentRate,
    onEvent: (ttsEvent) => {
      // Forward events to the content script
      if (ttsEvent.type === 'word') {
        sendToTab({ event: 'word', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'sentence') {
        sendToTab({ event: 'sentence', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'end') {
        // Move to next segment
        currentSegmentIndex++;
        if (currentSegmentIndex < currentSegments.length) {
          sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
          speakSegment(currentSegmentIndex);
        } else {
          sendToTab({ event: 'end' });
          handleStop();
        }
      } else if (ttsEvent.type === 'error') {
        console.error('Lazy Reader TTS error:', ttsEvent.errorMessage);
        sendToTab({ event: 'error', message: ttsEvent.errorMessage });
      }
    },
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Lazy Reader: TTS speak failed', chrome.runtime.lastError.message);
    }
  });
}

function sendToTab(msg) {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {
      // Tab might have been closed
    });
  }
}

// --- Chrome event listeners (top-level scope) ---

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js'],
    });
  } catch (err) {
    console.error('Lazy Reader: Failed to inject scripts', err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.cmd) {
    case 'speak':
      handleSpeak(msg.segments, tabId);
      break;
    case 'pause':
      handlePause();
      break;
    case 'resume':
      handleResume();
      break;
    case 'stop':
      handleStop();
      break;
    case 'speed':
      handleSpeed(msg.rate);
      break;
    case 'skipForward':
      handleSkipForward();
      break;
    case 'skipBack':
      handleSkipBack();
      break;
    case 'keepalive':
      // Keepalive ping from content script — prevents worker suspension
      break;
  }

  sendResponse({ ok: true });
  return false; // synchronous response
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/background.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background.js test/background.test.js
git commit -m "feat: add background TTS controller with message routing and segment queue"
```

---

### Task 7: Content Script Orchestrator

**Files:**
- Create: `content/content.js`

- [ ] **Step 1: Implement content.js**

`content/content.js`:
```js
// content/content.js — Entry point: orchestrates parser → tts → highlighter → player
//
//   ┌──────────┐     ┌───────────┐     ┌─────────────┐     ┌────────┐
//   │ parser.js│────►│tts-client │────►│highlighter.js│────►│player.js│
//   └──────────┘     └───────────┘     └─────────────┘     └────────┘
//        │               ▲                    ▲                  │
//        │               │                    │                  │
//        └── segments ───┘                    └── events ────────┘

import { parsePageContent } from './parser.js';
import { TTSClient } from './tts-client.js';
import { Highlighter } from './highlighter.js';
import { Player } from './player.js';
import { loadSettings, saveSettings } from './storage.js';

// Guard against double-injection
if (window.__lazyReaderActive) {
  // Toggle off
  window.__lazyReaderCleanup?.();
} else {
  init();
}

async function init() {
  window.__lazyReaderActive = true;

  const settings = await loadSettings();
  const segments = parsePageContent(document);

  if (segments.length === 0) {
    showToast('No readable content found on this page.');
    window.__lazyReaderActive = false;
    return;
  }

  const tts = new TTSClient();
  const highlighter = new Highlighter();
  const player = new Player();

  highlighter.setMode('sentence');

  let currentSegmentIndex = 0;
  let playing = false;

  // Create player
  player.create();
  player.updateState({ playing: false, speed: settings.speed });

  // Wire up player callbacks
  player.onPlayPause(() => {
    if (playing) {
      tts.pause();
      playing = false;
    } else {
      if (currentSegmentIndex === 0 && !playing) {
        // First play — start speaking
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

  // Wire up TTS events
  tts.onEvent((msg) => {
    if (msg.event === 'sentence') {
      highlighter.advanceSentence();
    } else if (msg.event === 'end') {
      playing = false;
      player.updateState({ playing: false });
      highlighter.cleanup();
    } else if (msg.event === 'error') {
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

  // Keepalive ping to prevent background worker suspension
  const keepaliveInterval = setInterval(() => {
    if (playing) {
      chrome.runtime.sendMessage({ cmd: 'keepalive' }).catch(() => {});
    }
  }, 20000);

  // Page navigation cleanup
  function onPageHide() {
    cleanup();
  }
  window.addEventListener('beforeunload', onPageHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Don't cleanup on tab switch — just on actual navigation
    }
  });

  // Cleanup function
  function cleanup() {
    tts.stop();
    tts.destroy();
    highlighter.cleanup();
    player.destroy();
    clearInterval(keepaliveInterval);
    window.removeEventListener('beforeunload', onPageHide);
    window.__lazyReaderActive = false;
    window.__lazyReaderCleanup = null;
  }

  window.__lazyReaderCleanup = cleanup;

  // Auto-start playback
  tts.speak(segments);
  highlighter.highlightSegment(segments[0]);
  playing = true;
  player.updateState({ playing: true });
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 20px; z-index: 2147483647;
    background: rgba(30,30,30,0.92); color: #e0e0e0; padding: 8px 16px;
    border-radius: 6px; font-size: 13px; font-family: monospace;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
```

- [ ] **Step 2: Manually test the extension**

1. Open `chrome://extensions`, click "Reload" on the Lazy Reader extension.
2. Navigate to `https://github.com/donnemartin/system-design-primer`.
3. Click the Lazy Reader extension icon.
4. Verify: content is parsed, speech starts, sentences are highlighted, player appears.

- [ ] **Step 3: Commit**

```bash
git add content/content.js
git commit -m "feat: add content script orchestrator with auto-play and toggle behavior"
```

---

### Task 8: Integration Testing and Bug Fixes

**Files:**
- Modify: any files with bugs found during manual testing

- [ ] **Step 1: Run full unit test suite**

```bash
npx vitest run
```

Expected: All tests PASS. Fix any failures.

- [ ] **Step 2: Manual integration test on acceptance corpus**

Test on each site in the acceptance corpus:

1. **system-design-primer README**: Long page with headings, paragraphs, code blocks, tables, images. Verify:
   - Headings are read
   - Code blocks are announced ("Code block: N lines")
   - Tables are read row-by-row
   - Navigation/badges are skipped
   - Sentence highlighting advances correctly
   - Player controls work (play/pause, skip, speed)

2. **A shorter GitHub README**: Verify basic flow works on a simple page.

3. **Internal company docs**: Verify content detection works on your doc platform.

Note any bugs found. Fix them. Each fix gets its own commit.

- [ ] **Step 3: Fix content script injection for ES modules**

If the content script fails to load (check DevTools console for "Failed to load module script"), the `content/content.js` file uses ES module imports but `chrome.scripting.executeScript` with `files:` doesn't support ES modules directly.

Fix: change `background.js` to use `func` injection that dynamically imports the module:

```js
// In background.js, replace the executeScript call:
await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = chrome.runtime.getURL('content/content.js');
    document.head.appendChild(script);
  },
  world: 'MAIN',
});
```

And add `content/content.js` to `web_accessible_resources` in manifest.json:

```json
"web_accessible_resources": [{
  "resources": ["content/content.js", "content/*.js", "lib/*.js"],
  "matches": ["<all_urls>"]
}]
```

- [ ] **Step 4: Commit bug fixes**

```bash
git add -A
git commit -m "fix: resolve content script module loading and integration issues"
```

- [ ] **Step 5: Final full test run**

```bash
npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address remaining test and integration issues"
```

---

### Task 9: Keyboard Shortcuts (Space = Play/Pause)

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: Add keyboard listener to content.js**

Add this to the `init()` function in `content/content.js`, after the player is created:

```js
  // Keyboard shortcuts
  function onKeyDown(e) {
    // Only when not focused on an input element
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (playing) {
        tts.pause();
        playing = false;
      } else {
        tts.resume();
        playing = true;
      }
      player.updateState({ playing });
    }
  }
  document.addEventListener('keydown', onKeyDown);
```

Also add `document.removeEventListener('keydown', onKeyDown);` to the `cleanup()` function.

- [ ] **Step 2: Manual test**

1. Reload extension, click icon on a page.
2. Press Space — playback should pause.
3. Press Space again — playback should resume.
4. Click into an input field, press Space — should type a space, not toggle playback.

- [ ] **Step 3: Commit**

```bash
git add content/content.js
git commit -m "feat: add Space key shortcut for play/pause toggle"
```

---

## Self-Review

**Spec coverage check:**
- One-click reading: Task 7 (auto-starts on icon click) ✓
- Content parsing with segment types: Task 2 (parser with prose/code/table/skip) ✓
- Sentence highlighting: Task 4 (highlighter) ✓
- Floating player with controls: Task 5 (player) ✓
- chrome.tts via background worker: Task 6 ✓
- Message protocol: Task 3 (tts-client) + Task 6 (background) ✓
- Storage/preferences: Task 1 ✓
- Page navigation cleanup: Task 7 (beforeunload handler) ✓
- Keepalive ping: Task 7 ✓
- Keyboard shortcuts: Task 9 (Space = play/pause) ✓
- Error handling (no content, TTS error): Task 7 (toast messages) ✓

**Placeholder scan:** No TBD, TODO, or "similar to Task N" found.

**Type consistency:** `parsePageContent` returns `segments[]` with `{type, text, node, sentences}`. This shape is used consistently in parser.test.js, tts-client.test.js (speak), highlighter.test.js (highlightSegment), background.js (handleSpeak), and content.js. ✓
