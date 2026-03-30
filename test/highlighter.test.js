import { describe, it, expect, beforeEach, vi } from 'vitest';
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

    it('does not advance past last sentence', () => {
      document.body.innerHTML = '<p>Only one.</p>';
      const p = document.querySelector('p');
      const segment = {
        type: 'prose',
        text: 'Only one.',
        node: p,
        sentences: [{ text: 'Only one.', startIndex: 0 }],
      };
      highlighter.setMode('sentence');
      highlighter.highlightSegment(segment);
      highlighter.advanceSentence(); // Should not crash
      const active = p.querySelector('.lazy-reader-active');
      expect(active).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('removes all injected spans and restores original DOM', () => {
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
      highlighter.cleanup();
      expect(p.querySelector('.lazy-reader-sentence')).toBeNull();
      expect(p.querySelector('.lazy-reader-active')).toBeNull();
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
