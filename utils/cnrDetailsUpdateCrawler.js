const { logger } = require("../logger/logger");
const { uploadFileToS3 } = require("../s2");
const { captureCaptcha } = require("../service/captureCaptcha");
const { closeSeccssionAlelrt } = require("../service/closeSession");
const {
  createDirectoryStructure,
  deleteUploadedPdf,
} = require("../service/createDirectory");
const { delay } = require("../service/delay");
const { deleteUsedCaptcha } = require("../service/deleteUsedCaptcha");
const { downloadPdf } = require("../service/downloadPdf");
const { formatDate } = require("../service/formatDate");
const { getProxy } = require("../service/getProxy");
const { verifyCaptcha } = require("../service/invalidCaptcha");
const { launchBrowser } = require("../service/launchBrowser");
const { processCaptcha } = require("../service/processCaptcha");
const path = require("path");
const fs = require("fs");
 
 
async function checkForRecordStatus(page) {
  await delay(400)
  const recordStatus = await page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll('span'));
    const foundMessages = messages.map(span => span.textContent.trim());
   
    const recordNotFound = foundMessages.includes("Record not found");
    const caseCodeNotExist = foundMessages.includes("This Case Code does not exist");
 
    return { recordNotFound, caseCodeNotExist };
  });
 
  if (recordStatus.recordNotFound) {
    return { status: true, message: "record not found" };
  } else if (recordStatus.caseCodeNotExist) {
    return { status: true, message: "Invalid CNR." };
  } else {
    return { status: false, message: "record found" };
  }
}
 
async function extractCaseDetails(page) {
  try {
    await page.waitForSelector("table.case_details_table", {
      timeout: 4000,
      visible: true,
    });
 
    const caseDetailsSection = await page.$("table.case_details_table");
    const rows = await caseDetailsSection.$$("tr");
    const caseDetail = {};
 
    for (const row of rows) {
      const cells = await row.$$("td");
      for (let i = 0; i < cells.length; i += 2) {
        if (i + 1 < cells.length) {
          const label = await (
            await cells[i].getProperty("innerText")
          ).jsonValue();
          const value = await (
            await cells[i + 1].getProperty("innerText")
          ).jsonValue();
          caseDetail[label.trim()] = value.trim();
        }
      }
    }
 
    return { status: true, caseDetail: caseDetail };
  } catch (error) {
    logger.error(`Err case_details_table:`, error);
    return { status: false, message: `${error.message}` };
  }
}
 
const extractTableData = async (page, selector) => {
  try {
    await page.waitForSelector(selector, { timeout: 4000, visible: true });
    const data = await page.evaluate((selector) => {
      const section = document.querySelector(selector);
      const rows = section ? section.querySelectorAll("tr") : [];
      const tableData = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        const rowData = [];
        cells.forEach((cell) => {
          rowData.push(cell.textContent.trim());
        });
        tableData.push(rowData);
      });
      return tableData;
    }, selector);
    return data;
  } catch (error) {
    logger.error(`extractTableData err: `, error);
    return [];
  }
};
 
async function extractFirDetails(page) {
  let firDetails = {};
  try {
    await page.waitForSelector("table.FIR_details_table", {
      timeout: 900,
      visible: true,
    });
    const firSection = await page.$("table.FIR_details_table");
    const firRows = await firSection.$$("tr");
    firDetails = {};
    for (const row of firRows) {
      const cells = await row.$$("td");
      if (cells.length > 0) {
        const key = await (await cells[0].getProperty("innerText")).jsonValue();
        const value = await (
          await cells[1].getProperty("innerText")
        ).jsonValue();
        firDetails[key.trim()] = value.trim();
      }
    }
    return firDetails;
  } catch (error) {
    logger.info(`FIR_details_table table not present. :`, error);
    return {};
  }
}
 
async function extractOrderTable(page, next_hearing_date, basePath, cnrNumber) {
  await page.waitForSelector(".order_table tr", {
    timeout: 3000,
    visible: true,
  });
 
  const Allrows = await page.$$eval(".order_table tr", (rows) =>
    rows.map((row) => row.innerText)
  );
 
  const { cnrDirectory, cnrExists } = createDirectoryStructure(
    basePath,
    cnrNumber
  );
  let s3Links = [];
  for (let i = 1; i < Allrows.length; i++) {
    const row = Allrows[i].split("\n");
    let orderNumber = row[0] || `${i}`;
    let order = row[0] || `${i}`;
    let orderDatet = order.match(/\t\s*(.*?)\s*\t/);
    let orderDate = orderDatet[1].trim();
 
    let orderDateObj = new Date(orderDate.split("-").reverse().join("-"));
    let next_hearing_date_obj = new Date(
      formatDate(next_hearing_date).split("-").reverse().join("-")
    );
 
    if (orderDateObj >= next_hearing_date_obj) {
      await delay(4000);
      const orderLink = await page.$(
        `.order_table tr:nth-child(${i + 1}) td:nth-child(3) a`
      );
 
      if (orderLink) {
        await orderLink.click();
 
        try {
          await page.waitForSelector("#modal_order_body", { timeout: 40000 });
          await delay(3000);
          const pdfLink = await page.$eval("#modal_order_body object", (obj) =>
            obj.getAttribute("data")
          );
 
          if (pdfLink) {
            const fullPdfLink = pdfLink.startsWith("http")
              ? pdfLink
              : new URL(
                  pdfLink,
                  "https://services.ecourts.gov.in/ecourtindia_v6/"
                ).href;
 
            const pdfPath = path.join(
              cnrDirectory,
              `${cnrNumber}_${orderDate}_order_${i}.pdf`
            );
 
            const cookies = (await page.cookies())
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; ");
 
            try {
              await downloadPdf(fullPdfLink, pdfPath, cookies);
              const s3Response = await uploadFileToS3(
                pdfPath,
                path.basename(pdfPath)
              );
              s3Links.push({
                order_date: orderDate,
                s3_url: s3Response.Location,
              });
            } catch (downloadError) {
              logger.error(
                `Error downloading PDF for order ${orderNumber}:`,
                downloadError
              );
            }
 
            await page.waitForSelector(".modal.fade.show", { visible: true });
            await page.click(".modal.fade.show .btn-close");
            await page.waitForSelector(".modal.fade.show", { hidden: true });
          }
        } catch (modalError) {
          await closeSeccssionAlelrt(page);
        }
      }
    }
  }
 
  await deleteUploadedPdf(cnrDirectory);
 
  return s3Links;
}
 
async function extractFinalOrder(page, basePath, cnrNumber, next_hearing_date) {
  const finalOrderTableSelector = "#history_cnr table.order_table:last-of-type";
  await page.waitForSelector(finalOrderTableSelector);
 
  const Allrows = await page.$$eval(`${finalOrderTableSelector} tr`, (rows) =>
    rows.map((row) => row.innerText)
  );
 
  const { cnrDirectory, cnrExists } = createDirectoryStructure(
    basePath,
    cnrNumber
  );
 
  let s3FinalOrderLinks = [];
  for (let i = 0; i < Allrows.length; i++) {
    // Start from 0 to include header
    const row = Allrows[i]
      .split("\t")
      .map((cell) => cell.trim())
      .filter((cell) => cell); // Clean up the row
    if (i === 0) continue; // Skip header row
 
    // Ensure the row has enough columns
    if (row.length < 2) {
      logger.error(`Row ${i} does not have enough columns:`, row);
      continue; // Skip this row if it doesn't have enough data
    }
 
    let orderNumber = row[0] || `${i}`;
    let orderDate = row[1];
 
    if (!orderDate) {
      console.error(`Order date not found for order ${orderNumber}`);
      continue;
    }
 
    let orderDateObj = new Date(orderDate.split("-").reverse().join("-"));
    let next_hearing_date_obj = new Date(
      formatDate(next_hearing_date).split("-").reverse().join("-")
    );
 
    if (orderDateObj >= next_hearing_date_obj) {
      await delay(4000);
      const orderLink = await page.$(
        `${finalOrderTableSelector} tr:nth-child(${i + 1}) td:nth-child(3) a`
      );
 
      if (orderLink) {
        await orderLink.click();
 
        try {
          await page.waitForSelector("#modal_order_body", { timeout: 40000 });
          await delay(3000);
          const pdfLink = await page.$eval("#modal_order_body object", (obj) =>
            obj.getAttribute("data")
          );
 
          if (pdfLink) {
            const fullPdfLink = pdfLink.startsWith("http")
              ? pdfLink
              : new URL(
                  pdfLink,
                  "https://services.ecourts.gov.in/ecourtindia_v6/"
                ).href;
 
            const pdfPath = path.join(
              cnrDirectory,
              `${cnrNumber}_${orderDate}_finalOrder_${i}.pdf`
            );
 
            // Get cookies for authentication
            const cookies = (await page.cookies())
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; ");
 
            // Download the PDF file
            try {
              await downloadPdf(fullPdfLink, pdfPath, cookies);
              const s3Response = await uploadFileToS3(
                pdfPath,
                path.basename(pdfPath)
              );
              s3FinalOrderLinks.push({
                order_date: orderDate,
                s3_url: s3Response.Location,
              });
            } catch (downloadError) {
              logger.error(
                `Error downloading PDF for order ${orderNumber}:`,
                downloadError
              );
            }
 
            await page.waitForSelector(".modal.fade.show", { visible: true });
            await page.click(".modal.fade.show .btn-close");
            await page.waitForSelector(".modal.fade.show", { hidden: true });
          } else {
            logger.error(`PDF link not found for order ${orderNumber}`);
          }
        } catch (modalError) {
          await closeSeccssionAlelrt(page);
        }
      }
    }
  }
 
  await deleteUploadedPdf(cnrDirectory);
 
  return s3FinalOrderLinks;
}
 
async function cnrDetailsUpdateCrawler(payload) {
  let { cnrNumber, next_hearing_date } = payload;
 
  let browser;
  try {
    const proxy = await getProxy();
    browser = await launchBrowser(proxy, false);
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
    });
    await page.goto("https://services.ecourts.gov.in/ecourtindia_v6/");
 
    await delay(100);
    await page.waitForSelector("#cino", { timeout: 80000 });
 
    await page.type("#cino", cnrNumber);
 
    await delay(600);
    let captchaPath = await captureCaptcha(page);
 
    await delay(900);
    let captchaResult = await processCaptcha(captchaPath);
    if (!captchaResult) {
      return { status: false, message: "captchaNotFound" };
    }
 
    await page.type("#fcaptcha_code", captchaResult);
    await page.click("#searchbtn");
 
    await deleteUsedCaptcha(captchaPath);
 
    await delay(300)
    let captchaValidationRes = await verifyCaptcha(page);
 
    if (!captchaValidationRes.status) {
      return { status: false, message: captchaValidationRes.message };
    }
 
    const isRecordFound = await checkForRecordStatus(page);
 
    if(isRecordFound.status) {
      return isRecordFound;
    }
 
 
    await delay(800);
    let caseDetail = await extractCaseDetails(page);
 
    if (!caseDetail.status) {
      return { status: false, message: caseDetail.message };
    }
 
    await delay(800);
    const caseStatus = await extractTableData(page, "table.case_status_table");
    const petitionerAdvocate = await extractTableData(
      page,
      "table.Petitioner_Advocate_table"
    );
    const respondentAdvocate = await extractTableData(
      page,
      "table.Respondent_Advocate_table"
    );
    const acts = await extractTableData(page, "table.acts_table");
    // const caseTransferDetails = await extractTableData(page,"table.transfer_table");
    const caseHistory = await extractTableData(page, "table.history_table");
    const firDetails = await extractFirDetails(page);
 
    const nextHearingDateFormatted = formatDate(next_hearing_date);
    const nextHearingDateObj = new Date(
      nextHearingDateFormatted.split("-").reverse().join("-")
    );
 
    const filteredCaseHistory = [];
 
    if (Array.isArray(caseHistory) && caseHistory.length > 0) {
      for (const entry of caseHistory) {
        if (entry.length > 2) {
          const hearingDateStr = entry[2];
          const hearingDateObj = new Date(
            hearingDateStr.split("-").reverse().join("-")
          );
 
          if (
            !isNaN(hearingDateObj.getTime()) &&
            hearingDateObj >= nextHearingDateObj
          ) {
            filteredCaseHistory.push(entry);
          }
        }
      }
    }
 
    const basePath = "./";
    let s3Links = [];
    let finalOrder = [];
    const orderTableExists = await page.$(".order_table");
 
    if (orderTableExists) {
      try {
        s3Links = await extractOrderTable(
          page,
          next_hearing_date,
          basePath,
          cnrNumber
        );
      } catch (error) {
        logger.error("Error extracting order table:", error);
      }
    } else {
      logger.info("Order table not found, skipping extractOrderTable.");
    }
 
    const historyOrderTableExists = await page.$(
      "#history_cnr .order_table:last-of-type"
    );
 
    if (historyOrderTableExists) {
      try {
        finalOrder = await extractFinalOrder(
          page,
          basePath,
          cnrNumber,
          next_hearing_date
        );
      } catch (error) {
        logger.error("Error extracting history order table:", error);
      }
    } else {
      logger.info(
        "History order table not found, skipping extractHistoryOrderTable."
      );
    }
 
    let allOrders = [...s3Links, ...finalOrder];
 
    const finalRes = {
      cnr_number: cnrNumber,
      "Case Details": caseDetail.caseDetail,
      "Case Status": caseStatus,
      "Petitioner and Advocate": petitionerAdvocate,
      "Respondent and Advocate": respondentAdvocate,
      Acts: acts,
      "FIR Details": firDetails,
      "Case History": filteredCaseHistory,
      //   "Case Transfer Details": caseTransferDetails,
      status: "complete",
      s3_links: allOrders,
      // finalOrders: finalOrder || [],
    };
 
    return { status: true, cnrDetails: finalRes };
  } catch (error) {
    logger.error(`Error crawler: ${error}`);
    return { status: false, message: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
 
module.exports = { cnrDetailsUpdateCrawler };