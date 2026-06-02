const LINE_Y_TOLERANCE = 3;
const TAB_GAP = 18;
let pdfjsPromise;

function ensurePdfJsBrowserSupport() {
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      });

      return { promise, resolve, reject };
    };
  }
}

async function loadPdfJs() {
  if (!pdfjsPromise) {
    ensurePdfJsBrowserSupport();
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }

  return pdfjsPromise;
}

function findLine(lines, y) {
  return lines.find((line) => Math.abs(line.y - y) <= LINE_Y_TOLERANCE);
}

function textItemToCell(item) {
  const transform = item.transform || [];

  return {
    str: String(item.str || '').trim(),
    width: Number(item.width || 0),
    x: Number(transform[4] || 0),
    y: Number(transform[5] || 0),
  };
}

function buildLineText(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let line = '';
  let previousEnd = null;

  for (const item of sorted) {
    if (!item.str) continue;

    if (line && previousEnd !== null) {
      const gap = item.x - previousEnd;
      line += gap > TAB_GAP ? '\t' : ' ';
    }

    line += item.str;
    previousEnd = item.x + item.width;
  }

  return line.trim();
}

export async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const { getDocument } = await loadPdfJs();
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = [];

    for (const item of textContent.items.map(textItemToCell)) {
      if (!item.str) continue;

      const line = findLine(lines, item.y);
      if (line) {
        line.items.push(item);
      } else {
        lines.push({ items: [item], y: item.y });
      }
    }

    const pageText = lines
      .sort((a, b) => b.y - a.y)
      .map((line) => buildLineText(line.items))
      .filter(Boolean)
      .join('\n');

    if (pageText) pages.push(pageText);
  }

  const text = pages.join('\n\n').trim();

  if (!text) {
    throw new Error('No readable text was found in that PDF. Try exporting the Booksy report as CSV.');
  }

  return text;
}
