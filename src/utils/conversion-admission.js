function configuredInteger(value, fallback, minimum) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error("Invalid converter admission configuration");
  return result;
}

function createConversionAdmission({ concurrency, queueLimit, waitMs } = {}) {
  const limit = configuredInteger(concurrency, 1, 1);
  const maxQueue = configuredInteger(queueLimit, 2, 0);
  const maximumWait = configuredInteger(waitMs, 60000, 1);
  let active = 0;
  const queue = [];
  let rejected = 0;
  function lease() {
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true; active--;
      while (active < limit && queue.length) queue.shift().grant();
    };
  }
  async function acquire(ctx) {
    if (ctx.req.aborted || ctx.res.destroyed) throw Object.assign(new Error("Conversion request disconnected"), { status: 499 });
    if (active < limit) return lease();
    if (queue.length >= maxQueue) {
      rejected++;
      ctx.set("Retry-After", "1");
      throw Object.assign(new Error("Converter capacity is busy; retry later"), { status: 503 });
    }
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        ctx.req.removeListener("aborted", abort);
        ctx.res.removeListener("close", closed);
      };
      const fail = (status, message) => {
        if (finished) return;
        finished = true; cleanup();
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
        reject(Object.assign(new Error(message), { status }));
      };
      const abort = () => fail(499, "Queued conversion cancelled after client disconnect");
      const closed = () => { if (!ctx.res.writableEnded) abort(); };
      const entry = { grant() {
        if (finished) return;
        finished = true; cleanup(); resolve(lease());
      } };
      queue.push(entry);
      ctx.req.once("aborted", abort);
      ctx.res.once("close", closed);
      timer = setTimeout(() => fail(504, "Conversion queue wait exceeded its finite deadline"), maximumWait);
    });
  }
  return {
    async middleware(ctx, next) {
      if (ctx.method !== "POST" || !["/1/pdf", "/1/screenshot"].includes(ctx.path)) return next();
      const release = await acquire(ctx);
      try { await next(); } finally { release(); }
    },
    status() { return { active, queued: queue.length, rejected, concurrency: limit, queueLimit: maxQueue, queueWaitMs: maximumWait }; },
  };
}

module.exports = { createConversionAdmission };
