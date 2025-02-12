const express = require("express");
const { cnrDetailsUpdateCrawler } = require("../utils/cnrDetailsUpdateCrawler");
const { logger } = require("../logger/logger");

const updateCnrDetailsRoute = express.Router();

updateCnrDetailsRoute.post("/update-cnr-details", async (req, res) => {
  try {
    const { cnr_number, next_hearing_date } = req.body;

    if (!cnr_number || typeof cnr_number !== "string") {
      return res
        .status(400)
        .json({ error: "Please provide a valid CNR number." });
    }

    if (!next_hearing_date || typeof next_hearing_date !== "string") {
      return res
        .status(400)
        .json({ error: "Please provide a valid Next Hearing Date." });
    }

    let payload = {
      cnrNumber: cnr_number,
      next_hearing_date: next_hearing_date,
    };

    let attempts = 0;
    let maxAttempts = 9999;
    let response;

    while (attempts < maxAttempts) {
      response = await cnrDetailsUpdateCrawler(payload);
      logger.info(`Attempt ${attempts + 1}:`, response);

      if (
        response.message == "captchaNotFound" ||
        response.message == "inValidCaptcha" ||
        response.message ==
          "Waiting for selector `table.case_details_table` failed: Waiting failed: 4000ms exceeded"
      ) {
        attempts++;
      } else {
        return res.status(200).json(response.cnrDetails);
      }
    }

    return res
      .status(500)
      .json({ status: false, message: "Failed after 20 attempts." });
  } catch (err) {
    logger.error("err:", err.message);
    return res.status(500).json({ status: false, message: `${err.message}` });
  }
});

module.exports = { updateCnrDetailsRoute };
