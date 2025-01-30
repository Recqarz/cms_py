const { handleCNRScrap } = require("./controller");

const allRoute = require("express").Router();

allRoute.post("/get_case_details_status", handleCNRScrap);

module.exports = { allRoute };
