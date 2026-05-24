import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

export default function App() {
  const webcamRef = useRef(null);
  const [mode, setMode] = useState('camera'); 
  const [capturedImage, setCapturedImage] = useState(null);
  
  const [templateName, setTemplateName] = useState('docu1');
  const [savedTemplates, setSavedTemplates] = useState({});
  const [boxes, setBoxes] = useState([]);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState(null);
  
  const [ocrResults, setOcrResults] = useState(null);
  const [originalResults, setOriginalResults] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const captureDocument = async () => {
    if (!webcamRef.current) return;
    if (!window.cv || !window.cv.Mat) {
      alert("OpenCV is still loading, please wait a moment...");
      return;
    }

    const screenshot = webcamRef.current.getScreenshot();
    setIsProcessing(true);
    setStatusMessage("Detecting edges & flattening...");

    try {
      const processedDataUrl = await processWithOpenCV(screenshot);
      setCapturedImage(processedDataUrl);
      
      setMode('tagging');
      if (savedTemplates[templateName]) {
        setBoxes(savedTemplates[templateName]);
      } else {
        setBoxes([]);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to process image. Make sure the document is visible.");
      setCapturedImage(screenshot); // Fallback to raw uncropped image
      setMode('tagging');
    } finally {
      setIsProcessing(false);
      setStatusMessage("");
    }
  };

  const processWithOpenCV = (dataUrl) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        try {
          const cv = window.cv;
          let src = cv.imread(img);
          let gray = new cv.Mat();
          
          // 1. Preprocess: Grayscale and Blur to remove noise
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
          let blurred = new cv.Mat();
          cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
          
          // 2. Edge Detection
          let edges = new cv.Mat();
          cv.Canny(blurred, edges, 75, 200);

          // 3. Find Contours
          let contours = new cv.MatVector();
          let hierarchy = new cv.Mat();
          cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

          // 4. Find the largest contour (the document)
          let maxArea = 0;
          let maxContourIndex = -1;
          for (let i = 0; i < contours.size(); ++i) {
            let area = cv.contourArea(contours.get(i));
            if (area > maxArea) {
              maxArea = area;
              maxContourIndex = i;
            }
          }

          let warped = new cv.Mat();

          // If a large enough document is found (at least 10% of the screen)
          if (maxContourIndex !== -1 && maxArea > (src.cols * src.rows * 0.1)) {
            let largestContour = contours.get(maxContourIndex);

            // 5. EXTREME POINTS ALGORITHM: Handles folded/imperfect corners!
            // We get the points with max/min sums and differences of x,y coordinates
            let pts = [];
            for (let i = 0; i < largestContour.data32S.length; i += 2) {
              pts.push({ x: largestContour.data32S[i], y: largestContour.data32S[i+1] });
            }

            let tl = pts[0], br = pts[0], tr = pts[0], bl = pts[0];
            let minSum = 1000000, maxSum = -1000000, minDiff = 1000000, maxDiff = -1000000;

            pts.forEach(p => {
              let sum = p.x + p.y;
              let diff = p.x - p.y;
              if (sum < minSum) { minSum = sum; tl = p; } // Top-Left
              if (sum > maxSum) { maxSum = sum; br = p; } // Bottom-Right
              if (diff < minDiff) { minDiff = diff; bl = p; } // Bottom-Left
              if (diff > maxDiff) { maxDiff = diff; tr = p; } // Top-Right
            });

            // 6. Calculate NATURAL width and height to PREVENT SQUEEZING
            let widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
            let widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
            let maxWidth = Math.max(widthTop, widthBottom);

            let heightLeft = Math.hypot(tl.x - bl.x, tl.y - bl.y);
            let heightRight = Math.hypot(tr.x - br.x, tr.y - br.y);
            let maxHeight = Math.max(heightLeft, heightRight);

            let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
            let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxWidth - 1, 0, maxWidth - 1, maxHeight - 1, 0, maxHeight - 1]);

            // 7. Flatten and Crop (Perspective Transform)
            let M = cv.getPerspectiveTransform(srcCoords, dstCoords);
            cv.warpPerspective(src, warped, M, new cv.Size(maxWidth, maxHeight));

            srcCoords.delete(); dstCoords.delete(); M.delete();
          } else {
            // Fallback if no doc detected
            src.copyTo(warped);
          }

          // 8. IMAGE ENHANCEMENT FOR OCR (Make text pop)
          cv.cvtColor(warped, warped, cv.COLOR_RGBA2GRAY, 0);
          // Increase contrast (alpha=1.3) and brightness (beta=20)
          cv.convertScaleAbs(warped, warped, 1.3, 20);

          // 9. Output to dynamic canvas (Keeps exact aspect ratio!)
          const canvas = document.createElement('canvas');
          cv.imshow(canvas, warped);
          resolve(canvas.toDataURL('image/jpeg', 0.9));

          // Cleanup memory
          src.delete(); gray.delete(); blurred.delete(); edges.delete();
          contours.delete(); hierarchy.delete(); warped.delete();
          
        } catch (err) {
          reject(err);
        }
      };
    });
  };

  const getMousePos = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  const startDrawing = (e) => {
    const pos = getMousePos(e);
    setStartPos(pos);
    setIsDrawing(true);
    setCurrentBox({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const drawMove = (e) => {
    if (!isDrawing) return;
    const currentPos = getMousePos(e);
    setCurrentBox({
      x: Math.min(startPos.x, currentPos.x),
      y: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y)
    });
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentBox && currentBox.width > 0.02) {
      const varName = window.prompt("Name this variable (e.g., name, total_amount)");
      if (varName) {
        const newBox = { ...currentBox, name: varName, id: Date.now() };
        const updatedBoxes = [...boxes, newBox];
        setBoxes(updatedBoxes);
        setSavedTemplates({ ...savedTemplates, [templateName]: updatedBoxes });
      }
    }
    setCurrentBox(null);
  };

  const sendToBackendAI = async () => {
    if (boxes.length === 0) return alert("Please draw at least one box.");
    setIsProcessing(true);
    setStatusMessage("Reading document text...");
    
    try {
      // 1. Get the EXACT dynamic dimensions of the processed image to send to backend
      const img = new Image();
      img.src = capturedImage;
      await new Promise(r => img.onload = r);
      const imgWidth = img.width;
      const imgHeight = img.height;

      const absoluteBoxes = boxes.map(b => ({
        name: b.name,
        x: Math.round(b.x * imgWidth),
        y: Math.round(b.y * imgHeight),
        width: Math.round(b.width * imgWidth),
        height: Math.round(b.height * imgHeight)
      }));

      // 2. Prepare file
      const res = await fetch(capturedImage);
      const blob = await res.blob();
      const file = new File([blob], "scan.jpg", { type: "image/jpeg" });

      const formData = new FormData();
      formData.append("image", file);
      formData.append("boxes", JSON.stringify(absoluteBoxes));
      formData.append("template_name", templateName);

      // 3. Send to Backend
      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      
      setOcrResults(response.data.data);
      setOriginalResults(response.data.data);
      setMode('results');
    } catch (err) {
      console.error(err);
      alert("Error reading document. Make sure your HuggingFace backend is awake.");
    } finally {
      setIsProcessing(false);
      setStatusMessage("");
    }
  };

  const teachApp = async (key) => {
    const originalText = originalResults[key];
    const newText = ocrResults[key];
    
    if (originalText === newText) return; 

    try {
      await axios.post('https://arvee120-my-ocr-brain.hf.space/correct', {
        template_name: templateName,
        field_name: key,
        original_text: originalText,
        corrected_text: newText
      });
      
      setOriginalResults({...originalResults, [key]: newText});
      alert(`Learned! Next time I see "${originalText}" in this box, I will auto-correct it to "${newText}".`);
    } catch (err) {
      console.error(err);
      alert("Failed to teach the app.");
    }
  };

  const downloadJSON = () => {
    if (!ocrResults) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(ocrResults, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `extracted_data_${templateName}.json`);
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="max-w-md mx-auto h-[100dvh] bg-slate-900 text-white p-4 font-sans flex flex-col">
      
      <div className="bg-slate-800 p-3 rounded shadow-md mb-3 flex items-center justify-between shrink-0">
        <label className="text-xs font-bold text-slate-400">DOC PROFILE:</label>
        <input 
          type="text" 
          value={templateName} 
          onChange={(e) => setTemplateName(e.target.value.toLowerCase())}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-green-400 font-mono w-2/3 text-right outline-none focus:border-green-500"
        />
      </div>

      {mode === 'camera' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 relative rounded-xl overflow-hidden bg-black mb-4 flex justify-center items-center">
            <Webcam 
              audio={false} 
              ref={webcamRef} 
              screenshotFormat="image/jpeg"
              screenshotQuality={1}
              videoConstraints={{ facingMode: "environment" }}
              className="absolute inset-0 w-full h-full object-cover" 
            />
            {isProcessing && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div>
                <p className="text-emerald-400 font-bold">{statusMessage}</p>
              </div>
            )}
          </div>
          
          <button 
            onClick={captureDocument}
            disabled={isProcessing}
            className="w-full shrink-0 bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg mb-2 transition-transform active:scale-95 disabled:opacity-50"
          >
            📸 Scan Document
          </button>
        </div>
      )}

      {mode === 'tagging' && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="text-center shrink-0">
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">DRAW EXTRACTION BOXES</span>
          </div>

          <div 
            className="flex-1 relative w-full rounded border border-slate-700 touch-none select-none bg-slate-950 overflow-hidden flex items-center justify-center"
          >
            <div 
              className="relative max-h-full max-w-full"
              onMouseDown={startDrawing} onMouseMove={drawMove} onMouseUp={endDrawing}
              onTouchStart={startDrawing} onTouchMove={drawMove} onTouchEnd={endDrawing}
            >
              <img src={capturedImage} alt="Captured doc" className="max-h-full max-w-full object-contain block pointer-events-none" />
              
              {boxes.map((box) => (
                <div 
                  key={box.id} 
                  className="absolute border-2 border-emerald-500 bg-emerald-500/20"
                  style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.width*100}%`, height: `${box.height*100}%` }}
                >
                  <span className="bg-emerald-500 text-black text-[10px] font-black px-1 rounded-br absolute top-0 left-0">
                    {box.name}
                  </span>
                </div>
              ))}

              {currentBox && isDrawing && (
                <div 
                  className="absolute border-2 border-cyan-400 bg-cyan-400/20"
                  style={{ left: `${currentBox.x*100}%`, top: `${currentBox.y*100}%`, width: `${currentBox.width*100}%`, height: `${currentBox.height*100}%` }}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 shrink-0">
            <button onClick={() => setMode('camera')} className="bg-slate-800 py-3 rounded-xl font-bold text-sm">Retake Photo</button>
            <button onClick={() => setBoxes([])} className="bg-rose-900/50 text-rose-400 py-3 rounded-xl font-bold text-sm">Clear Boxes</button>
          </div>

          <button 
            onClick={sendToBackendAI}
            disabled={isProcessing}
            className="w-full shrink-0 bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg mb-2 flex justify-center items-center gap-2"
          >
            {isProcessing ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> {statusMessage}</>
            ) : "Read Taught Variables"}
          </button>
        </div>
      )}

      {mode === 'results' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex-1 bg-slate-800 rounded-xl p-4 shadow-xl overflow-y-auto">
            <h2 className="text-md font-bold text-green-400 mb-3">✓ EXTRACTED DATA (EDITABLE):</h2>
            <div className="space-y-3">
              {ocrResults && Object.entries(ocrResults).map(([key, val]) => (
                <div key={key} className="bg-slate-900 p-3 rounded font-mono flex flex-col gap-2">
                  <div className="text-[11px] text-slate-500 font-bold uppercase">{key}</div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={val || ""}
                      onChange={(e) => setOcrResults({...ocrResults, [key]: e.target.value})}
                      className="flex-1 bg-slate-800 text-white border border-slate-700 rounded px-2 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    
                    {originalResults[key] !== ocrResults[key] && (
                      <button 
                        onClick={() => teachApp(key)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-xs font-bold transition-colors"
                      >
                        Teach App
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="shrink-0 space-y-3 mb-2">
            <button 
              onClick={downloadJSON} 
              className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold flex justify-center items-center gap-2"
            >
              Download JSON File
            </button>
            <button 
              onClick={() => setMode('camera')} 
              className="w-full bg-slate-800 text-white py-3.5 rounded-xl font-bold"
            >
              Scan New Document
            </button>
          </div>
        </div>
      )}
    </div>
  );
}