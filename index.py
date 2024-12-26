from flask import Flask, request, jsonify
from flask_cors import CORS
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException, TimeoutException, StaleElementReferenceException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from PIL import Image
from dotenv import load_dotenv
import pytesseract
import time
import re
import boto3
import tempfile
import os
import requests
import platform
import subprocess


# AWS Configuration
load_dotenv()
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION")
AWS_S3_BUCKET_NAME = os.getenv("AWS_S3_BUCKET_NAME")

s3_client = boto3.client('s3',
                         aws_access_key_id=AWS_ACCESS_KEY_ID,
                         aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
                         region_name=AWS_REGION)

app = Flask(__name__)
CORS(app)  # Allow CORS for all origins

def upload_to_s3(file_path, bucket_name, s3_key):
    """Uploads a file to AWS S3 and returns its public URL."""
    try:
        s3_client.upload_file(file_path, bucket_name, s3_key)
        s3_url = f"https://{bucket_name}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
        return s3_url
    except Exception as e:
        raise Exception(f"Failed to upload to S3: {str(e)}")

MAX_RETRIES = 5  # Maximum number of retries for PDF download

def download_pdf_with_retry(driver, order_element, index, cnr_directory, cnr_number, cookies):
    retries = 0
    pdf_saved = False

    while retries < MAX_RETRIES and not pdf_saved:
        try:
            # Re-find the order element just before clicking it 
            driver.execute_script("arguments[0].click();", order_element)

            # Wait for modal and PDF link
            modal_body = WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.ID, "modal_order_body"))
            )

            # Get PDF link from the modal (Ensure the link is correct)
            object_element = modal_body.find_element(By.TAG_NAME, "object")
            pdf_link = object_element.get_attribute("data")
            # print("PDF link:", pdf_link)

            if not pdf_link:
                raise ValueError("PDF link not found")

            # Define PDF path
            pdf_filename = f"order_{index}.pdf"
            pdf_path = os.path.join(cnr_directory, pdf_filename)

            # Convert Selenium cookies to a string for headers
            cookies_string = "; ".join(
                [f"{cookie['name']}={cookie['value']}" for cookie in driver.get_cookies()]
            )

            # Add headers to simulate a browser request
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                ),
                "Referer": "https://services.ecourts.gov.in/ecourtindia_v6/",
                "Accept": "application/pdf",
                "Cookie": cookies_string,
            }

            # Download the PDF using requests
            response = requests.get(pdf_link, headers=headers, stream=True)

            # Check if the download was successful
            if response.status_code == 200:
                with open(pdf_path, "wb") as pdf_file:
                    for chunk in response.iter_content(chunk_size=8192):
                        pdf_file.write(chunk)
                # print(f"PDF saved: {pdf_path}")
                pdf_saved = True  # Mark as saved successfully

                # Upload to S3
                s3_key = f"{cnr_number}/intrim_orders/{pdf_filename}"
                s3_url = upload_to_s3(pdf_path, AWS_S3_BUCKET_NAME, s3_key)

                # After uploading, delete the file from local storage
                os.remove(pdf_path)

                # print(f"Deleted local file: {pdf_path}")
                return s3_url, True  # Return the S3 URL and success status
            else:
                print(
                    f"Failed to download PDF. Status code: {response.status_code} - {pdf_link}"
                )
                retries += 1
                time.sleep(2)  # Wait before retrying
        except (
            StaleElementReferenceException,
            NoSuchElementException,
            TimeoutException,
            ValueError,
        ) as e:
            print(f"Error downloading order {index}: {e}")
            retries += 1
            time.sleep(2)  # Wait before retrying

    return None, False  # Return None and failure status after retries exceeded

def verify_pdf_downloads(cnr_directory, total_orders):
    missing_pdfs = []
    for i in range(1, total_orders + 1):
        pdf_filename = f"order_{i}.pdf"
        pdf_path = os.path.join(cnr_directory, pdf_filename)
        if not os.path.exists(pdf_path):
            missing_pdfs.append(pdf_filename)
    
    # if missing_pdfs:
    #     print(f"Missing PDFs: {missing_pdfs}")
    # else:
    #     print("All PDFs were successfully downloaded.")

def launch_browser(headless=True):
    # Determine the Chrome binary path based on the OS
    executable_path = None
    if platform.system() == "Windows":
        executable_path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    elif platform.system() == "Linux":
        executable_path = "/usr/bin/google-chrome"
        # Launch Xvfb for Linux headless operation
        subprocess.Popen(
            ["Xvfb", ":99", "-screen", "0", "1280x720x24"], 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE
        )
        os.environ['DISPLAY'] = os.getenv('DISPLAY', ':99')  # Use DISPLAY from environment
    elif platform.system() == "Darwin":
        executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    # Configure Chrome options
    options = webdriver.ChromeOptions()
    options.binary_location = executable_path
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-popup-blocking")

    # Launch browser
    browser = webdriver.Chrome(options=options)
    return browser

import os
import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from PIL import Image
import pytesseract
from selenium.common.exceptions import NoSuchElementException

def get_case_details_and_orders(cnr_number, base_path):
    driver = launch_browser(headless=True)  # You can change headless=True if needed
    try:
        driver.get("https://services.ecourts.gov.in/ecourtindia_v6/")

        # Wait for CNR input field
        WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.ID, "cino")))

        # Input CNR number
        cnr_input = driver.find_element(By.ID, "cino")
        cnr_input.send_keys(cnr_number)
        time.sleep(1)

        # Handle CAPTCHA
        captcha_element = driver.find_element(By.ID, "captcha_image")
        captcha_path = os.path.join(base_path, "captcha.png")
        captcha_element.screenshot(captcha_path)

        img = Image.open(captcha_path)

        # Set the tesseract path based on the OS
        if platform.system() == 'Windows':  # Windows OS
            pytesseract.pytesseract.tesseract_cmd = r'C:\\Program Files\\Tesseract-OCR\\tesseract.exe'
        elif platform.system() == 'Linux':  # Linux/Ubuntu OS
            pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'
        else:
            raise EnvironmentError(f"Unsupported OS: {platform.system()}")

        # Perform OCR to get the CAPTCHA text
        captcha_text = pytesseract.image_to_string(img).strip()

        # Submit CAPTCHA
        captcha_input_field = driver.find_element(By.ID, "fcaptcha_code")
        captcha_input_field.send_keys(captcha_text)
        search_button = driver.find_element(By.ID, "searchbtn")
        search_button.click()

        # Wait for case details to load
        WebDriverWait(driver, 15).until(EC.visibility_of_element_located((By.CSS_SELECTOR, "table.case_details_table")))

        # Extract case details
        details = {}
        case_details_section = driver.find_element(By.CSS_SELECTOR, "table.case_details_table")
        for row in case_details_section.find_elements(By.CSS_SELECTOR, "tr"):
            cells = row.find_elements(By.CSS_SELECTOR, "td")
            for i in range(0, len(cells), 2):
                if i + 1 < len(cells):
                    label = cells[i].text.strip()
                    value = cells[i + 1].text.strip()
                    details[label] = value

        # Extract other details (status, parties, acts, FIR, history, etc.)
        def extract_table_data(selector):
            try:
                time.sleep(2)
                driver.implicitly_wait(5)
                section = driver.find_element(By.CSS_SELECTOR, selector)
                return [[cell.text.strip() for cell in row.find_elements(By.TAG_NAME, "td")] for row in section.find_elements(By.CSS_SELECTOR, "tr")]
            except NoSuchElementException:
                return []

        case_status = extract_table_data("table.case_status_table")
        petitioner_advocate = extract_table_data("table.Petitioner_Advocate_table")
        respondent_advocate = extract_table_data("table.Respondent_Advocate_table")
        acts = extract_table_data("table.acts_table")
        case_history = extract_table_data("table.history_table")
        case_transfer_details = extract_table_data("table.transfer_table")

        # Extract FIR Details
        try:
            fir_section = driver.find_element(By.CSS_SELECTOR, "table.FIR_details_table")
            fir_details = {
                row.find_elements(By.TAG_NAME, "td")[0].text.strip(): row.find_elements(By.TAG_NAME, "td")[1].text.strip()
                for row in fir_section.find_elements(By.CSS_SELECTOR, "tr")
            }
        except NoSuchElementException:
            fir_details = {}

        # Download Orders
        cnr_directory = os.path.join(base_path, cnr_number, "intrim_orders")  # Save in "intrim_orders" folder
        os.makedirs(cnr_directory, exist_ok=True)

        WebDriverWait(driver, 25).until(EC.presence_of_element_located((By.CSS_SELECTOR, ".order_table")))
        rows = driver.find_elements(By.CSS_SELECTOR, '.order_table tr')

        s3_links = []
        for index, row in enumerate(rows[1:], start=1):  # Start from the first order
            try:
                cells = row.find_elements(By.TAG_NAME, 'td')
                driver.implicitly_wait(4)
                order_number = cells[0].text.strip()  # This will get the order number (1)
                order_date = cells[1].text.strip()     # This will get the order date (27-07-2022)

                order_element = cells[2].find_element(By.TAG_NAME, 'a')

                cookies = "; ".join([f"{cookie['name']}={cookie['value']}" for cookie in driver.get_cookies()])

                # Call download_pdf_with_retry and pass cnr_number
                s3_url = download_pdf_with_retry(driver, order_element, index, cnr_directory, cnr_number, cookies)
                order_data = {
                    "order_date": order_date,
                    "s3_url": s3_url
                }
                if s3_url:
                    s3_links.append(order_data)
                else:
                    print(f"Failed to download PDF: {order_element.get_attribute('href')}")

            except Exception as e:
                print(f"Error downloading order {index}: {e}")
        
        # Verify the downloaded PDFs
        total_orders = len(rows) - 1  # Exclude the header row
        verify_pdf_downloads(cnr_directory, total_orders)

        try:
            if os.path.exists(cnr_directory):
                # Walk through the directory tree from bottom to top
                for root, dirs, files in os.walk(cnr_directory, topdown=False):
                    for file in files:
                        file_path = os.path.join(root, file)
                        try:
                            os.remove(file_path)  # Delete individual files
                            print(f"Deleted file: {file_path}")
                        except Exception as e:
                            print(f"Failed to delete file {file_path}: {e}")

                for dir in dirs:
                    dir_path = os.path.join(root, dir)
                    try:
                        os.rmdir(dir_path)  # Delete empty subdirectories
                        print(f"Deleted subdirectory: {dir_path}")
                    except Exception as e:
                        print(f"Failed to delete directory {dir_path}: {e}")

                # Delete the main directory itself
                os.rmdir(cnr_directory)
            parent_directory = os.path.dirname(cnr_directory)  # Get parent directory path
            if os.path.exists(parent_directory):
                os.rmdir(parent_directory)
        except Exception as e:
            print(f"Error while deleting directory {cnr_directory}: {e}")

        return {
            'cnr_number': cnr_number,
            'Case Details': details,
            'Case Status': case_status,
            'Petitioner and Advocate': petitioner_advocate,
            'Respondent and Advocate': respondent_advocate,
            'Acts': acts,
            'FIR Details': fir_details,
            'Case History': case_history,
            'Case Transfer Details': case_transfer_details,
            'status': 'complete',
            's3_links': s3_links  # Return the S3 links for the downloaded PDFs
        }

    except Exception as e:
        print(f"Error in main try block: {e}")  # Print the error for the main block
        # Check for the presence of the "Invalid Captcha" modal after attempting to load case details
        try:
            WebDriverWait(driver, 5).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".alert.alert-danger-cust"))
            )
            error_message = driver.find_element(By.CSS_SELECTOR, ".alert.alert-danger-cust").text
            if "Invalid Captcha" in error_message:
                driver.quit()  # Close the driver
                time.sleep(1)  # Add a small delay before retrying
                return get_case_details_and_orders(cnr_number, base_path)  # Retry process for the same CNR number
        except Exception as inner_exception:
            print(f"Error while checking CAPTCHA: {inner_exception}")

        # Check if "This Case Code does not exists" message is available
        try:
            record_not_found_message = WebDriverWait(driver, 5).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, "div#history_cnr span"))
            ).text
            if "This Case Code does not exists" in record_not_found_message:
                return {'error': 'Invalid_cnr'}
        except Exception as inner_exception:
            print(f"Error while checking 'This Case Code does not exists': {inner_exception}")
            return {'error': 'An unexpected error occurred.'}
    finally:
        driver.quit()



@app.route('/get_case_details_status', methods=['POST'])
def get_case_details_status():
    """API endpoint to process a single CNR number."""
    data = request.json
    cnr_number = data.get('cnr_number')  # Expecting a single CNR number

    if not cnr_number or not isinstance(cnr_number, str):
        return jsonify({"error": "Please provide a valid CNR number."}), 400

    if not re.match(r'^[A-Za-z0-9]{16}$', cnr_number):
        return jsonify({"error": "Invalid CNR number. It must be 16 alphanumeric characters long."}), 200
    else:
        try:
            # Define base_path here
            custom_base_path = r"./"  # Set the base path for saving files
            result = get_case_details_and_orders(cnr_number, custom_base_path)
            return jsonify(result)

        except Exception as e:
            print(f"Unexpected Error: {str(e)}")
            return jsonify({"error": "An unexpected error occurred. Please try again later."}), 500
        
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "message": "Api running."}), 200

if __name__ == '__main__':
    app.run(debug=True, port=8080)

