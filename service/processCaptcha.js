const tesseract = require("tesseract.js");
const { logger } = require("../logger/logger");

async function processCaptcha(captchaPath) {
  let attempts = 2;
  let captchaText = "";
  while (attempts > 0) {
    try {
      const {
        data: { text },
      } = await tesseract.recognize(captchaPath, "eng");

      captchaText = text.trim();

      if (captchaText) {
        return captchaText;
      }
    } catch (error) {
      logger.error(`Err processing captcha:`, error)
    }
    attempts--;
  }
  return "";
}

module.exports = {processCaptcha}