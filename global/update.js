require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const tesseract = require("tesseract.js");
const https = require("https");
const { URL } = require("url");
const proxyChain = require("proxy-chain");
const requestPromise = require("request-promise");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { uploadFileToS3 } = require("../s2");

const getProxy = async () => {
  try {
    const socksProxy = "socks5://wpkjyjzk-rotate:3o1almvy0q8r@p.webshare.io:80";
    // 'socks5://iknzllgs-rotate:r5q66jrdjyzu@p.webshare.io:80'
    const agent = new SocksProxyAgent(new URL(socksProxy));
    const data = await requestPromise({
      url: "http://ipv4.webshare.io/",
      agent: agent,
    });
    // console.log("Proxy data fetched successfully.");
    return "socks5://wpkjyjzk-rotate:3o1almvy0q8r@p.webshare.io:80"; // Return the proxy string
  } catch (err) {
    console.error("Error fetching proxy:", err?.message);
    return false; // Rethrow the error for further handling
  }
};

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

const downloadPdf = (
  url,
  outputPath,
  cookies,
  maxRetries = 15,
  attempt = 1
) => {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      headers: {
        Cookie: cookies,
      },
    };

    const file = fs.createWriteStream(outputPath);
    https
      .get(url, requestOptions, async (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on("finish", () => {
            file.close(resolve);
          });
        } else {
          file.close();
          fs.unlink(outputPath, () => {});
          if (attempt < maxRetries) {
            await delay(5000);
            // console.log(`Retrying... Attempt ${attempt + 1} of ${maxRetries}`);
            resolve(
              downloadPdf(url, outputPath, cookies, maxRetries, attempt + 1)
            );
          } else {
            reject(
              new Error(`Failed to download file: ${response.statusCode}`)
            );
          }
        }
      })
      .on("error", async (err) => {
        file.close();
        fs.unlink(outputPath, () => {});
        if (attempt < maxRetries) {
          await delay(5000);
          resolve(
            downloadPdf(url, outputPath, cookies, maxRetries, attempt + 1)
          );
          // console.log(`Retrying... Attempt ${attempt + 1} of ${maxRetries}`);
        }
        fs.unlink(outputPath, () => reject(err));
      });
  });
};

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

async function launchBrowser(headless = true, profileDir = null, proxy) {
  let executablePath = null;

  // Determine the Chrome binary path based on the OS
  if (os.platform() === "win32") {
    executablePath =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  } else if (os.platform() === "linux") {
    executablePath = "/usr/bin/google-chrome";
    // Note: Puppeteer automatically handles headless mode on Linux
  } else if (os.platform() === "darwin") {
    executablePath =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  const anonymizedProxy = await proxyChain.anonymizeProxy(proxy);
  // console.log(`Using proxy: ${anonymizedProxy}`);
  // Configure Chrome options
  const options = {
    headless: true,
    executablePath: executablePath,
    args: [
      `--proxy-server=${anonymizedProxy}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--window-size=1920,1080",
    ],
  };

  // If a profile directory is provided, use it
  if (profileDir) {
    options.userDataDir = profileDir;
  } else {
    // Create a temporary directory for the Chrome profile if no profileDir is provided
    const tempProfileDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "puppeteer-profile-")
    );
    options.userDataDir = tempProfileDir;
  }

  // Launch browser
  const browser = await puppeteer.launch(options);
  // console.log("Browser launched successfully");
  return browser;
}

async function extractTableData(page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });

    const rows = await page.$$eval(`${selector} tr`, (rows) => {
      return rows.map((row) => {
        return Array.from(row.querySelectorAll("td")).map((cell) =>
          cell.innerText.trim()
        );
      });
    });

    return rows;
  } catch (error) {
    console.error("Error extracting table data:", error?.message);
    return [];
  }
}

async function extractCaseDetails(page, cnrNumber) {
  const tableSelector = "table.table";

  try {
    await page.waitForSelector(tableSelector, { timeout: 25000 });

    const hasCaseCode = await page.evaluate(() => {
      const table = document.querySelector("table.table");
      if (!table) return false;
      return Array.from(table.querySelectorAll("th")).some((th) =>
        th.textContent.trim().includes("Case Code")
      );
    });

    if (hasCaseCode) {
      const caseDetails = await extractTableData(
        page,
        "#history_cnr > table.table:first-of-type"
      );
      const acts = await extractTableData(page, "table.Acts_table");
      const petitionerAdvocate = await extractTableData(
        page,
        "#history_cnr > table.table:nth-of-type(2)"
      );

      const petitioner = [petitionerAdvocate[0] || []];
      const respondent = [petitionerAdvocate[2] || []];

      return {
        status: true,
        Acts: acts,
        "Case Details": caseDetails,
        "Case History": {},
        "Case Status": {},
        "FIR Details": [],
        "Petitioner and Advocate": petitioner,
        "Respondent and Advocate": respondent,
        Links: [],
        cnr_number: cnrNumber,
      };
    } else {
      return { status: false, error: "Case Code not found in table headers." };
    }
  } catch (error) {
    console.error("Error extracting case details:", error?.message);
    return { status: false, error: "An unexpected error occurred." };
  }
}

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

function sanitizeDateString(next_hearing_date) {
    if (typeof next_hearing_date !== 'string') {
        console.error("Received invalid input:", next_hearing_date);
        throw new Error('Invalid input: next_hearing_date must be a string');
    }
    return next_hearing_date.replace(/(\d+)(st|nd|rd|th)/g, '$1');
}

function formatDate(next_hearing_date) {
    if (typeof next_hearing_date !== 'string') {
        console.error("formatDate received non-string input:", next_hearing_date);
        throw new Error('Invalid input: next_hearing_date must be a string');
    }
    
    const sanitizedDateStr = sanitizeDateString(next_hearing_date);
    const parsedDate = new Date(sanitizedDateStr);
    
    if (isNaN(parsedDate.getTime())) {
        console.error("Unable to parse date:", sanitizedDateStr);
        throw new Error('Invalid date format');
    }
    
    const day = String(parsedDate.getDate()).padStart(2, "0");
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const year = parsedDate.getFullYear();
    
    return `${day}-${month}-${year}`;
}



async function getCaseDetailsAndOrders(cnrNumber, basePath, next_hearing_date) {
  const tempProfileDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "puppeteer-profile-")
  );
  let proxy = false;
  while (proxy === false) {
    proxy = await getProxy();
  }

  const browser = await launchBrowser(true, tempProfileDir, proxy);
  const page = await browser.newPage();
  let details = {};

  try {
    page.setDefaultNavigationTimeout(70000);
    await page.goto("https://services.ecourts.gov.in/ecourtindia_v6/");
    await page.waitForSelector("#cino", { timeout: 80000 });

    // Input CNR number
    await page.type("#cino", cnrNumber);

    // Handle CAPTCHA
    const captchaElement = await page.waitForSelector("#captcha_image", {
      timeout: 3500,
    });
    const captchaPath = path.join(basePath, `captcha_${cnrNumber}`);
    await captchaElement.screenshot({ path: captchaPath + ".png" }); // Ensure the file is saved with .png extension

    // Perform OCR to get the CAPTCHA text
    const {
      data: { text: captchaText },
    } = await tesseract.recognize(captchaPath + ".png", "eng");

    // Submit CAPTCHA
    await page.type("#fcaptcha_code", captchaText.trim());
    await page.click("#searchbtn");

    if (fs.existsSync(captchaPath + ".png")) {
      fs.unlinkSync(captchaPath + ".png");
    } else {
      console.warn(`File not found for deletion: ${captchaPath}.png`);
    }

    try {
      // Wait for case details to load
      await page.waitForSelector("table.case_details_table", {
        timeout: 30000,
      });

      // Extract case details
      const caseDetailsSection = await page.$("table.case_details_table");
      const rows = await caseDetailsSection.$$("tr");

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
            details[label.trim()] = value.trim();
          }
        }
      }

      const extractTableData = async (selector) => {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
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
        } catch (e) {
          return [];
        }
      };

      // Extract other tables like case status, petitioner details, etc.
      const caseStatus = await extractTableData("table.case_status_table");
      const petitionerAdvocate = await extractTableData(
        "table.Petitioner_Advocate_table"
      );
      const respondentAdvocate = await extractTableData(
        "table.Respondent_Advocate_table"
      );
      const acts = await extractTableData("table.acts_table");
      const caseHistory = await extractTableData("table.history_table");
      const caseTransferDetails = await extractTableData(
        "table.transfer_table"
      );

      // Extract FIR Details
      let firDetails = {};
      try {
        const firSection = await page.$("table.FIR_details_table");
        const firRows = await firSection.$$("tr");
        firDetails = {};
        for (const row of firRows) {
          const cells = await row.$$("td");
          if (cells.length > 0) {
            const key = await (
              await cells[0].getProperty("innerText")
            ).jsonValue();
            const value = await (
              await cells[1].getProperty("innerText")
            ).jsonValue();
            firDetails[key.trim()] = value.trim();
          }
        }
      } catch (error) {
        firDetails = {};
      }

      const nextHearingDateFormatted = formatDate(next_hearing_date);
      const nextHearingDateObj = new Date(nextHearingDateFormatted.split("-").reverse().join("-"));

      const filteredCaseHistory = [];
    for (const entry of caseHistory) {
        if (entry.length > 2) {
            const hearingDateStr = entry[2];
            const hearingDateObj = new Date(hearingDateStr.split("-").reverse().join("-"));
            
            if (!isNaN(hearingDateObj.getTime()) && hearingDateObj >= nextHearingDateObj) {
                filteredCaseHistory.push(entry);
            }
        }
    }

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

        await delay(5000); // Wait to ensure page is loaded

        if (orderDateObj >= next_hearing_date_obj) {
        const orderLink = await page.$(
          `.order_table tr:nth-child(${i + 1}) td:nth-child(3) a`
        );

        if (orderLink) {
          // console.log(`Clicking on order link for order ${orderNumber}`);
          await orderLink.click();

          try {
            await page.waitForSelector("#modal_order_body", { timeout: 40000 });
            await delay(3000);
            const pdfLink = await page.$eval(
              "#modal_order_body object",
              (obj) => obj.getAttribute("data")
            );

            if (pdfLink) {
              const fullPdfLink = pdfLink.startsWith("http")
                ? pdfLink
                : new URL(
                    pdfLink,
                    "https://services.ecourts.gov.in/ecourtindia_v6/"
                  ).href;
              // console.log(`Full PDF link: ${fullPdfLink}`);

              const pdfPath = path.join(
                cnrDirectory,
                `${cnrNumber}_${orderDate}_order_${i}.pdf`
              );

              // Get cookies for authentication
              const cookies = (await page.cookies())
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join("; ");

              // Download the PDF file
              try {
                await downloadPdf(fullPdfLink, pdfPath, cookies);
                // console.log(`Downloaded order to ${cnrDirectory}`);

                // Upload the downloaded PDF to S3
                const s3Response = await uploadFileToS3(
                  pdfPath,
                  path.basename(pdfPath)
                );
                // s3Links.push(s3Response.Location);
                s3Links.push({
                  order_date: orderDate,
                  s3_url: s3Response.Location,
                });

                // console.log(`File uploaded to S3: ${s3Response.Location}`);
              } catch (downloadError) {
                console.error(
                  `Error downloading PDF for order ${orderNumber}:`,
                  downloadError?.message
                );
              }

              await page.waitForSelector(".modal.fade.show", { visible: true });

              // Close modal after download
              await page.click(".modal.fade.show .btn-close");
              await page.waitForSelector(".modal.fade.show", { hidden: true });
            } else {
              console.error(`PDF link not found for order ${orderNumber}`);
            }
          } catch (modalError) {
            // console.error("Error waiting for the order modal:", modalError);
            await closeSeccssionAlelrt(page);
          }
        } else {
          console.error(`Order link not found for row ${i}`);
        }
    }

      }

      if (fs.existsSync(cnrDirectory)) {
        // Delete only the specific CNR folder, not other child folders
        fs.rmSync(cnrDirectory, { recursive: true, force: true });
        // console.log(`Deleted existing directory: ${cnrDirectory}`);
      } else {
        console.log(`No existing directory found for: ${cnrDirectory}`);
      }

      return {
        cnr_number: cnrNumber,
        "Case Details": details,
        "Case Status": caseStatus,
        "Petitioner and Advocate": petitionerAdvocate,
        "Respondent and Advocate": respondentAdvocate,
        Acts: acts,
        "FIR Details": firDetails,
        "Case History": filteredCaseHistory,
        "Case Transfer Details": caseTransferDetails,
        status: "complete",
        s3_links: s3Links,
      };
    } catch (mainError) {
      console.error("Error in main try block:", mainError?.message);

      try {
        const result = await extractCaseDetails(page, cnrNumber);
        if (result && result.status) {
          return result;
        } else {
          console.error("Extracted result is invalid:", result);
        }
      } catch (extractError) {
        console.error("Error while extracting case details:", extractError);
      }

      const errorMessage = await page
        .waitForSelector(".alert.alert-danger-cust", {
          visible: true,
          timeout: 5000,
        })
        .catch(() => null);
      if (errorMessage) {
        const errorText = await errorMessage.evaluate((el) => {
            const text = el.textContent || ''; // Fallback to an empty string if textContent is undefined
            console.log("Extracted text:", text); // Log the extracted text
            return String(text).replace(/\s+/g, " ").trim(); // Ensure text is a string
          });
        if (
          errorText.includes("Invalid Captcha") ||
          errorText.includes("Enter Captcha")
        ) {
          // console.log("Invalid Captcha detected. Retrying...");
          await browser.close();
          return getCaseDetailsAndOrders(cnrNumber, basePath);
        }
      }

      try {
        const recordNotFoundMessage = await page.waitForSelector(
          "div#history_cnr span",
          { timeout: 5000 }
        );
        const messageText = await page.evaluate(
          (el) => el.innerText,
          recordNotFoundMessage
        );
        if (messageText.includes("This Case Code does not exists")) {
          return { error: "Invalid_cnr" };
        }
      } catch (innerError) {
        console.error(
          "Error while checking 'This Case Code does not exists':",
          innerError?.message
        );
        try {
          await page.waitForSelector("table.case_details_table", {
            timeout: 20000,
          });
        } catch (error) {
          await browser.close();
          return await getCaseDetailsAndOrders(cnrNumber, basePath);
        }
        return { error: "An unexpected error occurredss." };
      }
    }
  } catch (error) {
    console.error("Error in outer try block:", error?.message);
    await browser.close();
    return { error: "An unexpected error occurred." };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const handleupdatecnr = async (req, res) => {
  const { cnr_number, next_hearing_date } = req.body;

  // Validate CNR number
  if (!cnr_number || typeof cnr_number !== "string") {
    return res
      .status(400)
      .json({ error: "Please provide a valid CNR number." });
  }

  // Validate Next Hearing Date
  if (!next_hearing_date || typeof next_hearing_date !== "string") {
    return res
      .status(400)
      .json({ error: "Please provide a valid Next Hearing Date." });
  }

  // Validate CNR number format (must be 16 alphanumeric characters)
  const cnrRegex = /^[A-Za-z0-9]{16}$/;
  if (!cnrRegex.test(cnr_number)) {
    return res
      .status(400)
      .json({
        error:
          "Invalid CNR number. It must be 16 alphanumeric characters long.",
      });
  }

  // Validate the Next Hearing Date format (must be like '30th January 2025')
  const dateRegex = /^\d{1,2}(st|nd|rd|th)\s\w+\s\d{4}$/;
  if (!dateRegex.test(next_hearing_date)) {
    return res
      .status(400)
      .json({
        error:
          "Invalid date format for Next Hearing Date. It must be like '30th January 2025'.",
      });
  }

  try {
    const customBasePath = "./"; // Set the base path for saving files
    const result = await getCaseDetailsAndOrders(
      cnr_number,
      customBasePath,
      next_hearing_date
    );
    return res.json(result);
  } catch (error) {
    console.error(`Unexpected Error: ${error.message}`);
    return res
      .status(500)
      .json({ error: "An unexpected error occurred. Please try again later." });
  }
};

module.exports = { handleupdatecnr };
