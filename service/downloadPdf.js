const fs = require("fs");
const https = require("https");
const { delay } = require("./delay");
const path = require("path");
 
 
const downloadPdf = (url, outputPath, cookies, maxRetries = 15, attempt = 1) => {
  return new Promise((resolve, reject) => {
 
    const directory = path.dirname(outputPath);
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (err) {
      return reject(err);
    }
   
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
            resolve(downloadPdf(url, outputPath, cookies, maxRetries, attempt + 1));
          } else {
            reject(new Error(`Failed to download file: ${response.statusCode}`));
          }
        }
      })
      .on("error", async (err) => {
        file.close();
        fs.unlink(outputPath, () => {});
        if (attempt < maxRetries) {
          await delay(5000);
          resolve(downloadPdf(url, outputPath, cookies, maxRetries, attempt + 1));
        } else{
            fs.unlink(outputPath, () => reject(err));
        }
      });
  });
};
 
module.exports = {downloadPdf}