const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
 
// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
 
// Function to Upload a File to S3
const uploadFileToS3 = async (filePath, originalName) => {
  const fileStream = fs.createReadStream(filePath);
 
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${Date.now()}_${originalName}`,
    Body: fileStream,
  };
 
  try {
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    const s3Location = `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
    return { Location: s3Location, response };
  } catch (err) {
    console.error("Error uploading file to S3:", err);
    throw err;
  }
};
 
module.exports = { uploadFileToS3 };