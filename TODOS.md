# TODOS

## Phase 2+

### PDF Support via pdf.js
Add support for reading online PDFs (e.g., textbooks hosted as PDFs). Requires pdf.js for text extraction since Chrome's PDF viewer renders to an embed/canvas element with no accessible DOM text nodes. Would need a separate highlighting strategy (overlay on canvas coordinates or reader-mode extraction). Significant complexity. Depends on Phase 1 completion.

### DOM Range-Based Word Wrapping
Replace innerHTML word wrapping with DOM Range/TreeWalker approach that preserves inline markup (`<a>`, `<strong>`, `<em>`, `<code>`). Current V2 word highlighting temporarily flattens these during the highlighted segment. Acceptable for personal use, but if users complain about lost formatting on markup-heavy pages, this is the fix. Depends on V2 word highlighting. Flagged by Codex eng review 2026-03-31.

### Word-Level Highlighting for Local Voices
If pre-implementation verification shows that `chrome.tts.onEvent` fires reliable word-level boundary events on macOS, upgrade the Phase 1 highlighter from sentence mode to word mode for local voices. This restores the karaoke-style differentiator without needing cloud TTS. Run the verification checklist first. If word events are unreliable, sentence mode stands and word-level highlighting remains gated on Phase 2 cloud TTS (ElevenLabs timestamps).
