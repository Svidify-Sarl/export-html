/* global document */
function positiveDuration(value, fallback) {
  const duration = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new Error("Render duration must be a positive integer in milliseconds");
  }
  return duration;
}

function createRenderLifecycle({ getBrowser, durationMs = 60000, cleanupMs = 3000 }) {
  const maximumDuration = positiveDuration(durationMs, 60000);
  const maximumCleanup = positiveDuration(cleanupMs, 3000);
  return async function render(ctx, operation) {
    let page;
    let browser;
    let context;
    let creatingContext;
    let closePromise;
    let stopped;
    let rejectStop;
    const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
    const closePage = () => {
      if ((context || page || creatingContext) && !closePromise) closePromise = (async () => {
        let cleanupTimer;
        try {
          await Promise.race([
            (async () => {
              if (!context && creatingContext) await creatingContext;
              if (context) await context.close(); else if (page) await page.close();
            })(),
            new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error("Page cleanup stalled")), maximumCleanup); }),
          ]);
        } catch {
          // A wedged shared browser cannot safely retain abandoned pages. Its
          // owning process is killed; the manager reconnects by launching anew.
          const child = browser?.process();
          if (child) child.kill("SIGKILL");
          browser?.disconnect();
          throw Object.assign(new Error("Conversion browser was recycled after failed page cleanup"), { status: 503 });
        } finally { clearTimeout(cleanupTimer); }
      })();
      return closePromise;
    };
    const stop = (status, message) => {
      if (stopped) return;
      stopped = Object.assign(new Error(message), { status });
      rejectStop(stopped);
      closePage();
    };
    const abort = () => stop(499, "Conversion cancelled after client disconnect");
    const responseClosed = () => { if (!ctx.res.writableEnded) abort(); };
    ctx.req.once("aborted", abort);
    ctx.res.once("close", responseClosed);
    const timer = setTimeout(() => stop(504, "Conversion exceeded its finite deadline"), maximumDuration);
    const work = (async () => {
      if (ctx.req.aborted || ctx.res.destroyed) abort();
      if (stopped) throw stopped;
      browser = await getBrowser();
      if (stopped) throw stopped;
      creatingContext = browser.createBrowserContext().then(created => { context = created; return created; });
      context = await creatingContext;
      if (stopped) { await closePage(); throw stopped; }
      page = await context.newPage();
      // A page created after an abort must also be closed, without starting work.
      if (stopped) { await closePage(); throw stopped; }
      page.setDefaultNavigationTimeout(Math.min(30000, maximumDuration));
      page.setDefaultTimeout(Math.min(30000, maximumDuration));
      return operation(page, maximumDuration);
    })();
    try {
      return await Promise.race([work, stopPromise]);
    } finally {
      clearTimeout(timer);
      ctx.req.removeListener("aborted", abort);
      ctx.res.removeListener("close", responseClosed);
      await closePage();
    }
  };
}

async function waitForPrintResources(page) {
  const resources = await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(images.map(async (image) => {
      try { await image.decode(); } catch { /* Count broken images below. */ }
    }));
    return {
      brokenImages: images.filter(image => !image.complete || image.naturalWidth === 0).length,
      failedFonts: Array.from(document.fonts).filter(font => font.status === "error").length,
    };
  });
  if (resources.brokenImages || resources.failedFonts) {
    throw Object.assign(new Error("Document images or fonts failed to load"), { status: 422 });
  }
}

module.exports = { createRenderLifecycle, positiveDuration, waitForPrintResources };
