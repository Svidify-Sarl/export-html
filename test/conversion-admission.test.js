const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createConversionAdmission } = require("../src/utils/conversion-admission");

function context(path = "/1/pdf") {
  return { method: "POST", path, req: new EventEmitter(), res: new EventEmitter(), set() {} };
}
function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

test("only measured configured concurrency runs, queued work is bounded and FIFO", async () => {
  const admission = createConversionAdmission({ concurrency: 1, queueLimit: 2 });
  const firstDone = deferred();
  const entered = [];
  const first = admission.middleware(context(), async () => { entered.push(1); await firstDone.promise; });
  const second = admission.middleware(context(), async () => { entered.push(2); });
  const third = admission.middleware(context(), async () => { entered.push(3); });
  const fourth = context();
  let retry;
  fourth.set = (_, value) => { retry = value; };
  await assert.rejects(admission.middleware(fourth, async () => {}), { status: 503 });
  assert.equal(retry, "1");
  assert.equal(admission.status().active, 1);
  assert.equal(admission.status().queued, 2);
  assert.deepEqual(entered, [1]);
  firstDone.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(entered, [1, 2, 3]);
  assert.equal(admission.status().active, 0);
  assert.equal(admission.status().queued, 0);
});

test("queued disconnect removes its payload-free wait and never starts work", async () => {
  const admission = createConversionAdmission();
  const activeDone = deferred();
  const active = admission.middleware(context(), () => activeDone.promise);
  const waitingContext = context();
  let started = false;
  const queued = admission.middleware(waitingContext, async () => { started = true; });
  waitingContext.res.emit("close");
  await assert.rejects(queued, { status: 499 });
  assert.equal(admission.status().queued, 0);
  activeDone.resolve(); await active;
  assert.equal(started, false);
  assert.equal(waitingContext.req.listenerCount("aborted"), 0);
});

test("queue timeout and operation failure release all admission state", async () => {
  const admission = createConversionAdmission({ waitMs: 10 });
  const activeDone = deferred();
  const active = admission.middleware(context(), () => activeDone.promise);
  await assert.rejects(admission.middleware(context(), async () => {}), { status: 504 });
  activeDone.resolve(); await active;
  await assert.rejects(admission.middleware(context(), async () => { throw new Error("render failed"); }), /render failed/);
  assert.equal(admission.status().active, 0);
  assert.equal(admission.status().queued, 0);
});

test("health and diagnostics bypass admission even while conversion is active", async () => {
  const admission = createConversionAdmission();
  const activeDone = deferred();
  const active = admission.middleware(context(), () => activeDone.promise);
  let entered = false;
  await admission.middleware(context("/check-status"), async () => { entered = true; });
  assert.equal(entered, true);
  activeDone.resolve(); await active;
});
