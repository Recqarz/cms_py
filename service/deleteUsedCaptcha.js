const fs = require("fs");
const { logger } = require("../logger/logger");

async function deleteUsedCaptcha(captchaPath) {
    console.log()
  fs.unlink(captchaPath, (err) => {
    if (err) {
      logger.error(`Error deleting captcha file: ${err}`);
    } else {
      logger.info(`Deleted captcha file: ${captchaPath}`);
    }
  });
}

module.exports = {deleteUsedCaptcha}