export const MAX_DEPTH = 50;

const SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);
const PROSE_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'DD', 'DT', 'FIGCAPTION']);

export function findContentRoot(doc) {
  const article = doc.querySelector('article');
  if (article) return article;
  const main = doc.querySelector('main');
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
  return node.textContent.replace(/\s+/g, ' ').trim();
}

function detectLanguage(codeEl) {
  const cls = codeEl.className || '';
  const match = cls.match(/language-(\w+)/);
  return match ? match[1] : 'code';
}

function countLines(text) {
  return text.split('\n').filter(line => line.trim().length > 0).length;
}

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

export function walkAndClassify(root, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  const segments = [];

  for (const child of root.children) {
    const tag = child.tagName;
    if (SKIP_TAGS.has(tag)) continue;

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

    if (tag === 'TABLE') {
      const text = tableToText(child);
      if (text.length > 0) {
        segments.push({ type: 'table', text, node: child, sentences: splitSentences(text) });
      }
      continue;
    }

    if (PROSE_TAGS.has(tag)) {
      const text = getTextContent(child);
      if (text.length > 0) {
        segments.push({ type: 'prose', text, node: child, sentences: splitSentences(text) });
      }
      continue;
    }

    const nested = walkAndClassify(child, depth + 1);
    segments.push(...nested);
  }

  return segments;
}

export function parsePageContent(doc) {
  const root = findContentRoot(doc);
  if (!root) return [];
  return walkAndClassify(root);
}
