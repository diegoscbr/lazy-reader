// Highlighter — Lazy sentence wrapping/unwrapping on live DOM
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

  highlightSegment(segment) {
    this.cleanup();
    this._currentSegment = segment;
    this._sentenceIndex = 0;
    if (this.mode === 'sentence') {
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
