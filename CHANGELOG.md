# Changelog

## [0.1.0.0] - 2026-03-30 — V1: Read Any Page Aloud

Click the extension icon on any page and it starts reading. Sentences highlight as they're spoken. A floating player gives you play/pause, skip, and speed controls. Works on GitHub READMEs, documentation sites, and most article pages.

### Added

- **One-click reading.** Click the Lazy Reader icon on any page to start reading aloud with sentence highlighting. Click again to stop.
- **Content parser.** Detects the main content area (article/main tags), classifies elements as prose, code blocks, tables, or skip. Code blocks are announced briefly ("Code block: 5 lines of JavaScript"). Tables are read row by row.
- **Sentence highlighting.** Current sentence gets a yellow highlight on the live page. Only one segment is wrapped at a time (lazy wrapping) to keep pages responsive.
- **Floating player widget.** Dark semi-transparent bar in the bottom-right corner with play/pause, skip forward/back, speed control (0.5x to 3.0x), and close. Rendered in Shadow DOM so it never conflicts with page styles.
- **Background TTS controller.** All chrome.tts calls run in the MV3 service worker. Content script communicates via a command/event message protocol. Keepalive pings prevent worker suspension during playback.
- **Storage module.** Persists speed preference across sessions via chrome.storage.local with 300ms debounced writes.
- **Space key shortcut.** Press Space to toggle play/pause (respects input focus).
- **60 unit tests** across 6 test files covering parser, TTS client, highlighter, player, storage, and background worker.
