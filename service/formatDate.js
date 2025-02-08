const { logger } = require("../logger/logger");

function sanitizeDateString(next_hearing_date) {
  if (typeof next_hearing_date !== "string") {
    logger.error("Received invalid input:", next_hearing_date);
    return { status: false, message: "next_hearing_date must be a string" };
  }
  return next_hearing_date.replace(/(\d+)(st|nd|rd|th)/g, "$1");
}

function formatDate(next_hearing_date) {
  if (typeof next_hearing_date !== "string") {
    console.error("formatDate received non-string input:", next_hearing_date);
    throw new Error("Invalid input: next_hearing_date must be a string");
  }

  const sanitizedDateStr = sanitizeDateString(next_hearing_date);
  if (!sanitizedDateStr?.status) {
    return sanitizedDateStr;
  }
  const parsedDate = new Date(sanitizedDateStr);

  if (isNaN(parsedDate.getTime())) {
    console.error("Unable to parse date:", sanitizedDateStr);
    throw new Error("Invalid date format");
  }

  const day = String(parsedDate.getDate()).padStart(2, "0");
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const year = parsedDate.getFullYear();

  return `${day}-${month}-${year}`;
}

module.exports = { formatDate, sanitizeDateString };
