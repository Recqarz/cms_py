const { logger } = require("../logger/logger");

// Month Mapping for Better Parsing
const monthMap = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

// Removes ordinal suffixes (st, nd, rd, th) from dates
function sanitizeDateString(next_hearing_date) {
  if (typeof next_hearing_date !== "string") {
    logger.error("Received invalid input:", next_hearing_date);
    return { status: false, message: "next_hearing_date must be a string" };
  }
  
  const sanitizedStr = next_hearing_date.replace(/(\d+)(st|nd|rd|th)/g, "$1");
  return { status: true, sanitizedStr };
}

// Formats date into "DD-MM-YYYY"
function formatDate(next_hearing_date) {
  if (typeof next_hearing_date !== "string") {
    console.error("formatDate received non-string input:", next_hearing_date);
    throw new Error("Invalid input: next_hearing_date must be a string");
  }

  const sanitizedResult = sanitizeDateString(next_hearing_date);
  if (!sanitizedResult.status) {
    return sanitizedResult;
  }

  const sanitizedDateStr = sanitizedResult.sanitizedStr;
  // console.log("Sanitized Date String:", sanitizedDateStr);

  // Split into components (Expected: "28 January 2025")
  const parts = sanitizedDateStr.split(" ");
  if (parts.length !== 3) {
    console.error("Invalid date format:", sanitizedDateStr);
    throw new Error("Invalid date format");
  }

  let [day, monthName, year] = parts;
  day = parseInt(day, 10);
  year = parseInt(year, 10);

  // Check if the month is valid
  if (!monthMap[monthName]) {
    console.error("Invalid month in date:", monthName);
    throw new Error("Invalid month in date");
  }

  const month = monthMap[monthName];

  // Validate Day & Month Combination (Ensures real calendar dates)
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    console.error(`Invalid day (${day}) for ${monthName} ${year}`);
    throw new Error(`Invalid day for ${monthName}`);
  }

  // Format as "DD-MM-YYYY"
  const formattedDay = String(day).padStart(2, "0");
  const formattedMonth = String(month).padStart(2, "0");

  // console.log("Formatted Date:", `${formattedDay}-${formattedMonth}-${year}`);
  return `${formattedDay}-${formattedMonth}-${year}`;
}

module.exports = { formatDate, sanitizeDateString };
