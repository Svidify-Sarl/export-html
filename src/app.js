const Router = require("@koa/router");
const Koa = require("koa");
const bodyParser = require("koa-body").default;
const errorHandler = require("./utils/middleware/error-handler");
const { createBearerAuth } = require("./utils/middleware/bearer-auth");
const requestLogger = require("./utils/middleware/request-logger");
const { validateBody } = require("./utils/middleware/validate");
const { createConversionAdmission } = require("./utils/conversion-admission");
const admission = createConversionAdmission({
  concurrency: process.env.EXPORT_HTML_MAX_CONCURRENT,
  queueLimit: process.env.EXPORT_HTML_MAX_QUEUED,
  waitMs: process.env.EXPORT_HTML_QUEUE_WAIT_MS,
});

const { getBrowser, getPageCount, getBrowserPid } = require("./utils/browser");
const { createResourceMeter } = require("./utils/resource-meter");
const resourceMeter = createResourceMeter({ getBrowserPid });
resourceMeter.start();
const { createRenderLifecycle, waitForPrintResources } = require("./utils/render-lifecycle");
const render = createRenderLifecycle({ getBrowser, durationMs: process.env.EXPORT_HTML_MAX_DURATION_MS });
const yd = require("@bedrockio/yada");

function urlCustom(value, { root }) {
  if ((value && root.html) || (!value && !root.html)) {
    throw new Error("Either url or html is required");
  }
}

function htmlCustom(value, { root }) {
  if ((value && root.url) || (!value && !root.url)) {
    throw new Error("Either url or html is required");
  }
}

async function requireSource(ctx, next) {
  const { html, url } = ctx.request.body;
  if ((!html && !url) || (html && url)) {
    ctx.throw(400, "Exactly one of html or url is required");
  }
  await next();
}

const app = new Koa();
const sourceRevision = /^[a-f0-9]{40}$/.test(process.env.EXPORT_HTML_SOURCE_REVISION || "") ? process.env.EXPORT_HTML_SOURCE_REVISION : null;
app.use(async (ctx, next) => {
  if (sourceRevision) {
    ctx.set("X-Converter-Revision", sourceRevision);
  }
  await next();
});

app
  .use(errorHandler)
  .use(requestLogger)
  .use(createBearerAuth(process.env.EXPORT_HTML_BEARER_TOKEN))
  .use(admission.middleware)
  .use(bodyParser({ multipart: true }));

const router = new Router();
app.router = router;

router.get("/", (ctx) => {
  ctx.body = {
    servedAt: new Date(),
  };
});

router.get("/check-status", async (ctx) => {
  ctx.body = {
    pageCount: await getPageCount(),
  };
});

// Protected by the same bearer policy as conversions; public health remains small.
router.get("/1/resources", async (ctx) => {
  ctx.body = { ...(await resourceMeter.status()), admission: admission.status(), sourceRevision };
});

// https://pptr.dev/#?product=Puppeteer&version=v8.0.0&show=api-pagescreenshotoptions
router.post(
  "/1/screenshot",
  validateBody({
    url: yd.custom(urlCustom),
    html: yd.string().custom(htmlCustom),
    export: yd
      .object({
        scale: yd.number().min(0.1).max(2).default(1),
        type: yd.string().allow("jpeg", "png", "webp").default("png"),
        quality: yd.number().min(0).max(100).default(100),
        fullPage: yd.boolean().default(true),
        clip: yd.object({
          x: yd.number(),
          y: yd.number(),
          width: yd.number(),
          height: yd.number(),
        }),
        omitBackground: yd.boolean().default(false),
        encoding: yd.string().allow("base64", "binary").default("binary"),
      })
      .default({
        scale: 1,
        type: "png",
        quality: 100,
        fullPage: true,
        omitBackground: false,
        encoding: "binary",
      }),
  }),
  requireSource,
  async (ctx) => {
    const body = ctx.request.body;
    ctx.body = await render(ctx, async (page) => {
      if (body.url) {
        await page.goto(body.url, { waitUntil: "load" });
      } else {
        await page.setContent(body.html, { waitUntil: "load" });
      }
      const options = body.export;
      if (options.type === "png") {
        delete options.quality;
      }
      ctx.response.set("content-type", `image/${options.type}`);
      const screenshot = await page.screenshot(options);
      return Buffer.from(screenshot);
    });
  }
);

// https://pptr.dev/#?product=Puppeteer&version=v8.0.0&show=api-pagepdfoptions
router.post(
  "/1/pdf",
  validateBody({
    url: yd.custom(urlCustom),
    html: yd.string().custom(htmlCustom),
    export: yd.object({
      scale: yd.number().default(1),
      displayHeaderFooter: yd.boolean().default(true),
      headerTemplate: yd.string(),
      footerTemplate: yd.string(),
      timeout: yd.number().min(1).default(30000),
      omitBackground: yd.boolean().default(false),
      printBackground: yd.boolean().default(false),
      outline: yd.boolean().default(false),
      landscape: yd.boolean().default(false),
      pageRanges: yd.string(),
      width: yd.string(),
      height: yd.string(),
      format: yd
        .string()
        .allow(
          "Letter",
          "Legal",
          "Tabloid",
          "Ledger",
          "A0",
          "A1",
          "A2",
          "A3",
          "A4",
          "A5",
          "A6"
        )
        .default("Letter"),
      margin: yd.object({
        top: yd.string(),
        right: yd.string(),
        bottom: yd.string(),
        left: yd.string(),
      }),
      preferCSSPageSize: yd.boolean().default(false),
    }),
  }),
  requireSource,
  async (ctx) => {
    const body = ctx.request.body;
    ctx.body = await render(ctx, async (page, maximumDuration) => {
      if (body.url) {
        await page.goto(body.url, { waitUntil: "load" });
      } else {
        await page.setContent(body.html, { waitUntil: "load" });
      }
      await waitForPrintResources(page);
      const pdf = await page.pdf({ ...body.export, timeout: Math.min(body.export.timeout, maximumDuration) });
      ctx.type = "application/pdf";
      return Buffer.from(pdf);
    });
  }
);

app.use(router.routes());
app.use(router.allowedMethods());

app.on("error", (err, _ctx) => {
  // dont output stacktraces of errors that is throw with status as they are known
  if (!err.status || err.status === 500) {
    console.error(
      JSON.stringify({
        event: "application_error",
        message: err.message,
        stack: err.stack,
      })
    );
  }
});

module.exports = app;
