const { handleCNRScrap } = require("./controller");
const { handleupdatecnr } = require("./update");

const allRoute = require("express").Router();

allRoute.post("/get_case_details_status", handleCNRScrap);


allRoute.post("/get_case_details_update", handleupdatecnr)
module.exports = { allRoute };
