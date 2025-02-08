const fs = require("fs");
const path = require("path");
const { logger } = require("../logger/logger");

function createDirectoryStructure(basePath, cnrNumber) {
  const intrimFolder = path.join(basePath, "intrim_orders");
  if (!fs.existsSync(intrimFolder)) {
    fs.mkdirSync(intrimFolder, { recursive: false });
  }

  const cnrDirectory = path.join(intrimFolder, cnrNumber);
  if (!fs.existsSync(cnrDirectory)) {
    fs.mkdirSync(cnrDirectory, { recursive: true });
    return { cnrDirectory, cnrExists: false };
  }
  return { cnrDirectory, cnrExists: true };
}

async function deleteUploadedPdf(cnrDirectory) {
  if (fs.existsSync(cnrDirectory)) {
    fs.rmSync(cnrDirectory, { recursive: true, force: true });
  } else {
    logger.info(`No existing directory found for: ${cnrDirectory}`);
  }
}

module.exports = { createDirectoryStructure, deleteUploadedPdf };
