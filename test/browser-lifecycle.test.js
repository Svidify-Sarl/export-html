const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createBrowserManager } = require("../src/utils/browser");

test("simultaneous first renders launch one shared Chromium and recover after disconnect", async () => {
  let launches = 0;
  const manager = createBrowserManager(async () => {
    launches++;
    const browser = new EventEmitter();
    browser.connected = true;
    browser.process = () => ({ pid: 123 });
    return browser;
  });
  const browsers = await Promise.all(Array.from({ length: 5 }, () => manager.getBrowser()));
  assert.equal(launches, 1);
  assert.ok(browsers.every(browser => browser === browsers[0]));
  assert.equal(manager.getBrowserPid(), 123);
  browsers[0].connected = false;
  browsers[0].emit("disconnected");
  assert.notEqual(await manager.getBrowser(), browsers[0]);
  assert.equal(launches, 2);
});

test("failed launch can be retried without caching a rejected promise", async () => {
  let calls = 0;
  const manager = createBrowserManager(async () => {
    if (++calls === 1) throw new Error("launch failed");
    const browser = new EventEmitter();
    browser.connected = true;
    return browser;
  });
  await assert.rejects(manager.getBrowser(), /launch failed/);
  assert.ok(await manager.getBrowser());
  assert.equal(calls, 2);
});
