const app = require("./app");

const { getBrowser } = require("./utils/browser");

const PORT = Number(process.env.BIND_PORT || process.env.PORT || 2305);
const HOST = process.env.BIND_HOST || "0.0.0.0";

module.exports = (async () => {
  await getBrowser();

  app.listen(PORT, HOST, () => {
    console.info(
      JSON.stringify({ event: "server_started", host: HOST, port: PORT })
    );
  });
  return app;
})();
