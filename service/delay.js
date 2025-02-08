const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (str) => str.replace(/\s+/g, "").toLowerCase();

module.exports = {delay, normalize}