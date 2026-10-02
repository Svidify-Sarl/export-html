function createBrowserManager(launch) {
  let currentBrowser;
  let launching;
  return {
    async getBrowser() {
      if (currentBrowser?.connected) return currentBrowser;
      if (!launching) {
        launching = Promise.resolve().then(launch).then(browser => {
          currentBrowser = browser;
          browser.once("disconnected", () => {
            if (currentBrowser === browser) { currentBrowser = undefined; launching = undefined; }
          });
          return browser;
        }).catch(error => { launching = undefined; throw error; });
      }
      return launching;
    },
    getBrowserPid() { return currentBrowser?.process()?.pid; },
  };
}

const manager = createBrowserManager(() => require("puppeteer").launch({
  ...(process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD ? { executablePath: "/usr/bin/chromium-browser" } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
}));

exports.createBrowserManager = createBrowserManager;
exports.getBrowser = () => manager.getBrowser();
exports.getBrowserPid = () => manager.getBrowserPid();
exports.getPageCount = async () => (await manager.getBrowser()).pages().then(pages => pages.length);
