from flask import Flask, request, jsonify
from flask_cors import CORS
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException, TimeoutException, StaleElementReferenceException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException, TimeoutException, StaleElementReferenceException, ElementClickInterceptedException
)
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
from datetime import datetime
import shutil
import shutil


# import logging



# Configure Logging
# logging.basicConfig(
#     level=logging.DEBUG,
#     format="%(asctime)s - %(levelname)s - %(message)s",
#     handlers=[
#         logging.FileHandler("server.log"),
#         logging.StreamHandler()
#     ]
# )

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

# def log_exception(e, message=""):
#     """Log exceptions with an optional message."""
#     logging.error(f"{message}: {e}", exc_info=True)

def upload_to_s3(file_path, bucket_name, s3_key):
    # logging.debug(f"Uploading {file_path} to S3 bucket {bucket_name} with key {s3_key}")
    try:
        s3_client.upload_file(file_path, bucket_name, s3_key)
        s3_url = f"https://{bucket_name}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
        # logging.info(f"Successfully uploaded to S3. URL: {s3_url}")
        return s3_url
    except Exception as e:
        # log_exception(e, "Failed to upload to S3")
        raise Exception(f"Failed to upload to S3: {str(e)}")


MAX_RETRIES = 10  # Maximum number of retries for PDF download

def download_pdf_with_retry(driver, rows, index, cnr_directory, cnr_number, cookies):
    retries = 0
    pdf_filename = f"order_{index}.pdf"
    pdf_path = os.path.join(cnr_directory, pdf_filename)
    
    while retries < MAX_RETRIES:
        try:
            # Re-locate the row and order element to handle stale element reference
            row = rows[index]  # Re-locate the row by index
            cells = row.find_elements(By.TAG_NAME, 'td')
            order_element = cells[2].find_element(By.TAG_NAME, 'a')  # Re-locate the order link
            
            # Click on the order element
            driver.execute_script("arguments[0].click();", order_element)
            
            # Wait for the modal and object containing the PDF link
            modal_body = WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.ID, "modal_order_body"))
            )
            object_element = WebDriverWait(modal_body, 10).until(
                EC.presence_of_element_located((By.TAG_NAME, "object"))
            )
            pdf_link = object_element.get_attribute("data")
            if not pdf_link:
                raise ValueError("PDF link not found")
            
            # Prepare request headers
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                ),
                "Cookie": cookies,
            }
            
            # Download the PDF
            response = requests.get(pdf_link, headers=headers, stream=True, timeout=15)
            if response.status_code == 200:
                with open(pdf_path, "wb") as pdf_file:
                    for chunk in response.iter_content(chunk_size=8192):
                        pdf_file.write(chunk)
                
                # Upload to S3 and return the URL
                s3_key = f"{cnr_number}/intrim_orders/{pdf_filename}"
                s3_url = upload_to_s3(pdf_path, AWS_S3_BUCKET_NAME, s3_key)
                os.remove(pdf_path)
                return s3_url
            else:
                raise ValueError(f"Failed to download PDF, status code: {response.status_code}")
        
        except (ElementClickInterceptedException, TimeoutException, ValueError, requests.RequestException) as e:
            retries += 1
            time.sleep(2)  # Retry delay
        except StaleElementReferenceException:
            # print(f"Stale element encountered during attempt {retries + 1}. Re-locating the element...")
            retries += 1  # Increment retry count
    
    # If all retries fail, return None
    return None

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

def launch_browser(headless=True , profile_dir=None):
    # Determine the Chrome binary path based on the OS
    executable_path = None
    if platform.system() == "Windows":
        executable_path = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    elif platform.system() == "Linux":
        executable_path = "/usr/bin/google-chrome"
        # Launch Xvfb for Linux headless operation
        subprocess.Popen(
            ["/usr/bin/Xvfb", ":99", "-screen", "0", "1280x720x24"], 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE
        )
        os.environ['DISPLAY'] = os.getenv('DISPLAY', ':99')  # Use DISPLAY from environment
    elif platform.system() == "Darwin":
        executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    options = webdriver.ChromeOptions()
    if profile_dir:
        options.add_argument(f"--user-data-dir={profile_dir}")  # Use the provided profile directory
    else:
        # Create a temporary directory for the Chrome profile if no profile_dir is provided
        temp_profile_dir = tempfile.mkdtemp()
        options.add_argument(f"--user-data-dir={temp_profile_dir}")
    options.binary_location = executable_path
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--window-size=1920,1080")

    # Launch browser
    browser = webdriver.Chrome(options=options)
    # logging.info("Browser launched successfully")
    return browser

def extract_table_data(driver, selector):
    try:
        time.sleep(2)
        driver.implicitly_wait(5)
        section = driver.find_element(By.CSS_SELECTOR, selector)
        return [[cell.text.strip() for cell in row.find_elements(By.TAG_NAME, "td")] for row in section.find_elements(By.CSS_SELECTOR, "tr")]
    except NoSuchElementException:
        return []

def extract_case_details(driver, cnr_number):
    table_selector = "table.table"
    try:
        # Wait until the table is present
        WebDriverWait(driver, 25).until(EC.presence_of_element_located((By.CSS_SELECTOR, table_selector)))

        # Check if the "Case Code" exists in the table headers
        has_case_code = driver.execute_script(""" 
            var table = document.querySelector('table.table');
            if (!table) return false;
            return Array.from(table.querySelectorAll('th')).some(th => th.textContent.trim().includes('Case Code'));
        """)

        if has_case_code:
            # Extract data from various tables
            case_details = extract_table_data(driver, "#history_cnr > table.table:first-of-type")
            acts = extract_table_data(driver, "table.Acts_table")
            petitioner_advocate = extract_table_data(driver, "#history_cnr > table.table:nth-of-type(2)")

            # Structure the response data
            petitioner = [petitioner_advocate[0]]
            respondent = [petitioner_advocate[2]]

            res = {
                'status': True,
                'Acts': acts,
                'Case Details': case_details,
                'Case History': {},
                'Case Status': {},
                'FIR Details': [],
                'Petitioner and Advocate': petitioner,
                'Respondent and Advocate': respondent,
                'Links': [],
                'cnr_number': cnr_number
            }
            driver.quit()
            return res

    except Exception as ex:
        # print(f"Error checking for table data: {ex}")
        return {'error': 'An unexpected error occurred.'}
    

def sanitize_date_string(date_str):
    # Remove invalid ordinal suffixes like "rd", "st", "nd", "th"
    date_str = re.sub(r'(\d+)(st|nd|rd|th)', r'\1', date_str)
    return date_str

def get_case_details_and_orders(cnr_number, custom_base_path, next_hearing_date):
    # driver = launch_browser(headless=True)  # You can change headless=True if needed
    temp_profile_dir = tempfile.mkdtemp()  # Create a temporary directory for the profile
    driver = launch_browser(headless=True, profile_dir=temp_profile_dir)

    try:
        driver.get("https://services.ecourts.gov.in/ecourtindia_v6/")
        # logging.debug("Navigated to eCourts website")

        # Wait for CNR input field
        WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.ID, "cino")))

        # Input CNR number
        cnr_input = driver.find_element(By.ID, "cino")
        cnr_input.send_keys(cnr_number)
        time.sleep(1)

        # Handle CAPTCHA
        captcha_element = WebDriverWait(driver, 2).until(
        EC.presence_of_element_located((By.ID, "captcha_image"))
    )
        captcha_path = os.path.join(custom_base_path, "captcha.png")
        captcha_element.screenshot(captcha_path)
        # logging.debug(f"Captcha saved to {captcha_path}")

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
        # logging.debug(f"Captcha solved: {captcha_text}")

        # Submit CAPTCHA
        captcha_input_field = driver.find_element(By.ID, "fcaptcha_code")
        captcha_input_field.send_keys(captcha_text)
        search_button = driver.find_element(By.ID, "searchbtn")
        search_button.click()
        # logging.info("Captcha submitted and search initiated")

        # Wait for case details to load
        WebDriverWait(driver, 20).until(EC.visibility_of_element_located((By.CSS_SELECTOR, "table.case_details_table")))
        # logging.info("Case details table loaded successfully")

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
        case_history = extract_table_data("table.history_table")
        acts = extract_table_data("table.acts_table")
        case_transfer_details = extract_table_data("table.transfer_table")
        
        try:
            fir_section = driver.find_element(By.CSS_SELECTOR, "table.FIR_details_table")
            fir_details = {
                row.find_elements(By.TAG_NAME, "td")[0].text.strip(): row.find_elements(By.TAG_NAME, "td")[1].text.strip()
                for row in fir_section.find_elements(By.CSS_SELECTOR, "tr")
            }
        except NoSuchElementException:
            fir_details = {}
        
        
        
        sanitized_date = sanitize_date_string(next_hearing_date)

        
        next_hearing_date_obj = datetime.strptime(sanitized_date, '%d %B %Y')
        
        filtered_case_history = []
        for entry in case_history:
            if len(entry) > 2:  # Ensure there are enough columns
                hearing_date_str = entry[2]  # Assuming the Hearing Date is in the third column
                try:
                    hearing_date_obj = datetime.strptime(hearing_date_str, '%d-%m-%Y')
                    if hearing_date_obj > next_hearing_date_obj:
                        filtered_case_history.append(entry)
                except ValueError:
                    continue

        # Download Orders
        cnr_directory = os.path.join(custom_base_path, cnr_number, "intrim_orders")  # Save in "intrim_orders" folder
        os.makedirs(cnr_directory, exist_ok=True)
        
        try:
            WebDriverWait(driver, 25).until(EC.presence_of_element_located((By.CSS_SELECTOR, ".order_table")))
            rows = driver.find_elements(By.CSS_SELECTOR, '.order_table tr')
        except TimeoutException:
            rows = []

        s3_links = []
        if rows:
            # Parse the next hearing date for comparison
            sanitized_date = sanitize_date_string(next_hearing_date)
            next_hearing_date_obj = datetime.strptime(sanitized_date, '%d %B %Y')
            for index, row in enumerate(rows[1:], start=1):
                order_date_str = None
                try:
                    cells = row.find_elements(By.TAG_NAME, 'td')
                    order_number = cells[0].text.strip()
                    order_date_str = cells[1].text.strip()  # Assign value to order_date_str
                    
                    if not order_date_str:
                        print(f"Order {index} has an empty order date. Skipping...")
                        continue  # Skip this iteration if order date is empty
                    order_element = cells[2].find_element(By.TAG_NAME, 'a')
                    cookies = "; ".join([f"{cookie['name']}={cookie['value']}" for cookie in driver.get_cookies()])
                    order_date_obj = datetime.strptime(order_date_str, '%d-%m-%Y')
                    if order_date_obj >= next_hearing_date_obj:
                        s3_url = download_pdf_with_retry(driver, rows, index, cnr_directory, cnr_number, cookies)
                        if s3_url:
                            s3_links.append({"order_date": order_date_str, "s3_url": s3_url})
                except Exception as e:
                    print(f"Error downloading order {index}: {e}")
                    
            total_orders = len(rows) - 1  # Exclude the header row
            verify_pdf_downloads(cnr_directory, total_orders)
            
        filtered_s3_links = []
        for link in s3_links:
            order_date_str = link["order_date"]
            if order_date_str:  # Check if order_date is not empty
                order_date_obj = datetime.strptime(order_date_str, '%d-%m-%Y')
                if order_date_obj >= next_hearing_date_obj:
                    filtered_s3_links.append(link)

        try:
            if os.path.exists(cnr_directory):
                # Walk through the directory tree from bottom to top
                for root, dirs, files in os.walk(cnr_directory, topdown=False):
                    for file in files:
                        file_path = os.path.join(root, file)
                        try:
                            os.remove(file_path)  # Delete individual files
                            # print(f"Deleted file: {file_path}")
                        except Exception as e:
                            print(f"Failed to delete file {file_path}: {e}")

                for dir in dirs:
                    dir_path = os.path.join(root, dir)
                    try:
                        os.rmdir(dir_path)  # Delete empty subdirectories
                        # print(f"Deleted subdirectory: {dir_path}")
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
            'Case Status': case_status,
            'Petitioner and Advocate': petitioner_advocate,
            'Respondent and Advocate': respondent_advocate,
            'Acts': acts,
            'FIR Details': fir_details,
            'Case History': filtered_case_history,
            'Case Transfer Details': case_transfer_details,
            'status': 'complete',
            's3_links': filtered_s3_links
        }

    except Exception as e:
        print(f"Error in main try block: {e}")  # Print the error for the main block
        # Check for the presence of the "Invalid Captcha" modal after attempting to load case details
        
        try:
            print("go here")
            result = extract_case_details(driver, cnr_number)
            if result.get('status', False):
                return result  # Return if case details extraction is successful
        except Exception as extract_exception:
            print(f"Error while extracting case details: {extract_exception}")
            
        try:
            WebDriverWait(driver, 5).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".alert.alert-danger-cust"))
            )
            error_message = driver.find_element(By.CSS_SELECTOR, ".alert.alert-danger-cust").text
            print("error this",error_message)
            if "Invalid Captcha" in error_message:
                driver.quit()  # Close the driver
                time.sleep(1)  # Add a small delay before retrying
                return get_case_details_and_orders(cnr_number, custom_base_path, next_hearing_date)  # Retry process for the same CNR number
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
        shutil.rmtree(temp_profile_dir)

        # logging.debug("Browser closed")



@app.route('/get_case_details_status', methods=['POST'])
def get_case_details_status():
    """API endpoint to process a single CNR number and optional Next Hearing Date."""
    data = request.json
    cnr_number = data.get('cnr_number')  # Expecting a single CNR number
    next_hearing_date = data.get('Next Hearing Date')  # Capturing next hearing date (now mandatory)

    # Ensure both CNR number and Next Hearing Date are provided
    if not cnr_number or not isinstance(cnr_number, str):
        return jsonify({"error": "Please provide a valid CNR number."}), 400

    if not next_hearing_date or not isinstance(next_hearing_date, str):
        return jsonify({"error": "Please provide a valid Next Hearing Date."}), 400

    # Validate CNR number format (must be 16 alphanumeric characters)
    if not re.match(r'^[A-Za-z0-9]{16}$', cnr_number):
        return jsonify({"error": "Invalid CNR number. It must be 16 alphanumeric characters long."}), 400

    # Validate the Next Hearing Date format (must be like '30th January 2025')
    if not re.match(r'^\d{1,2}(st|nd|rd|th)\s\w+\s\d{4}$', next_hearing_date):
        return jsonify({"error": "Invalid date format for Next Hearing Date. It must be like '30th January 2025'."}), 400

    try:
        # Define base_path here
        custom_base_path = r"./"  # Set the base path for saving files
        result = get_case_details_and_orders(cnr_number, custom_base_path, next_hearing_date)
        return jsonify(result)

    except Exception as e:
        print(f"Unexpected Error: {str(e)}")
        return jsonify({"error": "An unexpected error occurred. Please try again later."}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "message": "Api running."}), 200

if __name__ == '__main__':
    app.run(debug=True, port=8080)


