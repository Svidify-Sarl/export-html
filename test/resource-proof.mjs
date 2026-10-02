// Controlled synthetic converter proof; never real FE Confié acceptance.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { getDocument, OPS } = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")));
const images = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(images.length, 51);
const base = process.env.EXPORT_HTML_TEST_URL || "http://127.0.0.1:2308";
const token = process.env.EXPORT_HTML_BEARER_TOKEN;
assert.ok(token);
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const imageBase = process.env.EXPORT_HTML_FIXTURE_IMAGE_BASE_URL;
const concurrency = Number(process.env.EXPORT_HTML_PROOF_CONCURRENCY || 3);
assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 3);
const receipt = { environment: "isolated local candidate Linux container", status: "running", observedUtc: new Date().toISOString(), checks: [], samples: [] };
const html = `<!doctype html><style>@page{size:A4;margin:12mm 12mm 16mm;@bottom-right{content:counter(page) " / " counter(pages);font:9pt Arial}}body{font:12pt Arial}.row{height:18mm;break-inside:avoid}img{width:20mm;height:15mm;object-fit:cover}</style>${images.map((image, i) => `<div class="row"><img src="${imageBase ? `${imageBase}/${i}.jpg` : `data:image/jpeg;base64,${image}`}">IMP1116_ROW_${String(i + 1).padStart(3, "0")}</div>`).join("")}`;
receipt.imageSource = imageBase ? "51 synthetic raster URLs served by a separate private fixture container" : "51 inline synthetic raster data URLs";
receipt.concurrency = concurrency;
async function health() { return (await fetch(`${base}/check-status`)).json(); }
async function sample() {
  const response = await fetch(`${base}/1/resources`, { headers });
  assert.equal(response.status, 200);
  receipt.samples.push(await response.json());
}
async function convert(name, content = html, options = {}, signal = AbortSignal.timeout(65000)) {
  const start = performance.now();
  const response = await fetch(`${base}/1/pdf`, { method: "POST", headers, body: JSON.stringify({ html: content, export: { format: "A4", displayHeaderFooter: false, ...options } }), signal });
  const bytes = new Uint8Array(await response.arrayBuffer());
  receipt.checks.push({ name, status: response.status, durationMs: Math.round(performance.now() - start), bytes: bytes.length });
  return { response, bytes };
}
try {
  // An explicitly restarted local candidate may still be launching Chromium.
  const startupDeadline = performance.now() + 15000;
  let ready;
  while (!ready) {
    try { ready = await health(); }
    catch (error) {
      if (performance.now() >= startupDeadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  receipt.baselinePages = ready.pageCount;
  assert.equal((await fetch(`${base}/1/resources`)).status, 401, "resource metrics require authentication");
  await sample();
  const first = await convert("51 image multipage");
  assert.equal(first.response.status, 200);
  const loading = getDocument({ data: first.bytes });
  const pdf = await loading.promise;
  const pageText = [];
  let imageOperators = 0;
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const text = (await page.getTextContent()).items.map(item => item.str).join(" ");
    assert.ok(text.includes(`${index} / ${pdf.numPages}`));
    pageText.push(text);
    imageOperators += (await page.getOperatorList()).fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
  }
  assert.equal(imageOperators, 51);
  const allText = pageText.join(" ");
  for (let index = 1; index <= 51; index++) assert.equal(allText.split(`IMP1116_ROW_${String(index).padStart(3, "0")}`).length - 1, 1);
  receipt.pdf = { pages: pdf.numPages, exactUniqueRows: 51, imageOperators, everyPageMarkers: "pass" };
  await loading.destroy();
  await sample();
  for (let repeat = 0; repeat < 2; repeat++) assert.equal((await convert(`repeat ${repeat + 1}`)).response.status, 200);
  await sample();
  const concurrent = await Promise.all(Array.from({ length: concurrency }, (_, i) => convert(`concurrent ${i + 1}`)));
  assert.ok(concurrent.every(item => item.response.status === 200));
  await sample();
  assert.equal((await convert("disabled timeout rejected", "<p>test</p>", { timeout: 0 })).response.status, 400);
  assert.equal((await convert("broken image rejected", "<img src='data:image/jpeg;base64,AAAA'>")).response.status, 422);
  assert.equal((await convert("broken requested font rejected", "<style>@font-face{font-family:Broken;src:url(data:font/woff2;base64,AAAA)}body{font-family:Broken}</style><p>must not silently fall back</p>")).response.status, 422);
  // Renderer deliberately remains busy; browser-side page close must interrupt it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  const abortStart = performance.now();
  await assert.rejects(convert("client abort", "<script>const start=performance.now();while(performance.now()-start<10000){}</script><p>slow</p>", {}, controller.signal), error => error.name === "AbortError");
  clearTimeout(timer);
  let pages;
  do {
    await new Promise(resolve => setTimeout(resolve, 100));
    pages = (await health()).pageCount;
  } while (pages !== receipt.baselinePages && performance.now() - abortStart < 3000);
  assert.equal(pages, receipt.baselinePages, "aborted page promptly removed");
  receipt.clientAbortCleanupMs = Math.round(performance.now() - abortStart);
  receipt.finalPages = pages;
  await new Promise(resolve => setTimeout(resolve, 500));
  await sample();
  const last = receipt.samples.at(-1);
  assert.ok(last.sampledPeaks.chromiumPssBytes > 0 && last.sampledPeaks.cgroupKernelPeakBytes > 0);
  receipt.status = "passed";
} catch (error) { receipt.status = "failed"; receipt.failure = error.message; throw error; }
finally { await writeFile(process.argv[3], JSON.stringify(receipt, null, 2)); console.log(JSON.stringify({ status: receipt.status, pdf: receipt.pdf, clientAbortCleanupMs: receipt.clientAbortCleanupMs, latestResources: receipt.samples.at(-1) })); }
