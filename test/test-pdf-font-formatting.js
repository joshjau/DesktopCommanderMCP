import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import MarkdownIt from 'markdown-it';
import { pdf2md } from '../dist/tools/pdf/lib/pdf2md.js';
import { runIfMain } from './helpers/run-if-main.js';

export default async function runTests() {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const examples = [
    ['Normal body', StandardFonts.Helvetica],
    ['Bold body', StandardFonts.HelveticaBold],
    ['Italic body', StandardFonts.HelveticaOblique],
    ['Bold italic body', StandardFonts.HelveticaBoldOblique],
  ];
  for (const [index, [text, fontName]] of examples.entries()) {
    page.drawText(text, { x: 40, y: 750 - index * 30, size: 12, font: await document.embedFont(fontName) });
  }
  const result = await pdf2md(await document.save());
  assert.equal(result.pages.length, 1);
  const markdown = result.pages[0].text;
  // Markdown permits either underscore or asterisk emphasis. Check what a
  // real renderer shows, rather than imposing a particular marker spelling.
  const html = new MarkdownIt().render(markdown);
  assert.match(html, /Normal body/);
  assert.match(html, /<strong>Bold body<\/strong>/);
  assert.match(html, /<em>Italic body<\/em>/);
  assert.match(html, /(?:<strong><em>Bold italic body<\/em><\/strong>|<em><strong>Bold italic body<\/strong><\/em>)/);
  assert.equal(result.metadata.totalPages, 1);
  console.log('PASS: actual PDF reader preserves normal, bold, italic and combined font formatting with the current converter dependency.');
}

runIfMain(import.meta.url, runTests);
