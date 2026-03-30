# Lazy Reader

Chrome extension that reads web pages aloud with sentence highlighting. Free Speechify alternative.

## Install

1. Clone the repo
2. `npm install && npm run build`
3. Open `chrome://extensions`, enable Developer Mode
4. Click "Load unpacked" and select the `lazy-reader/` directory

## Use

Click the Lazy Reader icon on any page. It starts reading immediately with the current sentence highlighted in yellow. A floating player appears with controls:

- Play/pause, skip forward/back, speed (0.5x - 3.0x), close
- Press Space to toggle play/pause

Works on GitHub READMEs, documentation sites, and most article pages. Code blocks are announced briefly. Tables are read row by row. Navigation and boilerplate are skipped.

## Develop

```
npm test          # run tests (60 unit tests)
npm run test:watch # watch mode
npm run build      # rebuild dist/content.js after changes
```

Source lives in `content/`, the bundled output in `dist/`. After editing any content script, run `npm run build` and reload the extension in Chrome.

## How it works

Background service worker owns all `chrome.tts` calls. Content script is injected on icon click, parses the page, and communicates with the background via message passing. Highlighting wraps sentences lazily (one segment at a time) to keep pages responsive.
