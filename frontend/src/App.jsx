import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

export default function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const processedCanvasRef = useRef(null);
  
  const [cvReady, setCvReady] = useState(false);
  const [mode, setMode] = useState('camera'); 
  const [enhancedImage, setEnhancedImage] = useState(null);
  
  const [templateName, setTemplateName] = useState('docu1');
  const [savedTemplates, setSavedTemplates] = useState({});
  const [boxes, setBoxes] = useState([]);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState(null);
  const [ocrResults, setOcrResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const checkCV = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        setCvReady(true);
        clearInterval(checkCV);
        startVideoLoop();
      }
    }, 200);
    return () => clearInterval(checkCV);
  }, []);

  // LIVE LASER GUIDE
  const startVideoLoop = () => {
    const processFrame = () => {
      if (webcamRef.current && webcamRef.current.video && webcamRef.current.video.readyState === 4) {
        const video = webcamRef.current.video;
        const canvas = canvasRef.current;
        if (!canvas) return requestAnimationFrame(processFrame);
        
        const ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        try {
          let src = window.cv.imread(canvas);
          let dst = new window.cv.Mat();
          
          window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY, 0);
          window.cv.GaussianBlur(dst, dst, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
          window.cv.Canny(dst, dst, 75, 200, 3, false);
          
          let contours = new window.cv.MatVector();
          let hierarchy = new window.cv.Mat();
          window.cv.findContours(dst, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
          
          let maxArea = 0;
          let docContour = null;
          
          // Lowered the area requirement to catch more documents
          for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = window.cv.contourArea(cnt);
            if (area > (canvas.width * canvas.height * 0.15)) { 
              let approx = new window.cv.Mat();
              let peri = window.cv.arcLength(cnt, true);
              window.cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
              
              if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (docContour) docContour.delete();
                docContour = approx.clone();
              }
              approx.delete();
            }
          }
          
          if (docContour) {
            ctx.strokeStyle = "#00ff00"; // Green target box
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(docContour.data32S[0], docContour.data32S[1]);
            for (let i = 1; i < 4; i++) {
              ctx.lineTo(docContour.data32S[i * 2], docContour.data32S[i * 2 + 1]);
            }
            ctx.closePath();
            ctx.stroke();
            docContour.delete();
          }
          
          src.delete(); dst.delete(); contours.delete(); hierarchy.delete();
        } catch (err) {
          // Ignore dropped frames
        }
      }
      requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
  };

  // Helper to sort corners: Top-Left, Top-Right, Bottom-Right, Bottom-Left
  const orderPoints = (pts) => {
    let sortedX = [...pts].sort((a, b) => a.x - b.x);
    let left = [sortedX[0], sortedX[1]].sort((a, b) => a.y - b.y);
    let right = [sortedX[2], sortedX[3]].sort((a, b) => a.y - b.y);
    return [left[0], right[0], right[1], left[1]]; // TL, TR, BR, BL
  };

  // THE MAGIC STRAIGHTENER & ENHANCER
  const captureAndCleanDocument = () => {
    if (!webcamRef.current) return;
    const screenshot = webcamRef.current.getScreenshot();
    
    const img = new Image();
    img.src = screenshot;
    img.onload = () => {
      try {
        let src = window.cv.imread(img);
        let dst = new window.cv.Mat();
        
        window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY, 0);
        window.cv.GaussianBlur(dst, dst, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
        window.cv.Canny(dst, dst, 75, 200, 3, false);
        
        let contours = new window.cv.MatVector();
        let hierarchy = new window.cv.Mat();
        window.cv.findContours(dst, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
        
        let maxArea = 0;
        let docContour = null;
        
        for (let i = 0; i < contours.size(); ++i) {
          let cnt = contours.get(i);
          let area = window.cv.contourArea(cnt);
          if (area > 10000) {
            let approx = new window.cv.Mat();
            window.cv.approxPolyDP(cnt, approx, 0.02 * window.cv.arcLength(cnt, true), true);
            if (approx.rows === 4 && area > maxArea) {
              maxArea = area;
              if (docContour) docContour.delete();
              docContour = approx.clone();
            }
            approx.delete();
          }
        }
        
        let finalMat = new window.cv.Mat();
        let width = 800;
        let height = 1100; // Standard document aspect ratio
        
        if (docContour) {
          // WE FOUND THE PAPER: Warp and Flatten it!
          let pts = [];
          for (let i = 0; i < 4; i++) {
            pts.push({ x: docContour.data32S[i * 2], y: docContour.data32S[i * 2 + 1] });
          }
          let ordered = orderPoints(pts);
          
          let srcTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
            ordered[0].x, ordered[0].y, ordered[1].x, ordered[1].y,
            ordered[2].x, ordered[2].y, ordered[3].x, ordered[3].y
          ]);
          
          let dstTri = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
            0, 0, width, 0, width, height, 0, height
          ]);
          
          let M = window.cv.getPerspectiveTransform(srcTri, dstTri);
          window.cv.warpPerspective(src, finalMat, M, new window.cv.Size(width, height));
          
          srcTri.delete(); dstTri.delete(); M.delete(); docContour.delete();
        } else {
          // FALLBACK: If it couldn't find the edges, just resize the image to document format
          window.cv.resize(src, finalMat, new window.cv.Size(width, height));
        }

        // TEXT ENHANCEMENT: Make background white, printed text black
        window.cv.cvtColor(finalMat, finalMat, window.cv.COLOR_RGBA2GRAY, 0);
        // Using a balanced threshold specifically tuned for printed text
        window.cv.adaptiveThreshold(finalMat, finalMat, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 21, 15);
        
        const canvas = processedCanvasRef.current;
        canvas.width = width;
        canvas.height = height;
        window.cv.imshow(canvas, finalMat);
        
        setEnhancedImage(canvas.toDataURL('image/jpeg', 0.9));
        
        src.delete(); dst.delete(); contours.delete(); hierarchy.delete(); finalMat.delete();
        
        setMode('tagging');
        if (savedTemplates[templateName]) {
          setBoxes(savedTemplates[templateName]);
        } else {
          setBoxes([]);
        }
      } catch (err) {
        console.error("Processing failed", err);
        alert("Image processing failed. Try adjusting the lighting.");
      }
    };
  };

  // Learning Drag Logic
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
      const varName = window.prompt("Name this variable (e.g., total_pay)");
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
    try {
      const res = await fetch(enhancedImage);
      const blob = await res.blob();
      const file = new File([blob], "scan.jpg", { type: "image/jpeg" });

      const formData = new FormData();
      formData.append("image", file);
      formData.append("boxes", JSON.stringify(boxes));

      // Connected directly to the Hugging Face Space
      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      setOcrResults(response.data.data);
      setMode('results');
    } catch (err) {
      alert("Error reading document. Is your backend running?");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-900 text-white p-4 font-sans flex flex-col justify-between">
      
      <div className="bg-slate-800 p-3 rounded shadow-md mb-3 flex items-center justify-between">
        <label className="text-xs font-bold text-slate-400">DOC PROFILE:</label>
        <input 
          type="text" 
          value={templateName} 
          onChange={(e) => setTemplateName(e.target.value.toLowerCase())}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-green-400 font-mono w-2/3 text-right"
        />
      </div>

      {mode === 'camera' && (
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="w-full relative rounded-xl overflow-hidden border-2 border-slate-700 bg-black">
            <Webcam 
              audio={false} 
              ref={webcamRef} 
              screenshotFormat="image/jpeg"
              screenshotQuality={1}
              videoConstraints={{ facingMode: "environment", width: 1920, height: 1080 }}
              className="w-full h-auto opacity-0 absolute" 
            />
            <canvas ref={canvasRef} className="w-full h-auto block" />
            
            <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-green-400 animate-pulse">
              {cvReady ? "● EDGE TRACKER ACTIVE" : "LOADING..."}
            </div>
          </div>
          
          <button 
            onClick={captureAndCleanDocument}
            disabled={!cvReady}
            className="w-full mt-6 bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg"
          >
            📸 Capture & Crop Paper
          </button>
        </div>
      )}

      {mode === 'tagging' && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="text-center">
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">FLATTENED & ENHANCED</span>
          </div>

          <div 
            className="relative w-full rounded border border-slate-700 touch-none select-none bg-white"
            onMouseDown={startDrawing} onMouseMove={drawMove} onMouseUp={endDrawing}
            onTouchStart={startDrawing} onTouchMove={drawMove} onTouchEnd={endDrawing}
          >
            <img src={enhancedImage} alt="Cleaned doc" className="w-full h-auto block pointer-events-none" />
            
            {boxes.map((box) => (
              <div 
                key={box.id} 
                className="absolute border-2 border-emerald-500 bg-emerald-500/10"
                style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.width*100}%`, height: `${box.height*100}%` }}
              >
                <span className="bg-emerald-500 text-black text-[10px] font-black px-1 rounded-br">
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

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('camera')} className="bg-slate-800 py-2 rounded font-bold text-sm">Retake</button>
            <button onClick={() => setBoxes([])} className="bg-rose-900/50 text-rose-400 py-2 rounded font-bold text-sm">Clear</button>
          </div>

          <button 
            onClick={sendToBackendAI}
            disabled={isProcessing}
            className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-lg"
          >
            {isProcessing ? "Reading..." : "Read Taught Variables"}
          </button>
        </div>
      )}

      {mode === 'results' && (
        <div className="flex-1 flex flex-col justify-between">
          <div className="bg-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="text-md font-bold text-green-400 mb-3">✓ EXTRACTED DATA:</h2>
            <div className="space-y-3">
              {ocrResults && Object.entries(ocrResults).map(([key, val]) => (
                <div key={key} className="bg-slate-900 p-3 rounded font-mono">
                  <div className="text-[11px] text-slate-500 font-bold">{key}</div>
                  <div className="text-white text-sm mt-1">{val || "[Unreadable]"}</div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setMode('camera')} className="w-full mt-6 bg-slate-800 text-white py-3.5 rounded-xl font-bold">
            Scan New Document
          </button>
        </div>
      )}

      <canvas ref={processedCanvasRef} className="hidden" />
    </div>
  );
}