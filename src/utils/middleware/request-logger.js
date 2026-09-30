async function requestLogger(ctx, next) {
  const startedAt = Date.now();

  try {
    await next();
  } finally {
    console.info(
      JSON.stringify({
        event: "http_request",
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        durationMs: Date.now() - startedAt,
      })
    );
  }
}

module.exports = requestLogger;
