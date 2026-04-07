#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MODULES = '/opt/homebrew/lib/node_modules/md-to-pdf/node_modules';
const { marked, Renderer } = require(path.join(MODULES, 'marked'));
const puppeteer = require(path.join(MODULES, 'puppeteer'));

const BOOK_DIR = '/Users/sylvia/Downloads/bca-book/claude_code_book';
const OUTPUT_PDF = '/Users/sylvia/Downloads/bca-book/claude_code_book.pdf';

const PART_LABELS = {
  PartI:   'Part I: Foundations',
  PartII:  'Part II: The Tool System',
  PartIII: 'Part III: The Command System',
  PartIV:  'Part IV: The UI Layer',
  PartV:   'Part V: Subsystems',
  PartVI:  'Part VI: Services & Infrastructure',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()#>!]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function getPartKey(filename) {
  const m = filename.match(/^(Part[IVX]+)/);
  return m ? m[1] : 'Unknown';
}

// Parse headings from markdown, skipping code fences
// level is the SHIFTED level (part=1, chapter=2, section=3)
function parseHeadings(src, fileSlug, shiftBy) {
  const headings = [];
  let inFence = false;

  for (const line of src.split('\n')) {
    if (/^(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    if (h1) headings.push({ level: 1 + shiftBy, text: h1[1].trim(), id: `${fileSlug}-${slugify(h1[1])}` });
    else if (h2) headings.push({ level: 2 + shiftBy, text: h2[1].trim(), id: `${fileSlug}-${slugify(h2[1])}` });
  }
  return headings;
}

// Convert markdown to HTML, shifting heading levels and injecting IDs
function mdToHtml(src, fileSlug, shiftBy) {
  const renderer = new Renderer();
  renderer.heading = function (text, level) {
    const raw = text.replace(/<[^>]+>/g, '');
    const id = `${fileSlug}-${slugify(raw)}`;
    const newLevel = Math.min(level + shiftBy, 6);
    return `<h${newLevel} id="${id}">${text}</h${newLevel}>\n`;
  };
  const body = src.replace(/^---[\s\S]*?---\n/, '');
  return marked(body, { renderer, mangle: false, headerIds: false });
}

// ── collect chapters ──────────────────────────────────────────────────────────

const files = fs.readdirSync(BOOK_DIR)
  .filter(f => f.endsWith('.md'))
  .sort();

// Group files by part, maintaining order
const partOrder = [];
const partGroups = {};
for (const filename of files) {
  const key = getPartKey(filename);
  if (!partGroups[key]) {
    partOrder.push(key);
    partGroups[key] = [];
  }
  partGroups[key].push(filename);
}

// Build chapters with heading shift = 1 (chapter H1→H2, section H2→H3)
const SHIFT = 1;
const parts = partOrder.map(key => {
  const label = PART_LABELS[key] || key;
  const partSlug = slugify(label);
  const chapters = partGroups[key].map(filename => {
    const fileSlug = filename.replace(/\.md$/, '');
    const src = fs.readFileSync(path.join(BOOK_DIR, filename), 'utf8');
    return {
      filename,
      fileSlug,
      headings: parseHeadings(src, fileSlug, SHIFT),
      html: mdToHtml(src, fileSlug, SHIFT),
    };
  });
  return { key, label, partSlug, chapters };
});

// ── build TOC ─────────────────────────────────────────────────────────────────

function buildTocHtml() {
  let html = '<div class="toc-page">\n<h2 class="toc-title">Table of Contents</h2>\n<nav class="toc">\n';

  for (const part of parts) {
    // Part = level 1 in TOC (links to the part heading in content)
    html += `<div class="toc-part"><a href="#part-${part.partSlug}">${part.label}</a></div>\n`;

    for (const ch of part.chapters) {
      const h2s = ch.headings.filter(h => h.level === 2); // shifted chapter H1→H2
      const h3s = ch.headings.filter(h => h.level === 3); // shifted section H2→H3

      for (const h of h2s) {
        html += `<div class="toc-chapter"><a href="#${h.id}">${h.text}</a></div>\n`;
      }
      for (const h of h3s) {
        html += `<div class="toc-section"><a href="#${h.id}">${h.text}</a></div>\n`;
      }
    }
  }

  html += '</nav>\n</div>\n';
  return html;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.75;
    color: #1a1a1a;
    margin: 0;
    padding: 0;
  }

  /* ── Title page ── */
  .title-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    page-break-after: always;
    text-align: center;
    padding: 4rem 3rem;
  }
  .title-page .main-title {
    font-size: 2.6rem;
    font-weight: bold;
    line-height: 1.15;
    margin-bottom: 0.5rem;
    color: #111;
  }
  .title-page .subtitle {
    font-size: 1.2rem;
    color: #555;
    font-style: italic;
    margin-bottom: 3rem;
  }
  .title-page .author { font-size: 1.1rem; color: #333; margin-bottom: 0.3rem; }
  .title-page .year   { font-size: 0.95rem; color: #888; }

  /* ── TOC ── */
  .toc-page {
    padding: 3.5rem 4.5rem;
    page-break-after: always;
  }
  h2.toc-title {
    font-size: 1.9rem;
    margin-bottom: 2.2rem;
    border-bottom: 2px solid #333;
    padding-bottom: 0.5rem;
  }
  .toc { line-height: 1.45; }
  .toc-part {
    font-size: 1rem;
    font-weight: bold;
    color: #111;
    margin-top: 1.8rem;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .toc-chapter {
    padding-left: 1.4rem;
    margin: 0.35rem 0;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .toc-section {
    padding-left: 3rem;
    margin: 0.15rem 0;
    font-size: 0.82rem;
    color: #444;
  }
  .toc a { color: inherit; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }

  /* ── Part page ── */
  .part-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 60vh;
    page-break-before: always;
    page-break-after: always;
    padding: 4rem 4.5rem;
    border-left: 6px solid #333;
    margin-left: 0;
  }
  .part-page h1 {
    font-size: 2.2rem;
    margin: 0;
    border: none;
    color: #111;
  }

  /* ── Book content ── */
  .book-content { padding: 2.5rem 4.5rem; }

  .chapter-wrapper { page-break-before: always; }

  /* Shifted heading styles: H2=chapter, H3=section, H4=subsection */
  h1 { /* part heading — inside .part-page, styled there */ }

  h2 {
    font-size: 1.65rem;
    font-weight: bold;
    margin-top: 0;
    margin-bottom: 0.9rem;
    color: #111;
    border-bottom: 2px solid #ddd;
    padding-bottom: 0.35rem;
  }
  h3 {
    font-size: 1.2rem;
    font-weight: bold;
    margin-top: 2rem;
    margin-bottom: 0.65rem;
    color: #222;
  }
  h4 {
    font-size: 1.0rem;
    font-weight: bold;
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    color: #333;
  }
  h5 {
    font-size: 0.95rem;
    font-weight: bold;
    color: #444;
    margin-top: 1.2rem;
    margin-bottom: 0.4rem;
  }

  p { margin: 0.75rem 0; }
  ul, ol { margin: 0.6rem 0; padding-left: 1.9rem; }
  li { margin: 0.25rem 0; }

  code {
    font-family: 'Courier New', monospace;
    font-size: 0.83em;
    background: #f4f4f4;
    border-radius: 3px;
    padding: 0.12em 0.38em;
  }
  pre {
    background: #f6f6f6;
    border: 1px solid #ddd;
    border-left: 4px solid #888;
    border-radius: 4px;
    padding: 0.9rem 1.2rem;
    font-size: 0.78em;
    line-height: 1.5;
    margin: 1rem 0;
    page-break-inside: avoid;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; font-size: inherit; }

  blockquote {
    border-left: 4px solid #ccc;
    margin: 1rem 0;
    padding: 0.5rem 1.2rem;
    color: #555;
    background: #fafafa;
    font-style: italic;
  }
  blockquote p { margin: 0.3rem 0; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.88em;
    page-break-inside: avoid;
  }
  th, td { border: 1px solid #ddd; padding: 0.45rem 0.75rem; text-align: left; }
  th { background: #f0f0f0; font-weight: bold; }
  tr:nth-child(even) td { background: #fafafa; }

  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }

  strong { font-weight: bold; }
  em { font-style: italic; }
  a { color: #0055aa; }

  @media print {
    body { font-size: 10.5pt; }
    pre  { page-break-inside: avoid; }
    h2, h3, h4 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
`;

// ── assemble HTML ─────────────────────────────────────────────────────────────

const tocHtml = buildTocHtml();

let contentHtml = '';
for (const part of parts) {
  // Part separator page with H1 (level 1 in PDF outline)
  contentHtml += `
<div class="part-page">
  <h1 id="part-${part.partSlug}">${part.label}</h1>
</div>\n`;

  for (const ch of part.chapters) {
    contentHtml += `<div class="chapter-wrapper">\n${ch.html}\n</div>\n`;
  }
}

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Behind Claude Code: A Deep Dive into the Architecture</title>
  <style>${CSS}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>hljs.highlightAll();</script>
</head>
<body>

<div class="title-page">
  <div class="main-title">Behind Claude Code</div>
  <div class="subtitle">A Deep Dive into the Architecture</div>
  <div class="author">Sylvia</div>
  <div class="year">2026</div>
</div>

${tocHtml}

<div class="book-content">
${contentHtml}
</div>

</body>
</html>`;

// Write debug HTML
const htmlPath = OUTPUT_PDF.replace('.pdf', '.html');
fs.writeFileSync(htmlPath, fullHtml, 'utf8');
console.log(`HTML written → ${htmlPath}`);

// ── render PDF ────────────────────────────────────────────────────────────────

(async () => {
  console.log('Launching browser…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('pre code.hljs').length > 0, { timeout: 15000 }).catch(() => {});

  console.log('Rendering PDF…');
  await page.pdf({
    path: OUTPUT_PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: '2.2cm', bottom: '2.2cm', left: '2.2cm', right: '2.2cm' },
    outline: true,    // H1/H2/H3 headings → PDF bookmark outline
    tagged: true,     // tagged PDF for accessibility
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="width:100%;font-size:8px;color:#aaa;text-align:center;padding:0 2cm;">
        <span class="pageNumber"></span>
      </div>`,
  });

  await browser.close();
  console.log(`PDF written → ${OUTPUT_PDF}`);

  fs.unlinkSync(htmlPath);
  console.log('Done.');
})().catch(err => { console.error(err); process.exit(1); });
