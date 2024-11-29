from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from PIL import Image
import pytesseract
import time
import re
from queue import Queue
from threading import Thread
 
# Flask app setup
app = Flask(__name__)
 
# Constants
MAX_CONCURRENT_REQUESTS = 5
TESSERACT_PATH = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
CAPTCHA_SCREENSHOT_PATH = 'captcha.png'
 
# Shared request queue for multi-threading
request_queue = Queue()
 
# Worker thread for processing CNR requests
class RequestProcessor(Thread):
    def run(self):
        while True:
            cnr_number, response = request_queue.get()
            try:
                result = get_case_details_process(cnr_number)
                response["data"] = result
            except Exception as e:
                response["data"] = {"error": str(e)}
            finally:
                request_queue.task_done()
 
# Start worker threads
for _ in range(MAX_CONCURRENT_REQUESTS):
    worker = RequestProcessor()
    worker.start()
 
# Selenium-based scraper to fetch case details
 
def get_case_details_process(cnr_number):
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920x1080")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
 
    driver = webdriver.Chrome(options=options)
   
    try:
        driver.get("https://services.ecourts.gov.in/ecourtindia_v6/")
       
        # Wait for all elements to load completely
        WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.ID, "captcha_image")or (By.XPATH, "//img[@id='captcha_image']")))
 
        # Get CNR number from user input
        cnr_input = driver.find_element(By.ID, "cino")
        cnr_input.send_keys(cnr_number)
        time.sleep(1)
       
        # Take a screenshot of the CAPTCHA image directly
        captcha_element = driver.find_element(By.ID, "captcha_image")
        captcha_element.screenshot(CAPTCHA_SCREENSHOT_PATH)  # Save the CAPTCHA screenshot
 
        # Open the CAPTCHA image and use Tesseract to read it
        img = Image.open(CAPTCHA_SCREENSHOT_PATH)
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH  # Set the path to Tesseract-OCR
        captcha_text = pytesseract.image_to_string(img)
 
        # Find the CAPTCHA input field and enter the CAPTCHA text
        captcha_input_field = driver.find_element(By.ID, "fcaptcha_code")
        captcha_input_field.send_keys(captcha_text.strip())
 
        # Click the search button
        search_button = driver.find_element(By.ID, "searchbtn")
        search_button.click()
 
        # Wait for the search results to be loaded or a possible CAPTCHA error
        try:
            WebDriverWait(driver, 15).until(  # Increased wait time
                EC.visibility_of_element_located((By.CSS_SELECTOR, "table.case_details_table")))
 
            details = {}
            case_details_section = driver.find_element(By.CSS_SELECTOR, "table.case_details_table")
            for row in case_details_section.find_elements(By.CSS_SELECTOR, "tr"):
                cells = row.find_elements(By.CSS_SELECTOR, "td")
                for i in range(0, len(cells), 2):
                    if i + 1 < len(cells):
                        label = cells[i].text.strip()
                        value = cells[i + 1].text.strip()
                        details[label] = value
            WebDriverWait(driver, 15).until(  # Increased wait time
                EC.visibility_of_element_located((By.CSS_SELECTOR, "table.case_status_table")))
            # Parse case status section without duplicating data
            case_status_section = driver.find_element(By.CSS_SELECTOR, "table.case_status_table")
            case_status = []
            for row in case_status_section.find_elements(By.CSS_SELECTOR, "tr"):
                label_cell = row.find_element(By.CSS_SELECTOR, "label")
                value_cell = row.find_element(By.CSS_SELECTOR, "td[colspan='3']")  # Fetch only the value without label
 
                label = label_cell.text.strip()  # Get the label
                value = value_cell.text.strip()  # Get the value
 
                # Append label and value as a list to case_status
                case_status.append([label, value])
 
            # Parse Petitioner and Advocate
            petitioner_advocate_section = driver.find_element(By.CSS_SELECTOR, "table.Petitioner_Advocate_table")
            petitioner_advocate = []
            for row in petitioner_advocate_section.find_elements(By.CSS_SELECTOR, "tr"):
                cells = row.find_elements(By.TAG_NAME, "td")
                for cell in cells:
                    petitioner_advocate.append(cell.text.strip())
 
            # Parse Respondent and Advocate
            respondent_advocate_section = driver.find_element(By.CSS_SELECTOR, "table.Respondent_Advocate_table")
            respondent_advocate = []
            for row in respondent_advocate_section.find_elements(By.CSS_SELECTOR, "tr"):
                cells = row.find_elements(By.TAG_NAME, "td")
                for cell in cells:
                    respondent_advocate.append(cell.text.strip())
 
            # Parse Acts
            acts_section = driver.find_element(By.CSS_SELECTOR, "table.acts_table")
            acts = []
            for row in acts_section.find_elements(By.CSS_SELECTOR, "tr"):
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) > 0:
                    acts.append([cell.text.strip() for cell in cells])
 
            # Parse FIR Details
            try:
                fir_details_section = driver.find_element(By.CSS_SELECTOR, "table.FIR_details_table")
                fir_details = {}
                for row in fir_details_section.find_elements(By.CSS_SELECTOR, "tr"):
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) == 2:
                        label = cells[0].text.strip()
                        value = cells[1].text.strip()
                        fir_details[label] = value
            except NoSuchElementException:
                fir_details = {}  # Handle case where FIR details are not found
 
            # Parse Case History
            case_history_section = driver.find_element(By.CSS_SELECTOR, "table.history_table")
            case_history = []
            for row in case_history_section.find_elements(By.CSS_SELECTOR, "tr"):
                cells = row.find_elements(By.TAG_NAME, "td")
                case_history.append([cell.text.strip() for cell in cells])
 
            # Parse Case Transfer Details
            case_transfer_details = []  # Initialize the variable before usage
            print("Waiting for case transfer details section...")
            try:
                # Use a longer wait time if necessary
                case_transfer_section = WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "table.transfer_table"))  # Adjust the selector as needed
                )
                print("Found case transfer section.")
                for row in case_transfer_section.find_elements(By.CSS_SELECTOR, "tr"):
                    cells = row.find_elements(By.TAG_NAME, "td")
                    case_transfer_details.append([cell.text.strip() for cell in cells])
 
            except NoSuchElementException:
                print("Case Transfer Details section not found.")  # Suppress stack trace
            except TimeoutException:
                print("Case Transfer Details section timed out.")  # Suppress stack trace
            except Exception as e:
                print(f"Error while trying to find Case Transfer Details: {e}")  # Generic error handling
 
            return {
                'Case Details': details,
                'Case Status': case_status,
                'Petitioner and Advocate': petitioner_advocate,
                'Respondent and Advocate': respondent_advocate,
                'Acts': acts,
                'FIR Details': fir_details,
                'Case History': case_history,
                'Case Transfer Details': case_transfer_details
            }
        except Exception as e:
            print(f"Error: {e}")  # Print the specific error
            # Check for the presence of the "Invalid Captcha" modal after attempting to load case details
            try:
                WebDriverWait(driver, 5).until(
                    EC.visibility_of_element_located((By.CSS_SELECTOR, ".alert.alert-danger-cust"))
                )
                error_message = driver.find_element(By.CSS_SELECTOR, ".alert.alert-danger-cust").text
                if "Invalid Captcha" in error_message:
                    driver.quit()  # Close the driver
                    time.sleep(1)  # Add a small delay before retrying
                    return get_case_details_process(cnr_number)  # Retry process for the same CNR number
            except Exception as inner_exception:
                print(f"Error while checking CAPTCHA: {inner_exception}")
 
    except Exception as e:
        print(f"Error in main try block: {e}")  # Print the error for main block
        # Check if "Record not found" message is available
        try:
            record_not_found_message = WebDriverWait(driver, 5).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, "div#history_cnr span"))
            ).text
            if "Record not found" in record_not_found_message:
                return {'error': 'Record not found'}
        except Exception as inner_exception:
            print(f"Error while checking 'Record not found': {inner_exception}")
 
        # If the table or message is not found, return a general error
        return {'error': 'An unexpected error occurred.'}
    finally:
        driver.quit()
# Flask route to handle case details requests
 
@app.route('/getCase_Details_satus', methods=['POST'])
def get_case_details():
    data = request.json
    cnr_number = data.get('cnr_number')
 
    # Validate CNR number
    if not cnr_number or not re.match(r'^[A-Za-z0-9]{16}$', cnr_number):
        return jsonify({"error": "Invalid CNR number. It must be 16 alphanumeric characters."}), 400
 
    # Queue the request
    response = {}
    request_queue.put((cnr_number, response))
    request_queue.join()
 
    # Return the result
    return jsonify(response.get("data", {"error": "No response from worker"}))
 
# Run Flask app
if __name__ == '__main__':
    app.run(debug=True)