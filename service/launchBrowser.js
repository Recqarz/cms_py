const puppeteer = require("puppeteer");
const proxyChain = require("proxy-chain");
const fs = require("fs");

const { logger } = require("../logger/logger");

const launchBrowser = async (proxy, headless = false) => {
    let executablePath;
  
    if (process.platform === "win32") {
      executablePath =
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    } else if (process.platform === "linux") {
      executablePath = "/usr/bin/google-chrome";
      const { spawn } = require("child_process");
  
      if (!fs.existsSync(executablePath)) {
        logger.info(`Google Chrome is not installed.`);
      }
  
      try {
        const xvfbProcess = spawn(
          "/usr/bin/Xvfb",
          [":99", "-screen", "0", "1280x720x24"],
          {
            stdio: "ignore",
            detached: true,
          }
        );
        xvfbProcess.unref();
        // console.log("Xvfb started successfully.");
      } catch (err) {
        // console.error("Failed to start Xvfb:", err.message);
        logger.error(`Failed to start Xvfb: ${err.message}`);
      }
  
      process.env.DISPLAY = ":99";
    } else {
      // throw new Error("Unsupported operating system");
      logger.error(`Unsupported operating system.`);
    }
    const anonymizedProxy = await proxyChain.anonymizeProxy(proxy);
    // console.log(`Using proxy: ${anonymizedProxy}`);
  
    return puppeteer.launch({
      headless,
      executablePath,
      args: [
        `--proxy-server=${anonymizedProxy}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-gpu",
        // "--headless",
      ],
    });
};

module.exports = {launchBrowser}