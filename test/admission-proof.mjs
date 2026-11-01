import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = process.env.EXPORT_HTML_TEST_URL || "http://127.0.0.1:2308";
const headers = { "content-type": "application/json", authorization: `Bearer ${process.env.EXPORT_HTML_BEARER_TOKEN}` };
async function status() { return (await fetch(`${base}/1/resources`, { headers })).json(); }
async function until(predicate) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const current = await status();
    if (predicate(current.admission)) return current;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Admission state did not converge");
}
function post(html, signal) {
  return fetch(`${base}/1/pdf`, { method: "POST", headers, signal, body: JSON.stringify({ html, export: { format: "A4" } }) });
}
const receipt = { environment: "isolated local candidate", observedUtc: new Date().toISOString() };
const activeAbort = new AbortController();
const queuedAbort = new AbortController();
try {
  const active = post("<script>const begin=performance.now();while(performance.now()-begin<10000){}</script>", activeAbort.signal).catch(error => error);
  await until(value => value.active === 1);
  const queued = post("<p>must never render</p>", queuedAbort.signal).catch(error => error);
  const remaining = post("<p>remaining admitted request</p>");
  await until(value => value.queued === 2);
  const overflow = await post("<p>overflow</p>");
  assert.equal(overflow.status, 503);
  assert.equal(overflow.headers.get("retry-after"), "1");
  receipt.overflow = { status: overflow.status, retryAfter: "1" };
  queuedAbort.abort();
  assert.equal((await queued).name, "AbortError");
  await until(value => value.queued === 1 && value.active === 1);
  activeAbort.abort();
  assert.equal((await active).name, "AbortError");
  assert.equal((await remaining).status, 200);
  receipt.final = (await until(value => value.active === 0 && value.queued === 0)).admission;
  receipt.queuedCancellation = "pass";
  receipt.activeCancellation = "pass";
  receipt.status = "passed";
} finally {
  activeAbort.abort(); queuedAbort.abort();
  await writeFile(process.argv[2], JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
