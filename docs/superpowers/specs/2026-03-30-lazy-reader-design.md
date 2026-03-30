# Lazy Reader — Design Spec

A Chrome extension that reads web page content aloud with karaoke-style word highlighting. Speechify clone built as a vanilla Manifest V3 extension using the Web Speech API, designed so a premium TTS provider can be swapped in later.

## Requirements

- Click the extension icon to auto-detect and read the main content of any page
- Karaoke-style highlighting: current word highlighted directly on the page DOM
- Minimal floating player widget (draggable, fixed position, Gohu font)
- Playback controls: play/pause, skip forward/back by sentence or paragraph, speed 0.5x–3x
- Smart content handling: read prose normally, announce code blocks briefly, skip navigation/boilerplate
- Works on GitHub READMEs and documentation sites
- TTS engine abstraction: Web Speech API now, cloud provider later

## Architecture

Four main components plus a background service worker:

```
User clicks icon
  -> Background Service Worker sends message
  -> Content Script activates:
     -> Content Parser extracts speakable segments
     -> TTS Engine begins speaking
     -> Highlighter tracks current word on page
     -> Floating Player renders controls
```

### 1. Content Parser

Walks the page DOM and produces an ordered list of segments, each tagged with a type.

**Segment types:**

| Type | Elements | Behavior |
|------|----------|----------|
| `prose` | `<p>`, `<li>`, `<h1>`–`<h6>`, `<td>`, `<blockquote>` | Read normally |
| `code` | `<pre>`, `<code>` blocks | Announce briefly: "Code block: 5 lines of JavaScript" |
| `inline-code` | Backtick `<code>` within prose | Read naturally inline |
| `table` | `<table>` | Read row by row: "Row 1: Name, John. Age, 30." |
| `skip` | `<nav>`, `<header>`, `<footer>`, `<aside>`, cookie banners, badge images | Ignored entirely |

**Main content detection strategy:**

1. Look for `<article>` or `<main>` tags first (covers GitHub READMEs which use `<article>` with `class="markdown-body"`)
2. Fall back to Readability-style heuristic: find the DOM node with the highest text density relative to markup
3. Strip navigation, ads, and boilerplate

**Each segment stores:**

- Text content to speak
- Reference to source DOM node(s) for highlighting
- Segment type
- Pre-computed word boundaries for highlight tracking

### 2. TTS Engine

An abstraction layer over the speech provider.

**Interface:**

- `speak(segments)` — begin reading from a list of segments
- `pause()` / `resume()`
- `skipForward()` / `skipBack()` — jump by sentence (default) or paragraph
- `setSpeed(rate)` — 0.5x to 3x
- `setVoice(voiceId)` — select from available voices
- `onWordBoundary(callback)` — fires with current word index for highlighting
- `onSegmentChange(callback)` — fires when moving to a new segment

**Web Speech API implementation:**

- Uses `SpeechSynthesisUtterance` per segment
- Maps `onWordBoundary` to the native `boundary` event for word-level tracking
- Queues segments and manages transitions between them
- Handles the Chrome bug where speech stops after ~15 seconds of continuous playback by chunking long segments and re-queuing

**Future cloud provider swap:**

- Same interface, but fetches audio from an API and plays via `AudioContext`
- Word boundaries from the provider's timestamp data (ElevenLabs and OpenAI both return these)
- No changes needed in the highlighter or player — they consume the same interface

### 3. Highlighter

Operates directly on the page DOM. No overlay, no cloned text.

**Mechanism:**

1. When a segment starts, wrap each word in that segment's source DOM node with `<span class="lazy-reader-word">`
2. As `onWordBoundary` fires, add `lazy-reader-active` class to the current word, remove from the previous
3. When a segment finishes, unwrap all spans (restore original DOM) before moving to the next segment

**Styling:**

- Active word: subtle background highlight (yellow/amber)
- Active sentence: lighter highlight for context (sentence boundaries detected by punctuation: `.`, `!`, `?`)
- All styles injected via content script CSS, scoped with `lazy-reader-` prefix to avoid collisions

**Scroll behavior:**

- Auto-scroll to keep active word visible with smooth scrolling
- Active word positioned roughly in the top third of the viewport (not centered — shows what's coming)
- Auto-scroll pauses if the user manually scrolls; resumes when playback catches up

**Cleanup:**

- On stop or page unload, all injected spans are removed and original DOM is fully restored
- No mutation of text content — only wrapping/unwrapping

### 4. Floating Player Widget

A small draggable bar injected via the content script. Rendered in a Shadow DOM to isolate styles from the host page.

**Layout:**

```
[ skip back ]  [ play/pause ]  [ skip forward ]  |  1.0x  |  [ close ]
```

**Controls:**

- **Skip back / Skip forward** — sentence on click, paragraph on double-click
- **Play/Pause** — toggle playback
- **Speed selector** — dropdown or scroll to cycle: 0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x, 2.5x, 3.0x
- **Close** — stops playback, removes widget, cleans up highlighting

**Behavior:**

- `position: fixed` — stays in place during scroll
- Draggable — user can reposition anywhere on the page
- Remembers position across pages (stored in `chrome.storage.local`)
- Defaults to bottom-right corner
- Semi-transparent (0.6 opacity) when idle, fully opaque on hover
- Approximately 250px wide, 40px tall

**Font:**

- Gohu font bundled with the extension
- Loaded via `@font-face` inside the Shadow DOM

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Space` | Play/pause (only when not focused on an input) |
| `Left arrow` | Skip back by sentence |
| `Right arrow` | Skip forward by sentence |
| `Up arrow` | Increase speed by 0.25x |
| `Down arrow` | Decrease speed by 0.25x |

### 5. Background Service Worker

- Listens for extension icon click (`chrome.action.onClicked`)
- Sends a message to the active tab's content script to start/stop reading
- Manages extension lifecycle

### 6. Storage & Preferences

Uses `chrome.storage.local`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `speed` | number | 1.0 | Last used playback speed |
| `voiceId` | string | system default | Preferred Web Speech voice |
| `playerPosition` | `{x, y}` | bottom-right | Floating player coordinates |
| `playerOpacity` | number | 0.6 | Idle opacity level |

Settings load on content script initialization and apply immediately. Changes save on every interaction (debounced).

No popup page or options page for v1. Everything controlled from the floating player.

## File Structure

```
lazy-reader/
  manifest.json           # Manifest V3 config
  background.js           # Service worker
  content/
    content.js            # Entry point, orchestrates modules
    parser.js             # Content extraction and segmentation
    tts-engine.js         # TTS abstraction + Web Speech implementation
    highlighter.js        # Word highlighting on page DOM
    player.js             # Floating player widget
    storage.js            # Preferences read/write
  styles/
    content.css           # Highlight styles injected into pages
    player.css            # Player widget styles (loaded in Shadow DOM)
  fonts/
    gohu/                 # Gohu font files
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
```

## GitHub & Documentation Site Compatibility

- GitHub READMEs: detected via `<article>` tag with `class="markdown-body"`
- Code blocks: `<pre><code class="language-*">` — language detected from class name for announcement
- Inline code: read naturally within surrounding prose
- Tables: read row by row with column headers
- Badge images: skipped (detected by common badge URL patterns and small image dimensions)
- Meaningful image alt text: read when present on non-badge images

## Out of Scope (v1)

- Options/settings page (use floating player controls only)
- Cloud TTS providers (interface ready, implementation later)
- Text selection to read specific passages
- PDF or non-HTML content
- Mobile browser support
