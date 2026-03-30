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

    it('falls back to document.body when no article or main', () => {
      document.body.innerHTML = '<div><p>Just a div</p></div>';
      const root = findContentRoot(document);
      expect(root.tagName).toBe('BODY');
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

    it('classifies <pre><code> as code with line count and language', () => {
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

    it('reads inline <code> naturally within prose', () => {
      document.body.innerHTML = '<article><p>Use the <code>npm install</code> command</p></article>';
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
      expect(segments).toHaveLength(1);
      expect(segments[0].type).toBe('prose');
      expect(segments[0].text).toBe('Use the npm install command');
    });

    it('classifies <table> with row-by-row text', () => {
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
      let html = '<article>';
      for (let i = 0; i < 60; i++) html += '<div>';
      html += '<p>Deep content</p>';
      for (let i = 0; i < 60; i++) html += '</div>';
      html += '</article>';
      document.body.innerHTML = html;
      const article = document.querySelector('article');
      const segments = walkAndClassify(article);
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

    it('returns empty array when body has only skip elements', () => {
      document.body.innerHTML = '<nav>Just nav</nav><footer>Just footer</footer>';
      const segments = parsePageContent(document);
      expect(segments).toHaveLength(0);
    });
  });

  it('MAX_DEPTH is 50', () => {
    expect(MAX_DEPTH).toBe(50);
  });
});
