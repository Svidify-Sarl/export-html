const assert = require("node:assert/strict");
const test = require("node:test");
const { createResourceMeter, resolveMemoryCgroup } = require("../src/utils/resource-meter");

test("cgroup resolver reads the process leaf rather than an ancestor or host aggregate", () => {
  assert.deepEqual(resolveMemoryCgroup("0::/docker/fixture", "12 10 0:20 / /sys/fs/cgroup rw - cgroup2 cgroup rw"),
    { version: 2, directory: "/sys/fs/cgroup/docker/fixture" });
  assert.deepEqual(resolveMemoryCgroup("0::/", "12 10 0:20 /docker/fixture /sys/fs/cgroup rw - cgroup2 cgroup rw"),
    { version: 2, directory: "/sys/fs/cgroup" });
  assert.deepEqual(resolveMemoryCgroup("4:memory:/docker/fixture", "12 10 0:20 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory"),
    { version: 1, directory: "/sys/fs/cgroup/memory/docker/fixture" });
  assert.equal(resolveMemoryCgroup("0::/../../unknown", "12 10 0:20 / /sys/fs/cgroup rw - cgroup2 cgroup rw"), null);
});

test("resource peaks retain exact bytes and distinguish sampled from kernel lifetime measurements", async () => {
  let call = 0;
  const meter = createResourceMeter({ getBrowserPid: () => 123, collect: async () => ({
    chromiumPssBytes: ++call === 1 ? 1024 : 512,
    chromiumRssBytes: call === 1 ? 2048 : 768,
    cgroupKernelPeakBytes: 4096,
    cgroupLimitBytes: 8192,
  }) });
  await meter.status();
  const status = await meter.status();
  assert.equal(status.latest.chromiumPssBytes, 512);
  assert.equal(status.sampledPeaks.chromiumPssBytes, 1024);
  assert.equal(status.sampledPeaks.cgroupKernelPeakBytes, 4096);
  assert.equal(status.sampledPeaks.cgroupLimitBytes, undefined);
  assert.equal(status.samples, 2);
});

test("unavailable process metrics are not falsely reported as zero", async () => {
  const meter = createResourceMeter({ getBrowserPid: () => undefined, collect: async () => ({ chromiumPssBytes: null }) });
  const status = await meter.status();
  assert.equal(status.latest.chromiumPssBytes, null);
  assert.equal(status.sampledPeaks.chromiumPssBytes, undefined);
  assert.equal(status.incompleteChromiumSamples, 1);
});
