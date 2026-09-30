const crypto = require("node:crypto");

const UNPROTECTED_PATHS = new Set(["/", "/check-status"]);

function tokensMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual || "");
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function createBearerAuth(expectedToken) {
  if (!expectedToken) {
    throw new Error("EXPORT_HTML_BEARER_TOKEN must be configured");
  }
  if (Buffer.byteLength(expectedToken) < 32) {
    throw new Error("EXPORT_HTML_BEARER_TOKEN must be at least 32 bytes");
  }

  return async function bearerAuth(ctx, next) {
    if (UNPROTECTED_PATHS.has(ctx.path)) {
      await next();
      return;
    }

    const authorization = ctx.get("authorization");
    const prefix = "Bearer ";
    const actualToken = authorization.startsWith(prefix)
      ? authorization.slice(prefix.length)
      : "";

    if (!tokensMatch(actualToken, expectedToken)) {
      ctx.status = 401;
      ctx.set("www-authenticate", "Bearer");
      ctx.body = { error: "Unauthorized" };
      return;
    }

    await next();
  };
}

exports.createBearerAuth = createBearerAuth;
