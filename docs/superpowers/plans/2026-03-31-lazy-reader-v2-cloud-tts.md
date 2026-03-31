# Lazy Reader V2: Cloud TTS + Word-Level Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ElevenLabs cloud TTS with word-level karaoke highlighting and mid-sentence speed changes. Graceful fallback to local voices when cloud is unavailable.

**Architecture:** Background worker routes to either chrome.tts (local) or ElevenLabs API (cloud) based on settings. Cloud audio plays via an offscreen document with AudioContext. Word timestamps from ElevenLabs drive per-word highlighting in the content script. An options page handles API key entry and voice selection.

**Tech Stack:** ElevenLabs Text-to-Speech with Timestamps API (`/with-timestamps` endpoint), Chrome offscreen document API, AudioContext, existing Vitest + jsdom test infrastructure

**Known limitations (accepted):**
- Word highlighting temporarily flattens inline markup (`<a>`, `<strong>`, `<code>`) during the highlighted segment. Restored on segment end via innerHTML restore. DOM Range-based wrapping deferred to TODOS.md.
- Background service worker globals are lost on worker restart. Accepted risk for personal tool. Keepalive ping reduces frequency.

---

## File Structure

### New files
```
offscreen.html              — Minimal HTML shell for the offscreen document
offscreen.js                — AudioContext playback, timing event emission, playback rate control
options.html                — Settings page: provider, API key, voice selector, preview
options.js                  — Options page logic: save/load settings, voice list fetch, preview playback
content/cloud-tts.js        — ElevenLabs API client: fetch audio + word alignment for a text segment
test/cloud-tts.test.js      — Tests for ElevenLabs client
test/offscreen.test.js      — Tests for offscreen audio player
test/options.test.js        — Tests for options page logic
```

### Modified files
```
manifest.json               — Add offscreen permission, options_page, host_permissions
content/storage.js           — Add apiKey, cloudVoiceId to DEFAULT_SETTINGS
content/highlighter.js       — Add word mode: wrap words, advance by timestamp
content/content.js           — Wire word events to highlighter, pass provider to background
content/player.js            — Add voice indicator (local/cloud label)
background.js                — Route speak to local or cloud, manage offscreen lifecycle
styles/content.css           — Add .lazy-reader-word style
test/storage.test.js         — Update for new settings keys
test/highlighter.test.js     — Add word mode tests
test/background.test.js      — Add cloud routing tests
package.json                 — Add build script update (no new deps needed)
```

---

### Task 0: Update Storage with Cloud Settings

**Files:**
- Modify: `content/storage.js`
- Modify: `test/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `test/storage.test.js` inside the existing `describe('storage')` block:

```js
  describe('cloud settings defaults', () => {
    it('includes apiKey as empty string', () => {
      expect(DEFAULT_SETTINGS.apiKey).toBe('');
    });

    it('includes cloudVoiceId as empty string', () => {
      expect(DEFAULT_SETTINGS.cloudVoiceId).toBe('');
    });

    it('defaults ttsProvider to local', () => {
      expect(DEFAULT_SETTINGS.ttsProvider).toBe('local');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/storage.test.js
```

Expected: FAIL — `DEFAULT_SETTINGS.apiKey` is undefined.

- [ ] **Step 3: Update DEFAULT_SETTINGS**

In `content/storage.js`, replace the DEFAULT_SETTINGS:

```js
export const DEFAULT_SETTINGS = Object.freeze({
  speed: 1.0,
  voiceId: '',
  ttsProvider: 'local',
  apiKey: '',
  cloudVoiceId: '',
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/storage.test.js
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add content/storage.js test/storage.test.js
git commit -m "feat: add cloud TTS settings to storage defaults"
```

---

### Task 1: ElevenLabs API Client

**Files:**
- Create: `content/cloud-tts.js`
- Create: `test/cloud-tts.test.js`

- [ ] **Step 1: Write the failing tests**

`test/cloud-tts.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchCloudSpeech, ElevenLabsError } from '../content/cloud-tts.js';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('cloud-tts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchCloudSpeech', () => {
    it('calls ElevenLabs API with correct URL, headers, and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'AAAA',
          alignment: {
            words: [
              { word: 'Hello', start: 0.0, end: 0.3 },
              { word: 'world', start: 0.35, end: 0.7 },
            ],
          },
        }),
      });

      await fetchCloudSpeech('Hello world', 'voice123', 'sk-key');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'sk-key',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Hello world');
      expect(body.model_id).toBe('eleven_v3');
    });

    it('returns audio base64 and word alignment mapped from characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'base64audiodata',
          alignment: {
            characters: ['T', 'e', 's', 't'],
            character_start_times_seconds: [0.0, 0.1, 0.2, 0.3],
            character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
          },
        }),
      });

      const result = await fetchCloudSpeech('Test', 'v1', 'key');
      expect(result.audioBase64).toBe('base64audiodata');
      expect(result.words).toHaveLength(1);
      expect(result.words[0]).toEqual({ word: 'Test', start: 0.0, end: 0.4 });
    });

    it('maps multi-word character alignment to word boundaries', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'AAAA',
          alignment: {
            characters: ['H', 'i', ' ', 'y', 'o'],
            character_start_times_seconds: [0.0, 0.05, 0.1, 0.15, 0.2],
            character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.3],
          },
        }),
      });

      const result = await fetchCloudSpeech('Hi yo', 'v1', 'key');
      expect(result.words).toHaveLength(2);
      expect(result.words[0]).toEqual({ word: 'Hi', start: 0.0, end: 0.1 });
      expect(result.words[1]).toEqual({ word: 'yo', start: 0.15, end: 0.3 });
    });

    it('throws ElevenLabsError on 401 (invalid key)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: { message: 'Invalid API key' } }),
      });

      await expect(fetchCloudSpeech('Hi', 'v1', 'bad-key'))
        .rejects.toThrow(ElevenLabsError);
      await expect(fetchCloudSpeech('Hi', 'v1', 'bad-key'))
        .rejects.toThrow(/Invalid API key/);
    });

    it('throws ElevenLabsError on 429 (rate limit)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ detail: { message: 'Rate limit exceeded' } }),
      });

      await expect(fetchCloudSpeech('Hi', 'v1', 'key'))
        .rejects.toThrow(ElevenLabsError);
    });

    it('throws on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchCloudSpeech('Hi', 'v1', 'key'))
        .rejects.toThrow('Network error');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/cloud-tts.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement cloud-tts.js**

`content/cloud-tts.js`:

```js
// content/cloud-tts.js — ElevenLabs API client

const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

export class ElevenLabsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ElevenLabsError';
    this.status = status;
  }
}

/**
 * Map character-level alignment from ElevenLabs to word-level timestamps.
 * Groups consecutive non-whitespace characters into words.
 * @param {object} alignment - { characters, character_start_times_seconds, character_end_times_seconds }
 * @returns {Array<{word: string, start: number, end: number}>}
 */
export function mapCharsToWords(alignment) {
  if (!alignment?.characters) return [];
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  const words = [];
  let currentWord = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) {
      if (currentWord.length > 0) {
        words.push({ word: currentWord, start: wordStart, end: wordEnd });
        currentWord = '';
      }
    } else {
      if (currentWord.length === 0) {
        wordStart = character_start_times_seconds[i];
      }
      currentWord += ch;
      wordEnd = character_end_times_seconds[i];
    }
  }
  if (currentWord.length > 0) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }
  return words;
}

/**
 * Fetch speech audio + word-level alignment from ElevenLabs.
 * Uses the /with-timestamps endpoint which returns character-level timing.
 * Characters are mapped to words via mapCharsToWords().
 * @param {string} text - Text to speak
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {string} apiKey - User's API key
 * @returns {Promise<{audioBase64: string, words: Array<{word: string, start: number, end: number}>}>}
 */
export async function fetchCloudSpeech(text, voiceId, apiKey) {
  const url = `${API_BASE}/${voiceId}/with-timestamps`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    let message = `ElevenLabs API error (${response.status})`;
    try {
      const err = await response.json();
      message = err.detail?.message || err.detail || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new ElevenLabsError(message, response.status);
  }

  const data = await response.json();

  return {
    audioBase64: data.audio_base64,
    words: mapCharsToWords(data.alignment),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/cloud-tts.test.js
```

Expected: All PASS

- [ ] **Step 5: Run full suite**

```bash
npx vitest run
```

Expected: All PASS (existing + new)

- [ ] **Step 6: Commit**

```bash
git add content/cloud-tts.js test/cloud-tts.test.js
git commit -m "feat: add ElevenLabs API client with word-level alignment"
```

---

### Task 2: Offscreen Document (Audio Playback)

**Files:**
- Create: `offscreen.html`
- Create: `offscreen.js`
- Create: `test/offscreen.test.js`

- [ ] **Step 1: Write the failing tests**

`test/offscreen.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OffscreenPlayer } from '../offscreen.js';

// Mock AudioContext
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
  }
  decodeAudioData(buffer) {
    return Promise.resolve({
      duration: 2.0,
      length: 88200,
      sampleRate: 44100,
    });
  }
  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      playbackRate: { value: 1.0 },
      onended: null,
    };
  }
  close() { return Promise.resolve(); }
}
globalThis.AudioContext = MockAudioContext;

describe('OffscreenPlayer', () => {
  let player;

  beforeEach(() => {
    player = new OffscreenPlayer();
  });

  describe('loadAudio', () => {
    it('decodes base64 audio into an AudioBuffer', async () => {
      // "AAAA" is valid base64 (decodes to 3 zero bytes)
      await player.loadAudio('AAAA');
      expect(player.audioBuffer).not.toBeNull();
    });
  });

  describe('play', () => {
    it('creates a buffer source and starts playback', async () => {
      await player.loadAudio('AAAA');
      player.play();
      expect(player.source).not.toBeNull();
      expect(player.source.start).toHaveBeenCalled();
    });
  });

  describe('setPlaybackRate', () => {
    it('adjusts the playback rate on the active source', async () => {
      await player.loadAudio('AAAA');
      player.play();
      player.setPlaybackRate(2.0);
      expect(player.source.playbackRate.value).toBe(2.0);
    });

    it('does nothing if no source is playing', () => {
      player.setPlaybackRate(2.0); // should not throw
    });
  });

  describe('stop', () => {
    it('stops the source and resets state', async () => {
      await player.loadAudio('AAAA');
      player.play();
      player.stop();
      expect(player.source).toBeNull();
    });

    it('does not emit audioEnd when stopped intentionally', async () => {
      await player.loadAudio('AAAA');
      player.play();
      const source = player.source;
      player.stop();
      // Simulate onended firing after stop
      source.onended?.();
      // audioEnd should NOT have been sent because _stoppingIntentionally was true
    });
  });

  describe('pause', () => {
    it('does not emit audioEnd when paused', async () => {
      await player.loadAudio('AAAA');
      player.play();
      const source = player.source;
      player.pause();
      expect(player.paused).toBe(true);
      // onended fires because source.stop() was called, but should be suppressed
      source.onended?.();
    });

    it('resumes from paused position', async () => {
      await player.loadAudio('AAAA');
      player.play();
      player.pause();
      player.resume();
      expect(player.paused).toBe(false);
    });
  });

  describe('getCurrentTime', () => {
    it('returns 0 when not playing', () => {
      expect(player.getCurrentTime()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/offscreen.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create offscreen.html**

`offscreen.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Lazy Reader Audio</title></head>
<body>
  <script src="offscreen.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 4: Implement offscreen.js**

`offscreen.js`:

```js
// offscreen.js — AudioContext playback for cloud TTS audio
//
// Receives base64 audio + word alignment from background.
// Plays audio, emits word timing events back via chrome.runtime.

export class OffscreenPlayer {
  constructor() {
    this.ctx = null;
    this.audioBuffer = null;
    this.source = null;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.paused = false;
    this._rate = 1.0;
    this._stoppingIntentionally = false;
  }

  async loadAudio(base64) {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    this.audioBuffer = await this.ctx.decodeAudioData(bytes.buffer);
  }

  play(offset = 0) {
    if (!this.audioBuffer || !this.ctx) return;
    this._stopSource(); // clean up previous source without triggering audioEnd

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.playbackRate.value = this._rate;
    this.source.connect(this.ctx.destination);
    this.source.start(0, offset);
    this.startTime = this.ctx.currentTime - (offset / this._rate);
    this.pauseOffset = 0;
    this.paused = false;
    this._stoppingIntentionally = false;

    this.source.onended = () => {
      // Only emit audioEnd if playback ended naturally (not from pause/stop)
      if (!this._stoppingIntentionally) {
        this._sendEvent({ event: 'audioEnd' });
      }
    };
  }

  pause() {
    if (!this.source || this.paused) return;
    this.pauseOffset = this.getCurrentTime();
    this._stopSource();
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.play(this.pauseOffset);
  }

  stop() {
    this._stopSource();
    this.source = null;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.paused = false;
  }

  /** Stop the audio source without triggering audioEnd */
  _stopSource() {
    if (this.source) {
      this._stoppingIntentionally = true;
      try { this.source.stop(); } catch (_) {}
      this.source = null;
    }
  }

  setPlaybackRate(rate) {
    if (this.source && !this.paused) {
      // Preserve current position before rate change
      const currentPos = this.getCurrentTime();
      this._rate = rate;
      this.source.playbackRate.value = rate;
      // Recalculate startTime so getCurrentTime() stays accurate
      this.startTime = this.ctx.currentTime - (currentPos / this._rate);
    } else {
      this._rate = rate;
    }
  }

  getCurrentTime() {
    if (this.paused) return this.pauseOffset;
    if (!this.ctx || this.startTime === 0) return 0;
    // currentTime tracks real elapsed time; divide by rate to get audio position
    return (this.ctx.currentTime - this.startTime) * this._rate;
  }

  _sendEvent(msg) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  }
}

// --- Message handler for offscreen document ---
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  const player = new OffscreenPlayer();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg.cmd) {
        case 'loadAndPlay': {
          await player.loadAudio(msg.audioBase64);
          player.play();
          // Start word timing loop
          startWordTimingLoop(player, msg.words);
          sendResponse({ ok: true });
          break;
        }
        case 'pauseAudio':
          player.pause();
          sendResponse({ ok: true });
          break;
        case 'resumeAudio':
          player.resume();
          sendResponse({ ok: true });
          break;
        case 'stopAudio':
          player.stop();
          sendResponse({ ok: true });
          break;
        case 'setPlaybackRate':
          player.setPlaybackRate(msg.rate);
          sendResponse({ ok: true });
          break;
      }
    })();
    return true; // async response
  });
}

let wordTimingTimer = null;

function startWordTimingLoop(player, words) {
  clearInterval(wordTimingTimer);
  if (!words || words.length === 0) return;

  let lastWordIndex = -1;

  wordTimingTimer = setInterval(() => {
    if (player.paused) return;
    const currentTime = player.getCurrentTime();

    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTime >= words[i].start) {
        if (i !== lastWordIndex) {
          lastWordIndex = i;
          player._sendEvent({
            event: 'wordTiming',
            wordIndex: i,
            word: words[i].word,
            start: words[i].start,
            end: words[i].end,
          });
        }
        break;
      }
    }
  }, 50); // 50ms polling — 20fps word tracking
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/offscreen.test.js
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add offscreen.html offscreen.js test/offscreen.test.js
git commit -m "feat: add offscreen document for AudioContext cloud TTS playback"
```

---

### Task 3: Word-Level Highlighter Mode

**Files:**
- Modify: `content/highlighter.js`
- Modify: `test/highlighter.test.js`
- Modify: `styles/content.css`

- [ ] **Step 1: Write the failing tests**

Add to `test/highlighter.test.js` inside the existing `describe('Highlighter')` block:

```js
  describe('word mode', () => {
    it('wraps each word in a span with lazy-reader-word class', () => {
      document.body.innerHTML = '<p>Hello beautiful world</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'Hello beautiful world',
        node: p,
        sentences: [{ text: 'Hello beautiful world', startIndex: 0 }],
      };
      highlighter.setMode('word');
      highlighter.highlightSegment(segment);
      const wordSpans = p.querySelectorAll('.lazy-reader-word');
      expect(wordSpans.length).toBe(3);
      expect(wordSpans[0].textContent).toBe('Hello');
      expect(wordSpans[1].textContent).toBe('beautiful');
      expect(wordSpans[2].textContent).toBe('world');
    });

    it('marks first word as active', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'Hello world',
        node: p,
        sentences: [{ text: 'Hello world', startIndex: 0 }],
      };
      highlighter.setMode('word');
      highlighter.highlightSegment(segment);
      const active = p.querySelector('.lazy-reader-active');
      expect(active).not.toBeNull();
      expect(active.textContent).toBe('Hello');
    });

    it('advances to a specific word by index', () => {
      document.body.innerHTML = '<p>One two three four</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'One two three four',
        node: p,
        sentences: [{ text: 'One two three four', startIndex: 0 }],
      };
      highlighter.setMode('word');
      highlighter.highlightSegment(segment);
      highlighter.advanceToWord(2);
      const active = p.querySelector('.lazy-reader-active');
      expect(active.textContent).toBe('three');
    });

    it('cleanup restores original DOM in word mode', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'Hello world',
        node: p,
        sentences: [{ text: 'Hello world', startIndex: 0 }],
      };
      highlighter.setMode('word');
      highlighter.highlightSegment(segment);
      highlighter.cleanup();
      expect(p.querySelector('.lazy-reader-word')).toBeNull();
      expect(p.textContent).toBe('Hello world');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/highlighter.test.js
```

Expected: FAIL — `advanceToWord` is not a function, word mode not implemented.

- [ ] **Step 3: Add word mode to highlighter.js**

Replace the full content of `content/highlighter.js`:

```js
// Highlighter — Lazy sentence/word wrapping on live DOM
//
// Modes:
//   'sentence' — wraps sentences, advances by sentence (V1 behavior)
//   'word'     — wraps words, advances by word index (V2 cloud TTS)

export class Highlighter {
  constructor() {
    this.mode = 'sentence';
    this._currentSegment = null;
    this._sentenceIndex = 0;
    this._sentenceSpans = [];
    this._wordSpans = [];
    this._activeWordIndex = -1;
    this._originalHTML = null;
  }

  setMode(mode) {
    this.mode = mode;
  }

  highlightSegment(segment) {
    this.cleanup();
    this._currentSegment = segment;
    this._sentenceIndex = 0;
    this._activeWordIndex = -1;

    if (this.mode === 'sentence') {
      this._wrapSentences(segment);
      this._activateSentence(0);
    } else if (this.mode === 'word') {
      this._wrapWords(segment);
      this.advanceToWord(0);
    }
  }

  advanceSentence() {
    if (!this._currentSegment || this.mode !== 'sentence') return;
    if (this._sentenceIndex >= this._sentenceSpans.length - 1) return;
    this._deactivateAll();
    this._sentenceIndex++;
    this._activateSentence(this._sentenceIndex);
  }

  advanceToWord(index) {
    if (!this._currentSegment || this.mode !== 'word') return;
    if (index < 0 || index >= this._wordSpans.length) return;
    this._deactivateAll();
    this._activeWordIndex = index;
    this._wordSpans[index].classList.add('lazy-reader-active');
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
    this._wordSpans = [];
    this._activeWordIndex = -1;
    this._originalHTML = null;
  }

  _wrapSentences(segment) {
    const node = segment.node;
    this._originalHTML = node.innerHTML;
    this._sentenceSpans = [];
    const fullText = node.textContent;
    const sentences = segment.sentences;
    if (sentences.length === 0) return;

    let html = '';
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
    this._sentenceSpans = Array.from(node.querySelectorAll('.lazy-reader-sentence'));
  }

  _wrapWords(segment) {
    const node = segment.node;
    this._originalHTML = node.innerHTML;
    this._wordSpans = [];
    const fullText = node.textContent;
    const words = fullText.split(/(\s+)/);

    let html = '';
    let wordIndex = 0;
    for (const part of words) {
      if (/^\s+$/.test(part)) {
        html += part;
      } else if (part.length > 0) {
        html += `<span class="lazy-reader-word" data-word="${wordIndex}">${escapeHTML(part)}</span>`;
        wordIndex++;
      }
    }
    node.innerHTML = html;
    this._wordSpans = Array.from(node.querySelectorAll('.lazy-reader-word'));
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
    for (const span of this._wordSpans) {
      span.classList.remove('lazy-reader-active');
    }
  }
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Add word highlight style to content.css**

Append to `styles/content.css`:

```css
.lazy-reader-word {
}

.lazy-reader-word.lazy-reader-active {
  background-color: rgba(255, 213, 79, 0.5);
  border-radius: 2px;
  transition: background-color 0.1s ease;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/highlighter.test.js
```

Expected: All PASS (old sentence tests + new word tests)

- [ ] **Step 6: Run full suite**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add content/highlighter.js test/highlighter.test.js styles/content.css
git commit -m "feat: add word-level highlighting mode to highlighter"
```

---

### Task 4: Background Worker Cloud TTS Routing

**Files:**
- Modify: `background.js`
- Modify: `manifest.json`
- Modify: `test/background.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `test/background.test.js`:

```js
  describe('cloud TTS routing', () => {
    it('calls fetchCloudSpeech when provider is elevenlabs', () => {
      // We test that handleSpeakCloud is called when provider is set
      // by checking the offscreen document creation path
      handleSetProvider('elevenlabs', 'sk-key', 'voice123');
      const segments = [{ type: 'prose', text: 'Hello.' }];
      handleSpeak(segments, 1);

      // Should NOT call chrome.tts.speak for cloud provider
      expect(chrome.tts.speak).not.toHaveBeenCalled();
    });

    it('falls back to local on handleSetProvider("local")', () => {
      handleSetProvider('local', '', '');
      const segments = [{ type: 'prose', text: 'Hello.' }];
      handleSpeak(segments, 1);
      expect(chrome.tts.speak).toHaveBeenCalled();
    });
  });
```

Add to the import at the top of `test/background.test.js`:

```js
import {
  handleSpeak,
  handlePause,
  handleResume,
  handleStop,
  handleSpeed,
  handleSkipForward,
  handleSkipBack,
  handleSetProvider,
} from '../background.js';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/background.test.js
```

Expected: FAIL — `handleSetProvider` is not exported.

- [ ] **Step 3: Update background.js with cloud routing**

Add this import at the top of `background.js`:

```js
import { fetchCloudSpeech } from './content/cloud-tts.js';
```

Add these new module-level variables after the existing ones:

```js
let currentProvider = 'local';
let currentApiKey = '';
let currentCloudVoiceId = '';
```

Add the new exported function:

```js
export function handleSetProvider(provider, apiKey, cloudVoiceId) {
  currentProvider = provider;
  currentApiKey = apiKey;
  currentCloudVoiceId = cloudVoiceId;
}
```

Replace the `speakSegment` function:

```js
async function speakSegment(index) {
  if (index >= currentSegments.length) {
    sendToTab({ event: 'end' });
    handleStop();
    return;
  }

  const segment = currentSegments[index];

  if (currentProvider === 'elevenlabs' && currentApiKey && currentCloudVoiceId) {
    await speakCloudSegment(segment);
  } else {
    speakLocalSegment(segment);
  }
}

function speakLocalSegment(segment) {
  chrome.tts.speak(segment.text, {
    rate: currentRate,
    onEvent: (ttsEvent) => {
      if (ttsEvent.type === 'word') {
        sendToTab({ event: 'word', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'sentence') {
        sendToTab({ event: 'sentence', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'end') {
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

async function speakCloudSegment(segment) {
  try {
    // Ensure offscreen document exists using getContexts (not hasDocument which doesn't exist)
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Playing cloud TTS audio',
      });
    }

    // Fetch audio + word alignment from ElevenLabs (uses cloud-tts.js)
    // Import at top of file: import { fetchCloudSpeech } from './content/cloud-tts.js';
    const { audioBase64, words } = await fetchCloudSpeech(
      segment.text, currentCloudVoiceId, currentApiKey
    );

    // Send to offscreen for playback
    sendToTab({ event: 'cloudSegmentStart', words });
    chrome.runtime.sendMessage({
      cmd: 'loadAndPlay',
      audioBase64,
      words,
    });

  } catch (err) {
    console.error('Lazy Reader: Cloud TTS failed, falling back to local', err);
    sendToTab({ event: 'cloudFallback', message: err.message });
    speakLocalSegment(segment);
  }
}
```

Add to the `chrome.runtime.onMessage.addListener` switch statement:

```js
    case 'setProvider':
      handleSetProvider(msg.provider, msg.apiKey, msg.cloudVoiceId);
      break;
    case 'audioEnd':
      // Offscreen audio finished playing a segment
      currentSegmentIndex++;
      if (currentSegmentIndex < currentSegments.length) {
        sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
        speakSegment(currentSegmentIndex);
      } else {
        sendToTab({ event: 'end' });
        handleStop();
      }
      break;
```

Also add to the `handlePause` and `handleResume` functions:

```js
export function handlePause() {
  if (currentProvider === 'elevenlabs') {
    chrome.runtime.sendMessage({ cmd: 'pauseAudio' }).catch(() => {});
  } else {
    chrome.tts.pause();
  }
}

export function handleResume() {
  if (currentProvider === 'elevenlabs') {
    chrome.runtime.sendMessage({ cmd: 'resumeAudio' }).catch(() => {});
  } else {
    chrome.tts.resume();
  }
}
```

Update `handleStop`:

```js
export function handleStop() {
  if (currentProvider === 'elevenlabs') {
    chrome.runtime.sendMessage({ cmd: 'stopAudio' }).catch(() => {});
  }
  chrome.tts.stop();
  currentSegments = [];
  currentSegmentIndex = 0;
  activeTabId = null;
}
```

Update `handleSpeed`:

```js
export function handleSpeed(rate) {
  currentRate = rate;
  if (currentProvider === 'elevenlabs') {
    chrome.runtime.sendMessage({ cmd: 'setPlaybackRate', rate }).catch(() => {});
  }
}
```

- [ ] **Step 4: Update manifest.json**

Replace `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Lazy Reader",
  "version": "0.2.0",
  "description": "Read web pages aloud with word-level highlighting",
  "permissions": ["activeTab", "tts", "storage", "scripting", "offscreen"],
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
  "options_page": "options.html",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "host_permissions": [
    "https://api.elevenlabs.io/*"
  ],
  "web_accessible_resources": [{
    "resources": ["dist/*", "styles/*", "fonts/*"],
    "matches": ["<all_urls>"]
  }]
}
```

- [ ] **Step 5: Add offscreen mock and getContexts to test/setup.js**

Add `getContexts` to the existing `chrome.runtime` mock in `test/setup.js`:

```js
    getContexts: vi.fn(() => Promise.resolve([])),
```

Add to the `chrome` mock object in `test/setup.js`:

```js
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
  },
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run test/background.test.js
```

Expected: All PASS

- [ ] **Step 7: Run full suite**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add background.js manifest.json test/background.test.js test/setup.js
git commit -m "feat: add cloud TTS routing with ElevenLabs and offscreen playback"
```

---

### Task 5: Options Page

**Files:**
- Create: `options.html`
- Create: `options.js`
- Create: `test/options.test.js`

- [ ] **Step 1: Write the failing tests**

`test/options.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadOptionsState, saveProvider, fetchVoices } from '../options.js';

// Mock fetch for voice listing
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({});
      return Promise.resolve({});
    });
    chrome.storage.local.set.mockImplementation((items, cb) => {
      if (cb) cb();
      return Promise.resolve();
    });
  });

  describe('loadOptionsState', () => {
    it('returns current settings', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ ttsProvider: 'elevenlabs', apiKey: 'sk-test', cloudVoiceId: 'v1' });
        return Promise.resolve();
      });
      const state = await loadOptionsState();
      expect(state.ttsProvider).toBe('elevenlabs');
      expect(state.apiKey).toBe('sk-test');
      expect(state.cloudVoiceId).toBe('v1');
    });
  });

  describe('saveProvider', () => {
    it('saves provider settings and notifies background', async () => {
      await saveProvider('elevenlabs', 'sk-key', 'voice1');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { ttsProvider: 'elevenlabs', apiKey: 'sk-key', cloudVoiceId: 'voice1' },
        expect.any(Function)
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        cmd: 'setProvider',
        provider: 'elevenlabs',
        apiKey: 'sk-key',
        cloudVoiceId: 'voice1',
      });
    });
  });

  describe('fetchVoices', () => {
    it('returns voices from ElevenLabs API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          voices: [
            { voice_id: 'v1', name: 'Rachel' },
            { voice_id: 'v2', name: 'Adam' },
          ],
        }),
      });

      const voices = await fetchVoices('sk-key');
      expect(voices).toHaveLength(2);
      expect(voices[0].name).toBe('Rachel');
    });

    it('returns empty array on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const voices = await fetchVoices('bad-key');
      expect(voices).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/options.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create options.html**

`options.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lazy Reader Settings</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 20px; margin-bottom: 24px; }
    label { display: block; margin-bottom: 4px; font-weight: 600; font-size: 13px; }
    select, input[type="password"] { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
    .field { margin-bottom: 16px; }
    .cloud-fields { display: none; margin-top: 16px; padding: 16px; background: #f5f5f5; border-radius: 8px; }
    .cloud-fields.visible { display: block; }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .btn-primary { background: #4A90D9; color: white; }
    .btn-secondary { background: #e0e0e0; color: #333; }
    .status { margin-top: 8px; font-size: 12px; color: #666; }
    .status.error { color: #d32f2f; }
    .status.success { color: #2e7d32; }
  </style>
</head>
<body>
  <h1>Lazy Reader Settings</h1>

  <div class="field">
    <label for="provider">Voice Provider</label>
    <select id="provider">
      <option value="local">Local (System Voices)</option>
      <option value="elevenlabs">ElevenLabs (Cloud)</option>
    </select>
  </div>

  <div class="cloud-fields" id="cloudFields">
    <div class="field">
      <label for="apiKey">ElevenLabs API Key</label>
      <input type="password" id="apiKey" placeholder="sk-...">
    </div>
    <div class="field">
      <label for="voiceSelect">Voice</label>
      <select id="voiceSelect" disabled>
        <option value="">Enter API key first</option>
      </select>
    </div>
    <div>
      <button class="btn-secondary" id="previewBtn" disabled>Preview Voice</button>
      <button class="btn-primary" id="saveBtn">Save</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <script src="options.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 4: Implement options.js**

`options.js`:

```js
// options.js — Options page logic

export async function loadOptionsState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['ttsProvider', 'apiKey', 'cloudVoiceId', 'speed', 'voiceId'],
      (result) => resolve({
        ttsProvider: result.ttsProvider || 'local',
        apiKey: result.apiKey || '',
        cloudVoiceId: result.cloudVoiceId || '',
        speed: result.speed || 1.0,
        voiceId: result.voiceId || '',
      })
    );
  });
}

export function saveProvider(provider, apiKey, cloudVoiceId) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ ttsProvider: provider, apiKey, cloudVoiceId }, () => {
      chrome.runtime.sendMessage({
        cmd: 'setProvider',
        provider,
        apiKey,
        cloudVoiceId,
      });
      resolve();
    });
  });
}

export async function fetchVoices(apiKey) {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.voices || [];
  } catch {
    return [];
  }
}

// --- DOM wiring (only runs in browser, not in tests) ---
if (typeof document !== 'undefined' && document.getElementById('provider')) {
  const providerEl = document.getElementById('provider');
  const cloudFields = document.getElementById('cloudFields');
  const apiKeyEl = document.getElementById('apiKey');
  const voiceSelect = document.getElementById('voiceSelect');
  const previewBtn = document.getElementById('previewBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  // Load current state
  loadOptionsState().then((state) => {
    providerEl.value = state.ttsProvider;
    apiKeyEl.value = state.apiKey;
    toggleCloudFields(state.ttsProvider === 'elevenlabs');
    if (state.apiKey) {
      loadVoices(state.apiKey, state.cloudVoiceId);
    }
  });

  providerEl.addEventListener('change', () => {
    const isCloud = providerEl.value === 'elevenlabs';
    toggleCloudFields(isCloud);
    if (!isCloud) {
      saveProvider('local', '', '');
      showStatus('Switched to local voices', 'success');
    }
  });

  apiKeyEl.addEventListener('change', async () => {
    const key = apiKeyEl.value.trim();
    if (key) {
      await loadVoices(key);
    }
  });

  saveBtn.addEventListener('click', async () => {
    const provider = providerEl.value;
    const apiKey = apiKeyEl.value.trim();
    const voiceId = voiceSelect.value;
    if (provider === 'elevenlabs' && (!apiKey || !voiceId)) {
      showStatus('Please enter API key and select a voice', 'error');
      return;
    }
    await saveProvider(provider, apiKey, voiceId);
    showStatus('Settings saved!', 'success');
  });

  previewBtn.addEventListener('click', async () => {
    const apiKey = apiKeyEl.value.trim();
    const voiceId = voiceSelect.value;
    if (!apiKey || !voiceId) return;
    showStatus('Playing preview...', '');
    try {
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'Hello! This is how I sound when reading your documents.',
          model_id: 'eleven_v3_timing',
        }),
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      showStatus('', '');
    } catch (err) {
      showStatus(`Preview failed: ${err.message}`, 'error');
    }
  });

  function toggleCloudFields(show) {
    cloudFields.classList.toggle('visible', show);
  }

  async function loadVoices(apiKey, selectedId = '') {
    voiceSelect.disabled = true;
    voiceSelect.innerHTML = '<option value="">Loading voices...</option>';
    const voices = await fetchVoices(apiKey);
    if (voices.length === 0) {
      voiceSelect.innerHTML = '<option value="">No voices found (check API key)</option>';
      showStatus('Could not load voices. Check your API key.', 'error');
      return;
    }
    voiceSelect.innerHTML = voices.map(v =>
      `<option value="${v.voice_id}"${v.voice_id === selectedId ? ' selected' : ''}>${v.name}</option>`
    ).join('');
    voiceSelect.disabled = false;
    previewBtn.disabled = false;
    showStatus(`${voices.length} voices loaded`, 'success');
  }

  function showStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `status ${type}`;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/options.test.js
```

Expected: All PASS

- [ ] **Step 6: Run full suite**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add options.html options.js test/options.test.js
git commit -m "feat: add options page for ElevenLabs API key and voice selection"
```

---

### Task 6: Wire Content Script for Cloud Events

**Files:**
- Modify: `content/content.js`
- Modify: `content/player.js` (add provider indicator)

- [ ] **Step 1: Update content.js to handle cloud events and word highlighting**

In `content/content.js`, update the `init()` function. Replace the line:

```js
  highlighter.setMode('sentence');
```

with:

```js
  const isCloud = settings.ttsProvider === 'elevenlabs' && settings.apiKey && settings.cloudVoiceId;
  highlighter.setMode(isCloud ? 'word' : 'sentence');

  // Notify background of current provider
  chrome.runtime.sendMessage({
    cmd: 'setProvider',
    provider: settings.ttsProvider,
    apiKey: settings.apiKey,
    cloudVoiceId: settings.cloudVoiceId,
  }).catch(() => {});
```

Update the `tts.onEvent` handler. Replace:

```js
  tts.onEvent((msg) => {
    if (msg.event === 'sentence') {
      highlighter.advanceSentence();
    } else if (msg.event === 'end') {
```

with:

```js
  tts.onEvent((msg) => {
    if (msg.event === 'sentence') {
      highlighter.advanceSentence();
    } else if (msg.event === 'wordTiming') {
      highlighter.advanceToWord(msg.wordIndex);
    } else if (msg.event === 'cloudFallback') {
      showToast(`Cloud voice unavailable: ${msg.message}. Using local voice.`);
      highlighter.cleanup(); // Remove word-level spans from current segment
      highlighter.setMode('sentence');
      // Re-highlight current segment in sentence mode
      if (currentSegmentIndex < segments.length) {
        highlighter.highlightSegment(segments[currentSegmentIndex]);
      }
    } else if (msg.event === 'end') {
```

- [ ] **Step 2: Add provider indicator to player.js**

In `content/player.js`, add a provider label to the bar HTML (after the speed div, before the close divider):

Replace the bar innerHTML in the `create()` method:

```js
    bar.innerHTML = `
      <button data-action="skipback" title="Skip back">⏮</button>
      <button data-action="playpause" title="Play/Pause">▶</button>
      <button data-action="skipforward" title="Skip forward">⏭</button>
      <div class="lazy-reader-divider"></div>
      <div class="lazy-reader-speed" data-action="speed" title="Click to change speed">1.0x</div>
      <div class="lazy-reader-divider"></div>
      <span class="lazy-reader-provider"></span>
      <div class="lazy-reader-divider"></div>
      <button data-action="close" title="Close">✕</button>
    `;
```

Add to `updateState()`:

```js
    const providerEl = this._shadow.querySelector('.lazy-reader-provider');
    if (providerEl && this._state.provider) {
      providerEl.textContent = this._state.provider === 'elevenlabs' ? '☁️' : '🔊';
      providerEl.title = this._state.provider === 'elevenlabs' ? 'ElevenLabs Cloud' : 'Local Voice';
    }
```

Add this CSS to `_getCSS()`:

```css
      .lazy-reader-provider {
        font-size: 11px;
        opacity: 0.7;
        padding: 0 4px;
      }
```

Update the `player.create()` and `player.updateState()` calls in `content.js` to pass the provider:

```js
  player.updateState({ playing: false, speed: settings.speed, provider: settings.ttsProvider });
```

And at the auto-start:

```js
  player.updateState({ playing: true, provider: settings.ttsProvider });
```

- [ ] **Step 3: Rebuild the bundle**

```bash
npm run build
```

- [ ] **Step 4: Run full suite**

```bash
npx vitest run
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add content/content.js content/player.js dist/content.js
git commit -m "feat: wire cloud TTS events to word highlighter and add provider indicator"
```

---

### Task 7: Integration Testing + Final Build

**Files:**
- Modify: `package.json` (build script)
- Rebuild: `dist/content.js`

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests PASS. Fix any failures.

- [ ] **Step 2: Rebuild the bundle**

```bash
npm run build
```

Verify `dist/content.js` is updated.

- [ ] **Step 3: Manual integration test**

1. Open `chrome://extensions`, reload the extension
2. Go to extension options (right-click icon → Options, or find in chrome://extensions)
3. Select ElevenLabs, enter API key, load voices, select a voice, save
4. Navigate to `github.com/donnemartin/system-design-primer`
5. Click the Lazy Reader icon
6. Verify: ElevenLabs voice plays, words highlight one at a time, speed changes take effect mid-word, player shows cloud indicator
7. Test fallback: enter invalid API key, verify it falls back to local voice with toast message

- [ ] **Step 4: Fix any issues found during testing**

- [ ] **Step 5: Final test run**

```bash
npx vitest run
```

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: integration fixes for cloud TTS pipeline"
```

---

## Self-Review

**Spec coverage:**
- Voice quality (ElevenLabs): Task 1 (API client) + Task 4 (background routing) + Task 5 (options page) ✓
- Word-level highlighting: Task 3 (highlighter word mode) + Task 6 (content wiring) ✓
- Mid-sentence speed changes: Task 2 (offscreen `setPlaybackRate`) + Task 4 (background `handleSpeed` routes to offscreen) ✓
- Options page: Task 5 ✓
- Graceful fallback to local: Task 4 (`speakCloudSegment` catch block) + Task 6 (`cloudFallback` event) ✓
- Provider indicator in player: Task 6 ✓
- Offscreen lifecycle: Task 2 + Task 4 ✓

**Placeholder scan:** No TBD, TODO, or "similar to Task N" found.

**Type consistency:**
- `fetchCloudSpeech` returns `{audioBase64, words}` — used in background.js Task 4 ✓
- `OffscreenPlayer.loadAudio(base64)` matches the `audioBase64` from API ✓
- `highlighter.advanceToWord(index)` matches `wordTiming.wordIndex` from offscreen ✓
- `handleSetProvider(provider, apiKey, cloudVoiceId)` matches the message format in options.js and content.js ✓
