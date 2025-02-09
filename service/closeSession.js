const { delay } = require("./delay");


const closeSeccssionAlelrt = async (page) => {
  await delay(900);
  await page.waitForSelector("#validateError");

  const isModalVisible = await page.evaluate(() => {
    const modal = document.getElementById("validateError");
    return modal && modal.style.display === "block";
  });

  if (isModalVisible) {
    await page.evaluate(() => {
      closeModel({ modal_id: "validateError" });
    });
  }
};

module.exports = {closeSeccssionAlelrt}