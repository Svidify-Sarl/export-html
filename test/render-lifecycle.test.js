const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createRenderLifecycle, positiveDuration, waitForPrintResources } = require("../src/utils/render-lifecycle");

function fixture(newPage) {
  const ctx = { req: new EventEmitter(), res: new EventEmitter() };
  let closes = 0;
  const page = { close: async () => { closes++; }, setDefaultNavigationTimeout() {}, setDefaultTimeout() {} };
  const render = createRenderLifecycle({ getBrowser: async () => ({
    createBrowserContext: async () => ({ newPage: newPage || (async () => page), close: () => page.close() }),
  }), durationMs: 30 });
  return { ctx, page, render, closes: () => closes };
}

test("rejects disabled, negative and non-integer duration", () => {
  for (const duration of [0, -1, NaN, 1.5, Infinity]) assert.throws(() => positiveDuration(duration, 60000));
});

test("successful and failing operations close their page and detach listeners", async () => {
  for (const fails of [false, true]) {
    const f = fixture();
    const result = f.render(f.ctx, async () => { if (fails) throw new Error("failed"); return "pdf"; });
    if (fails) await assert.rejects(result, /failed/); else assert.equal(await result, "pdf");
    assert.equal(f.closes(), 1);
    assert.equal(f.ctx.req.listenerCount("aborted"), 0);
    assert.equal(f.ctx.res.listenerCount("close"), 0);
  }
});

test("finite deadline closes a hung render", async () => {
  const f = fixture();
  await assert.rejects(f.render(f.ctx, () => new Promise(() => {})), { status: 504 });
  assert.equal(f.closes(), 1);
});

test("client disconnect closes active page without waiting for PDF timeout", async () => {
  const f = fixture();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const result = f.render(f.ctx, () => { started(); return new Promise(() => {}); });
  await ready;
  f.ctx.res.emit("close");
  await assert.rejects(result, { status: 499 });
  assert.equal(f.closes(), 1);
});

test("abort during page creation closes the late page and never renders it", async () => {
  let resolvePage;
  let invoked = false;
  const f = fixture(() => new Promise(resolve => { resolvePage = resolve; }));
  const result = f.render(f.ctx, () => { invoked = true; });
  await new Promise(resolve => setImmediate(resolve));
  f.ctx.req.emit("aborted");
  await assert.rejects(result, { status: 499 });
  resolvePage(f.page);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.closes(), 1);
  assert.equal(invoked, false);
});

test("failed resources cannot silently become an incomplete successful PDF", async () => {
  await assert.rejects(waitForPrintResources({ evaluate: async () => ({ brokenImages: 1, failedFonts: 0 }) }), { status: 422 });
  await waitForPrintResources({ evaluate: async () => ({ brokenImages: 0, failedFonts: 0 }) });
});

test("stalled page cleanup recycles the owning browser within a finite cleanup deadline", async () => {
  const ctx = { req: new EventEmitter(), res: new EventEmitter() };
  let killed = false;
  let disconnected = false;
  const page = { close: () => new Promise(() => {}), setDefaultNavigationTimeout() {}, setDefaultTimeout() {} };
  const render = createRenderLifecycle({ durationMs: 1000, cleanupMs: 10, getBrowser: async () => ({
    createBrowserContext: async () => ({ newPage: async () => page, close: () => page.close() }),
    process: () => ({ kill: signal => { assert.equal(signal, "SIGKILL"); killed = true; } }),
    disconnect: () => { disconnected = true; },
  }) });
  await assert.rejects(render(ctx, async () => "pdf"), { status: 503 });
  assert.equal(killed, true);
  assert.equal(disconnected, true);
});

test("abort during context creation awaits and closes the late context before returning", async () => {
  const ctx = { req: new EventEmitter(), res: new EventEmitter() };
  let resolveContext;
  let closes = 0;
  let rendered = false;
  const render = createRenderLifecycle({ getBrowser: async () => ({
    createBrowserContext: () => new Promise(resolve => { resolveContext = resolve; }),
  }) });
  const call = render(ctx, async () => { rendered = true; });
  await new Promise(resolve => setImmediate(resolve));
  ctx.res.emit("close");
  resolveContext({ close: async () => { closes++; }, newPage: async () => { throw new Error("cancelled context must not create a page"); } });
  await assert.rejects(call, { status: 499 });
  assert.equal(closes, 1);
  assert.equal(rendered, false);
});

test("hung context creation also recycles the browser within cleanup deadline", async () => {
  const ctx = { req: new EventEmitter(), res: new EventEmitter() };
  let killed = false;
  const render = createRenderLifecycle({ durationMs: 10, cleanupMs: 10, getBrowser: async () => ({
    createBrowserContext: () => new Promise(() => {}),
    process: () => ({ kill: () => { killed = true; } }), disconnect() {},
  }) });
  await assert.rejects(render(ctx, async () => {}), { status: 503 });
  assert.equal(killed, true);
});
