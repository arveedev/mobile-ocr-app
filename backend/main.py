from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import easyocr
import cv2
import numpy as np
import json

# This starts our web server
app = FastAPI()

# This allows our React app to talk to our Python app safely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the AI that reads English handwriting (this takes a moment when the server starts)
print("Loading AI Model... please wait.")
reader = easyocr.Reader(['en'])
print("AI Model Ready!")

@app.post("/scan")
async def scan_document(image: UploadFile = File(...), boxes: str = Form(...)):
    # 1. Read the image file sent from the web app
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # 2. Read the boxes the user drew
    box_data = json.loads(boxes)
    results = {}

    # 3. For every box, crop the image and read the text
    for box in box_data:
        h, w, _ = img.shape
        
        # We use percentages so it works on any screen size
        x1 = int(box['x'] * w)
        y1 = int(box['y'] * h)
        x2 = int((box['x'] + box['width']) * w)
        y2 = int((box['y'] + box['height']) * h)

        # Cut out just the piece of the image the user highlighted
        crop = img[y1:y2, x1:x2]

        # Use EasyOCR to read the text/handwriting inside that cropped piece
        ocr_result = reader.readtext(crop, detail=0)
        
        # Combine the words and save it under the name the user chose
        text = " ".join(ocr_result)
        results[box['name']] = text

    return {"status": "success", "data": results}