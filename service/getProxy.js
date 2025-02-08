const { logger } = require("../logger/logger");
require("dotenv").config()

const getProxy = async () => {
  try {
    const socksProxy = process.env.PROXY || null
    return socksProxy
  } catch (err) {
    // console.error("Error fetching proxy:", err);
    logger.error(`Error fetching proxy:`, err)
    throw err;
  }
};

module.exports = {getProxy}