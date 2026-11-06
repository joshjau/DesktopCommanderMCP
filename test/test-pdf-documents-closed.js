/**
 * Reading a PDF must close every PDF document the read opened.
 *
 * npx installs resolve "unpdf": "^1.4.0" anew and get unpdf 1.8, whose PDF
 * document (PDFDocumentProxy) has no destroy(): only its loadingTask has one.
 * Both places that read a PDF closed the document with
 * `if (typeof pdfDocument.destroy === 'function') await pdfDocument.destroy()`
 * (lib/pdf2md.ts for the text, extract-images.ts for the images), so with 1.8
 * both skipped it without a word: read_file of a PDF returned with its 2
 * documents still open, and closing them was left to the garbage collector.
 * The repo's lock has unpdf 1.4.0, whose document still has destroy(), so the
 * tests didn't see it. And pdf2md() closed the text document only once it had
 * the whole result: if the image extraction or the transform threw after
 * parse() had opened the document, the document stayed open.
 *
 * The test shapes the document like unpdf 1.8's on whichever unpdf is
 * installed: it removes destroy() from the document's prototype (1.4's only
 * calls loadingTask.destroy()), and watches getPage() to see which documents
 * the read opened. Expected: when the read returns, each of them has its
 * loadingTask destroyed, also when the read fails after opening one.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { handleReadFile } from '../dist/handlers/filesystem-handlers.js';
import { extractImagesFromPdf, unpdfPackage } from '../dist/tools/pdf/extract-images.js';
import { SIMPLE_PDF, answerText, pdfWorkspace } from './helpers/pdf.js';
import { isTestHome } from './helpers/test-env.js';
import { runIfMain, skip } from './helpers/run-if-main.js';

const require = createRequire(import.meta.url);

/**
 * The PDF document prototypes of the unpdf builds DC reads with: its own
 * import('unpdf') (extract-images.ts) and @opendocsg/pdf2md's require('unpdf').
 * Both can share one pdf.js, so each prototype is listed once.
 */
async function documentPrototypes() {
  const pdf2mdRequire = createRequire(require.resolve('@opendocsg/pdf2md/lib/util/pdf'));
  const prototypes = new Set();
  for (const { getDocumentProxy } of [await import('unpdf'), pdf2mdRequire('unpdf')]) {
    const probe = await getDocumentProxy(new Uint8Array(fs.readFileSync(SIMPLE_PDF)));
    assert.strictEqual(typeof probe.loadingTask?.destroy, 'function', 'setup: the PDF document has no loadingTask.destroy()');
    prototypes.add(Object.getPrototypeOf(probe));
    await probe.loadingTask.destroy();
  }
  return [...prototypes];
}

/**
 * Makes every PDF document look like unpdf 1.8's, with no destroy() of its
 * own, and adds each document a page is read from to `opened`. Returns the undo.
 */
function shapeLikeUnpdf18(prototypes, opened) {
  const undo = prototypes.map((proto) => {
    const destroy = Object.getOwnPropertyDescriptor(proto, 'destroy');
    const getPage = Object.getOwnPropertyDescriptor(proto, 'getPage');
    if (destroy) delete proto.destroy;
    Object.defineProperty(proto, 'getPage', {
      ...getPage,
      value(...args) {
        opened.add(this);
        return getPage.value.apply(this, args);
      },
    });
    return () => {
      if (destroy) Object.defineProperty(proto, 'destroy', destroy);
      Object.defineProperty(proto, 'getPage', getPage);
    };
  });
  return () => undo.forEach((restore) => restore());
}

async function run() {
  if (!isTestHome()) {
    skip('PDF documents closed: run through the test runner (it uses a temporary home)');
    return true;
  }
  const ws = pdfWorkspace('pdf-documents-closed');
  const pdf = path.join(ws.allowed, 'simple.pdf');
  fs.copyFileSync(SIMPLE_PDF, pdf);
  const opened = new Set();
  const undo = shapeLikeUnpdf18(await documentPrototypes(), opened);
  const failures = [];
  const check = async (name, what, documents, read, why = 'the document has no destroy() of its own, as in unpdf 1.8; only loadingTask.destroy() closes it') => {
    opened.clear();
    try {
      await read();
      assert(opened.size >= documents, `setup: ${what} read pages of ${opened.size} PDF document(s), expected ${documents}`);
      const open = [...opened].filter((doc) => doc.loadingTask?.destroyed !== true);
      assert(open.length === 0,
        `${what} left ${open.length} of the ${opened.size} PDF document(s) it opened open after it returned (${why})`);
      console.log(`✓ ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`✗ ${name}\n  ${error.message}`);
    }
  };
  try {
    await check('read_file of a PDF closes both documents it opens (text through pdf2md, images through extract-images)', 'read_file of a PDF', 2, async () => {
      const result = await handleReadFile({ path: pdf });
      assert(!result.isError && /<!-- Page: 1 -->/.test(answerText(result)), `setup: read_file failed: ${answerText(result).slice(0, 300)}`);
    });
    await check('extracting the images of a PDF closes the document it opens', 'extracting the images of a PDF', 1, async () => {
      await extractImagesFromPdf(new Uint8Array(fs.readFileSync(pdf)));
    });
    await check('PDF image extraction preserves RGBA pixels and dimensions', 'extracting an embedded image', 1, async () => {
      const sharp = require('sharp');
      const { PDFDocument } = require('pdf-lib');
      const png = await sharp({ create: {
        width: 2, height: 3, channels: 4, background: { r: 0, g: 190, b: 240, alpha: 1 },
      } }).png().toBuffer();
      const document = await PDFDocument.create();
      const embedded = await document.embedPng(png);
      document.addPage([30, 30]).drawImage(embedded, { x: 1, y: 1, width: 12, height: 18 });
      const images = await extractImagesFromPdf(await document.save(), [1], { format: 'webp', quality: 100 });
      assert.equal(images[1].length, 1, 'RGBA images must not be silently dropped');
      const image = images[1][0];
      assert.equal(image.width, 2);
      assert.equal(image.height, 3);
      assert.equal(image.mimeType, 'image/webp');
      const decoded = await sharp(Buffer.from(image.data, 'base64')).ensureAlpha().raw().toBuffer();
      assert.equal(decoded.length, 2 * 3 * 4);
      assert(decoded[0] < 15 && decoded[1] > 175 && decoded[2] > 225);
      assert.equal(decoded[3], 255);
    });
    await check('read_file of a PDF whose image extraction fails still closes the text document, and answers with the error', 'read_file of a PDF whose image extraction failed', 1, async () => {
      const failure = 'the PDF images could not be extracted (test)';
      const load = unpdfPackage.load;
      unpdfPackage.load = () => Promise.reject(new Error(failure));
      try {
        const result = await handleReadFile({ path: pdf });
        assert(answerText(result).includes(failure), `read_file should answer with the image extraction's error, answered: ${answerText(result).slice(0, 300)}`);
      } finally {
        unpdfPackage.load = load;
      }
    }, 'the image extraction failed after parse() had opened the text document');
  } finally {
    undo();
    ws.cleanup();
  }
  if (failures.length > 0) {
    console.log(`${failures.length} of 4 cases failed`);
    return false;
  }
  return true;
}

runIfMain(import.meta.url, run);

export default run;
