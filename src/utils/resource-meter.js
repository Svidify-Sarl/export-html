const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function resolveMemoryCgroup(groups, mounts) {
  for (const line of groups.trim().split("\n")) {
    const [hierarchy, controllers, group] = line.split(":");
    if (!group?.startsWith("/") || group.split("/").includes("..")) continue;
    const version = hierarchy === "0" && controllers === "" ? 2 : controllers?.split(",").includes("memory") ? 1 : null;
    if (!version) continue;
    for (const mount of mounts.trim().split("\n")) {
      const [before, after] = mount.split(" - ");
      if (!after) continue;
      const fields = before.split(" ");
      const [filesystem, , options] = after.split(" ");
      if (version === 2 ? filesystem !== "cgroup2" : filesystem !== "cgroup" || !options?.split(",").includes("memory")) continue;
      const root = fields[3];
      const mountPoint = fields[4];
      if (!root || !mountPoint) continue;
      let relative;
      if (group === "/" || group === root) relative = "";
      else if (root === "/") relative = group.slice(1);
      else if (group.startsWith(`${root}/`)) relative = group.slice(root.length + 1);
      else relative = group.slice(1); // path relative to a private cgroup namespace
      return { version, directory: path.posix.join(mountPoint, relative) };
    }
  }
  return null;
}

async function numericFile(path) {
  try {
    const value = (await fs.readFile(path, "utf8")).trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  } catch { return null; }
}

async function collectResources(browserPid) {
  const [groups, mounts] = await Promise.all([
    fs.readFile("/proc/self/cgroup", "utf8").catch(() => ""),
    fs.readFile("/proc/self/mountinfo", "utf8").catch(() => ""),
  ]);
  const memoryGroup = resolveMemoryCgroup(groups, mounts);
  const memoryFile = name => memoryGroup ? path.posix.join(memoryGroup.directory, name) : "/nonexistent-converter-memory-cgroup";
  const cgroup = await Promise.all([
    numericFile(memoryFile(memoryGroup?.version === 2 ? "memory.current" : "memory.usage_in_bytes")),
    numericFile(memoryFile(memoryGroup?.version === 2 ? "memory.peak" : "memory.max_usage_in_bytes")),
    numericFile(memoryFile(memoryGroup?.version === 2 ? "memory.max" : "memory.limit_in_bytes")),
  ]);
  const v2Limit = await fs.readFile(memoryFile(memoryGroup?.version === 2 ? "memory.max" : "memory.limit_in_bytes"), "utf8").then(value => value.trim()).catch(() => null);
  const actualLimit = cgroup[2];
  const limitState = v2Limit === "max" || (actualLimit !== null && actualLimit > 2 ** 60)
    ? "unlimited" : actualLimit !== null ? "finite" : "unavailable";
  const currentBytes = cgroup[0];
  let chromiumRssBytes = null;
  let chromiumPssBytes = null;
  let chromiumProcesses = null;
  if (process.platform === "linux" && browserPid) {
    try {
      const ids = (await fs.readdir("/proc")).filter(id => /^\d+$/.test(id));
      const statuses = await Promise.all(ids.map(async id => {
        try {
          const status = await fs.readFile(`/proc/${id}/status`, "utf8");
          return { id: Number(id), parent: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]), exited: /^State:\s+[ZX]/m.test(status) };
        } catch { return null; }
      }));
      const descendants = new Set([browserPid]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const entry of statuses) {
          if (entry && descendants.has(entry.parent) && !descendants.has(entry.id)) {
            descendants.add(entry.id); expanded = true;
          }
        }
      }
      // Exited/zombie processes have no resident userspace mappings. Their
      // unreadable smaps must not hide valid measurements of the live tree.
      const live = [...descendants].filter(id => !statuses.find(entry => entry?.id === id)?.exited);
      const measurements = await Promise.all(live.map(async id => {
        try {
          const memory = await fs.readFile(`/proc/${id}/smaps_rollup`, "utf8");
          const rss = memory.match(/^Rss:\s+(\d+)\s+kB/m);
          const pss = memory.match(/^Pss:\s+(\d+)\s+kB/m);
          return rss && pss ? { rss: Number(rss[1]) * 1024, pss: Number(pss[1]) * 1024 } : null;
        } catch { return null; }
      }));
      // A disappearing/unreadable process makes this sample incomplete, not zero.
      if (measurements.length && measurements.every(Boolean)) {
        chromiumRssBytes = measurements.reduce((sum, memory) => sum + memory.rss, 0);
        chromiumPssBytes = measurements.reduce((sum, memory) => sum + memory.pss, 0);
        chromiumProcesses = measurements.length;
      }
    } catch { /* Unsupported/unreadable process metrics remain null. */ }
  }
  return {
    observedUtc: new Date().toISOString(),
    nodeRssBytes: process.memoryUsage().rss,
    chromiumRssBytes, chromiumPssBytes, chromiumProcesses,
    cgroupCurrentBytes: currentBytes,
    cgroupKernelPeakBytes: cgroup[1],
    cgroupLimitBytes: limitState === "finite" ? actualLimit : null,
    cgroupLimitState: limitState,
    cgroupHeadroomBytes: limitState === "finite" && currentBytes !== null ? Math.max(0, actualLimit - currentBytes) : null,
    hostTotalMemoryBytes: os.totalmem(),
    hostFreeMemoryBytes: os.freemem(),
    cgroupVersion: memoryGroup?.version ?? null,
    memoryCgroupScope: memoryGroup ? "resolved from process cgroup and mounted controller" : "unavailable",
  };
}

function createResourceMeter({ getBrowserPid, collect = collectResources, intervalMs = 100 }) {
  let sampling;
  let timer;
  const peaks = {};
  let samples = 0;
  let incompleteChromiumSamples = 0;
  let latest;
  async function sample() {
    if (!sampling) {
      sampling = collect(getBrowserPid()).then(measurement => {
        latest = measurement; samples++;
        if (measurement.chromiumPssBytes === null) incompleteChromiumSamples++;
        for (const [key, value] of Object.entries(measurement)) {
          if (["nodeRssBytes", "chromiumRssBytes", "chromiumPssBytes", "cgroupCurrentBytes", "cgroupKernelPeakBytes"].includes(key) && typeof value === "number") {
            peaks[key] = Math.max(peaks[key] ?? 0, value);
          }
        }
      }).finally(() => { sampling = undefined; });
    }
    await sampling;
  }
  return {
    start() {
      if (!timer) { timer = setInterval(() => { sample().catch(() => {}); }, intervalMs); timer.unref(); }
    },
    stop() { clearInterval(timer); timer = undefined; },
    async status() {
      await sample();
      return {
        scope: "this converter process and container lifetime",
        sampleIntervalMs: intervalMs, samples, incompleteChromiumSamples, latest, sampledPeaks: { ...peaks },
        interpretation: "Chromium RSS sums shared pages; PSS apportions shared pages. Process peaks are sampled; cgroupKernelPeakBytes is the kernel container lifetime high-water mark. Missing metrics are null or absent, never zero. No capacity limit is inferred.",
      };
    },
  };
}

module.exports = { collectResources, createResourceMeter, resolveMemoryCgroup };
