const Router = require("@koa/router");
const Koa = require("koa");
const bodyParser = require("koa-body").default;
const errorHandler = require("./utils/middleware/error-handler");
const { createBearerAuth } = require("./utils/middleware/bearer-auth");
const requestLogger = require("./utils/middleware/request-logger");
const { validateBody } = require("./utils/middleware/validate");

const { getBrowser, getPageCount } = require("./utils/browser");
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

app
  .use(errorHandler)
  .use(requestLogger)
  .use(createBearerAuth(process.env.EXPORT_HTML_BEARER_TOKEN))
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
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
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
      ctx.body = Buffer.from(screenshot);
    } finally {
      await page.close();
    }
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
      timeout: yd.number().default(30000),
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
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      if (body.url) {
        await page.goto(body.url, { waitUntil: "load" });
      } else {
        await page.setContent(body.html, { waitUntil: "load" });
      }
      const pdf = await page.pdf(body.export);
      ctx.type = "application/pdf";
      ctx.body = Buffer.from(pdf);
    } finally {
      await page.close();
    }
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
