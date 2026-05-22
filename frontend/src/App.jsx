import React, { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

export default function App() {
  const webcamRef = useRef(null);
  const imageContainerRef = useRef(null);
  
  const [image, setImage] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState(null);
  const [results, setResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Take a picture
  const capture = () => {
    const imageSrc = webcamRef.current.getScreenshot();
    setImage(imageSrc);
    setBoxes([]);
    setResults(null);
  };

  // Convert pixel coordinates to percentages so it scales perfectly on mobile
  const getCoordinates = (e) => {
    const rect = imageContainerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  const handleStart = (e) => {
    e.preventDefault();
    const pos = getCoordinates(e);
    setStartPos(pos);
    setIsDrawing(true);
    setCurrentBox({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const currentPos = getCoordinates(e);
    
    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const width = Math.abs(currentPos.x - startPos.x);
    const height = Math.abs(currentPos.y - startPos.y);

    setCurrentBox({ x, y, width, height });
  };

  const handleEnd = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    // Ask the user what this box is called
    if (currentBox && currentBox.width > 0.05 && currentBox.height > 0.05) {
      const name = window.prompt("What is the name of this field? (e.g., Name, Total Amount)");
      if (name) {
        setBoxes([...boxes, { ...currentBox, name, id: Date.now() }]);
      }
    }
    setCurrentBox(null);
  };

  // Save the learned boxes as a JSON template
  const exportTemplate = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(boxes));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", "document_template.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // Send the image and boxes to Python for reading
  const processDocument = async () => {
    if (boxes.length === 0) {
      alert("Please draw at least one box to extract data.");
      return;
    }
    setIsProcessing(true);

    try {
      // Convert base64 image to an actual file to send to backend
      const res = await fetch(image);
      const blob = await res.blob();
      const file = new File([blob], "scan.jpg", { type: "image/jpeg" });

      const formData = new FormData();
      formData.append("image", file);
      formData.append("boxes", JSON.stringify(boxes));

      // Talk to Python server
      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      setResults(response.data.data);
    } catch (error) {
      console.error(error);
      alert("Error reading document. Is the Python server running?");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans text-gray-800">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg overflow-hidden flex flex-col items-center p-4">
        
        <h1 className="text-2xl font-bold mb-4">Smart Mobile OCR</h1>

        {!image ? (
          <div className="w-full relative rounded-lg overflow-hidden bg-black">
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode: "environment" }}
              className="w-full h-auto object-cover"
            />
            <button 
              onClick={capture}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-8 py-3 rounded-full font-bold shadow-lg"
            >
              Scan Document
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-4">
            <p className="text-sm text-center text-gray-500">
              Use your finger/mouse to drag boxes over the text you want to read.
            </p>

            {/* The Image Area where you draw */}
            <div 
              ref={imageContainerRef}
              className="relative w-full border-2 border-gray-300 rounded touch-none cursor-crosshair"
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
            >
              <img src={image} alt="Scanned" className="w-full h-auto block pointer-events-none" />
              
              {/* Draw saved boxes */}
              {boxes.map((box) => (
                <div 
                  key={box.id}
                  className="absolute border-2 border-green-500 bg-green-500/20"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.width * 100}%`,
                    height: `${box.height * 100}%`
                  }}
                >
                  <span className="absolute -top-6 left-0 bg-green-500 text-white text-xs px-1 rounded whitespace-nowrap">
                    {box.name}
                  </span>
                </div>
              ))}

              {/* Draw current box being dragged */}
              {currentBox && isDrawing && (
                <div 
                  className="absolute border-2 border-blue-500 bg-blue-500/20"
                  style={{
                    left: `${currentBox.x * 100}%`,
                    top: `${currentBox.y * 100}%`,
                    width: `${currentBox.width * 100}%`,
                    height: `${currentBox.height * 100}%`
                  }}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => setImage(null)} className="flex-1 bg-gray-200 py-2 rounded font-bold">
                Retake Photo
              </button>
              <button onClick={() => setBoxes([])} className="flex-1 bg-red-100 text-red-600 py-2 rounded font-bold">
                Clear Boxes
              </button>
            </div>

            <button 
              onClick={processDocument}
              disabled={isProcessing}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold shadow disabled:bg-blue-300"
            >
              {isProcessing ? "Reading handwriting..." : "Read Document Data"}
            </button>

            {boxes.length > 0 && (
               <button onClick={exportTemplate} className="w-full text-blue-600 py-2 font-semibold underline">
                 Save Box Template (JSON)
               </button>
            )}

            {/* Show Results */}
            {results && (
              <div className="mt-4 p-4 bg-gray-50 border rounded-lg w-full">
                <h3 className="font-bold mb-2">Extracted Data:</h3>
                {Object.entries(results).map(([key, value]) => (
                  <div key={key} className="mb-2">
                    <span className="text-gray-500 text-sm block">{key}:</span>
                    <span className="font-mono text-black font-semibold">{value || "No text found"}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}