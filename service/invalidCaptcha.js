const { delay } = require("./delay");

const verifyCaptcha = async (page) => {
  await delay(1000);
  await page.waitForSelector("#validateError");

  const isModalVisible = await page.evaluate(() => {
    const modal = document.getElementById("validateError");
    return modal && modal.style.display === "block";
  });

  if (isModalVisible) {
    return { status: false, message: "inValidCaptcha" };
  } else {
    return { status: true, message: "validCaptcha" };
  }
};

module.exports = { verifyCaptcha };
