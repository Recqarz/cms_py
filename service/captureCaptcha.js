const path = require("path");

async function captureCaptcha(page) {
  const captchaElement = await page.$("#captcha_image");

  const uid = Date.now();
  const captchaPath = path.join(__dirname, `captcha_${uid}.png`);

  await captchaElement.screenshot({ path: captchaPath });
  return captchaPath;
}

module.exports = {captureCaptcha}