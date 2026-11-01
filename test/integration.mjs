import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { getDocument } = await import(
  pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
);

const baseUrl = process.env.EXPORT_HTML_TEST_URL || "http://127.0.0.1:2306";
const token = process.env.EXPORT_HTML_BEARER_TOKEN;

if (!token) {
  throw new Error("EXPORT_HTML_BEARER_TOKEN must be configured for integration tests");
}

const authorization = { authorization: `Bearer ${token}` };
const pageNumberHtml = `<!doctype html>
<style>
  @page {
    size: A4;
    margin: 12mm 12mm 16mm;
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font: 9pt Arial, sans-serif;
    }
  }
  .page { page-break-after: always; }
</style>
<div class="page">IMP710_PAGE_A</div>
<div class="page">IMP710_PAGE_B</div>
<div>IMP710_PAGE_C</div>`;

async function post(path, body, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? authorization : {}),
    },
    body: JSON.stringify(body),
  });
}

async function extractPdfText(bytes) {
  const loadingTask = getDocument({ data: bytes });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

const root = await fetch(`${baseUrl}/`);
assert.equal(root.status, 200, "root health endpoint");

const status = await fetch(`${baseUrl}/check-status`);
assert.equal(status.status, 200, "browser health endpoint");

const missingToken = await post("/1/pdf", { html: "<p>test</p>" }, false);
assert.equal(missingToken.status, 401, "missing token must be rejected");

const invalidSource = await post("/1/pdf", {});
assert.equal(invalidSource.status, 400, "invalid input must return 400");

const pdfResponse = await post("/1/pdf", {
  html: pageNumberHtml,
  export: { format: "A4", displayHeaderFooter: false },
});
assert.equal(pdfResponse.status, 200, "PDF generation");
assert.match(pdfResponse.headers.get("content-type") || "", /application\/pdf/);

const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 4)), "%PDF");

const pageText = await extractPdfText(pdfBytes);
assert.equal(pageText.length, 3);
assert.match(pageText[0], /1\s*\/\s*3/);
assert.match(pageText[1], /2\s*\/\s*3/);
assert.match(pageText[2], /3\s*\/\s*3/);

const screenshotResponse = await post("/1/screenshot", {
  html: "<h1>IMP710_SCREENSHOT</h1>",
  export: { type: "png", fullPage: true },
});
assert.equal(screenshotResponse.status, 200, "screenshot generation");
const screenshot = new Uint8Array(await screenshotResponse.arrayBuffer());
assert.deepEqual(
  [...screenshot.slice(0, 8)],
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
);

const concurrentResponses = await Promise.all(
  Array.from({ length: 3 }, () =>
    post("/1/pdf", {
      html: "<p>IMP710_CONCURRENT</p>",
      export: { format: "A4" },
    })
  )
);
assert.deepEqual(
  concurrentResponses.map((response) => response.status),
  [200, 200, 200]
);

console.log(
  JSON.stringify({
    health: "pass",
    authentication: "pass",
    validation: "pass",
    pdfPageNumbers: pageText,
    screenshot: "pass",
    concurrentRequests: concurrentResponses.length,
  })
);
