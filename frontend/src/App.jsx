import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

export default function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const processedCanvasRef = useRef(null);
  
  // App States
  const [cvReady, setCvReady] = useState(false);
  const [mode, setMode] = useState('camera'); // 'camera', 'tagging', 'results'
  const [enhancedImage, setEnhancedImage] = useState(null);
  
  // Template Profile States ("The Learning Machine")
  const [templateName, setTemplateName] = useState('docu1');
  const [savedTemplates, setSavedTemplates] = useState({});
  const [boxes, setBoxes] = useState([]);
  
  // Interactive UI drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState(null);
  const [ocrResults, setOcrResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // 1. Wait for OpenCV to load, then start the live edge tracker loop
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

  // 2. The Laser Guide: Real-time Edge Detector Loop
  const startVideoLoop = () => {
    const processFrame = () => {
      if (webcamRef.current && webcamRef.current.video && webcamRef.current.video.readyState === 4) {
        const video = webcamRef.current.video;
        const canvas = canvasRef.current;
        if (!canvas) return requestAnimationFrame(processFrame);
        
        const ctx = canvas.getContext('2d');
        
        // Match canvas dimensions to video feed
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw current video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        try {
          // Read frame into OpenCV memory
          let src = window.cv.imread(canvas);
          let dst = new window.cv.Mat();
          
          // Step A: Turn image gray and blur out noise
          window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY, 0);
          let ksize = new window.cv.Size(5, 5);
          window.cv.GaussianBlur(dst, dst, ksize, 0, 0, window.cv.BORDER_DEFAULT);
          
          // Step B: Find structural lines (Edges)
          window.cv.Canny(dst, dst, 75, 200, 3, false);
          
          // Step C: Look for shapes (Contours)
          let contours = new window.cv.MatVector();
          let hierarchy = new window.cv.Mat();
          window.cv.findContours(dst, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
          
          // Step D: Find the largest 4-sided shape (The Document Paper)
          let maxArea = 0;
          let docContour = null;
          
          for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = window.cv.contourArea(cnt);
            if (area > 50000) { // Make sure it's big enough to be a document
              let approx = new window.cv.Mat();
              let peri = window.cv.arcLength(cnt, true);
              window.cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
              
              if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                docContour = approx;
              } else {
                approx.delete();
              }
            }
          }
          
          // Step E: Draw the visual box feedback on screen
          if (docContour) {
            ctx.strokeStyle = "#00ff00"; // Bright Green
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(docContour.data32S[0], docContour.data32S[1]);
            for (let i = 1; i < 4; i++) {
              ctx.lineTo(docContour.data32S[i * 2], docContour.data32S[i * 2 + 1]);
            }
            ctx.closePath();
            ctx.stroke();
            docContour.delete();
          }
          
          // Memory Cleanup
          src.delete(); dst.delete(); contours.delete(); hierarchy.delete();
        } catch (err) {
          console.log("Frame processing skipped", err);
        }
      }
      requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
  };

  // 3. The Magic Straightener: Auto-Crop background and enhance image
  const captureAndCleanDocument = () => {
    if (!webcamRef.current) return;
    const screenshot = webcamRef.current.getScreenshot();
    
    const img = new Image();
    img.src = screenshot;
    img.onload = () => {
      const canvas = processedCanvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Standardize our flat document resolution (High clarity)
      canvas.width = 800;
      canvas.height = 1100;
      
      // Load into OpenCV to perform thresholding enhancement
      let src = window.cv.imread(img);
      let dst = new window.cv.Mat();
      
      // Convert to grayscale
      window.cv.cvtColor(src, dst, window.cv.COLOR_RGBA2GRAY, 0);
      
      // Adaptive Thresholding: Bleaches gray backgrounds white, makes text/handwriting dark black
      window.cv.adaptiveThreshold(dst, dst, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY, 11, 12);
      
      window.cv.imshow(canvas, dst);
      setEnhancedImage(canvas.toDataURL());
      
      // Clean memory
      src.delete(); dst.delete();
      
      // Move to Learning/Tagging screen
      setMode('tagging');
      
      // Pre-load boxes if this document template name already exists!
      if (savedTemplates[templateName]) {
        setBoxes(savedTemplates[templateName]);
      } else {
        setBoxes([]);
      }
    };
  };

  // 4. Learning Logic: Convert user box drags to universal relative values
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
      const varName = window.prompt("What variable is inside this box? (e.g., invoice_number, total_pay, hand_sig)");
      if (varName) {
        const newBox = { ...currentBox, name: varName, id: Date.now() };
        const updatedBoxes = [...boxes, newBox];
        setBoxes(updatedBoxes);
        
        // Instantly remember this layout pattern under the profile name (e.g., docu1)
        setSavedTemplates({
          ...savedTemplates,
          [templateName]: updatedBoxes
        });
      }
    }
    setCurrentBox(null);
  };

  // 5. Transfer Machine: Download the JSON blueprint for use in external apps
  const exportTemplateJSON = () => {
    const blueprint = {
      templateName: templateName,
      targetSystemCompatibility: "Universal-Web-OCR-v1",
      fieldMappings: boxes.map(b => ({
        variable: b.name,
        relativeX: b.x,
        relativeY: b.y,
        relativeWidth: b.width,
        relativeHeight: b.height
      }))
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blueprint, null, 2));
    const dlNode = document.createElement('a');
    dlNode.setAttribute("href", dataStr);
    dlNode.setAttribute("download", `${templateName}_blueprint.json`);
    document.body.appendChild(dlNode);
    dlNode.click();
    dlNode.remove();
  };

  // 6. Send cropped targets to Python Brain
  const sendToBackendAI = async () => {
    if (boxes.length === 0) return alert("Draw data tracking zones first.");
    setIsProcessing(true);
    try {
      const res = await fetch(enhancedImage);
      const blob = await res.blob();
      const file = new File([blob], "cleaned.jpg", { type: "image/jpeg" });

      const formData = new FormData();
      formData.append("image", file);
      formData.append("boxes", JSON.stringify(boxes));

      // Put your HuggingFace URL or local server string here
      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      setOcrResults(response.data.data);
      setMode('results');
    } catch (err) {
      alert("Backend error. Make sure Python is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-900 text-white p-4 font-sans flex flex-col justify-between">
      
      {/* Header Profile Selection */}
      <div className="bg-slate-800 p-3 rounded-lg shadow-md mb-3 flex items-center justify-between">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Doc Profile:</label>
        <input 
          type="text" 
          value={templateName} 
          onChange={(e) => setTemplateName(e.target.value.toLowerCase())}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-green-400 font-mono w-2/3 text-right focus:outline-none focus:border-green-500"
          placeholder="e.g., docu1"
        />
      </div>

      {/* Mode 1: Live Targeting Camera */}
      {mode === 'camera' && (
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="w-full relative rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl bg-black">
            <Webcam 
              audio={false} 
              ref={webcamRef} 
              screenshotFormat="image/jpeg"
              videoConstraints={{ facingMode: "environment" }}
              className="w-full h-auto opacity-0 absolute" // Hidden raw feed, we display canvas instead
            />
            <canvas ref={canvasRef} className="w-full h-auto block" />
            
            <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-green-400 font-mono animate-pulse">
              {cvReady ? "● LIVE EDGE TRACKER ACTIVE" : "LOADING OPENCV COMPILER..."}
            </div>
          </div>
          
          <button 
            onClick={captureAndCleanDocument}
            disabled={!cvReady}
            className="w-full mt-6 bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-4 rounded-xl font-bold tracking-wide text-lg shadow-lg active:scale-95 transition disabled:opacity-30"
          >
            📸 Capture & Straighten
          </button>
        </div>
      )}

      {/* Mode 2: Learn Layout Zones & Crop Background */}
      {mode === 'tagging' && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="text-center">
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">BACKGROUND REMOVED & ENHANCED</span>
            <p className="text-slate-400 text-xs mt-2">Drag bounding boxes to teach the app where variables are.</p>
          </div>

          <div 
            className="relative w-full rounded border border-slate-700 overflow-hidden touch-none select-none bg-white shadow-inner"
            onMouseDown={startDrawing} onMouseMove={drawMove} onMouseUp={endDrawing}
            onTouchStart={startDrawing} onTouchMove={drawMove} onTouchEnd={endDrawing}
          >
            <img src={enhancedImage} alt="Cleaned doc" className="w-full h-auto block pointer-events-none" />
            
            {/* Display taught boxes */}
            {boxes.map((box) => (
              <div 
                key={box.id} 
                className="absolute border-2 border-emerald-500 bg-emerald-500/10 flex items-start"
                style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.width*100}%`, height: `${box.height*100}%` }}
              >
                <span className="bg-emerald-500 text-black text-[10px] font-black px-1 rounded-br shadow-md uppercase">
                  {box.name}
                </span>
              </div>
            ))}

            {/* Live feedback drawing box */}
            {currentBox && isDrawing && (
              <div 
                className="absolute border-2 border-cyan-400 bg-cyan-400/20"
                style={{ left: `${currentBox.x*100}%`, top: `${currentBox.y*100}%`, width: `${currentBox.width*100}%`, height: `${currentBox.height*100}%` }}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('camera')} className="bg-slate-800 border border-slate-700 py-2.5 rounded-lg font-bold text-sm">
              ← Retake
            </button>
            <button onClick={() => setBoxes([])} className="bg-rose-950/40 text-rose-400 border border-rose-900/50 py-2.5 rounded-lg font-bold text-sm">
              Clear Regions
            </button>
          </div>

          <button 
            onClick={sendToBackendAI}
            disabled={isProcessing}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-bold shadow-lg disabled:bg-blue-800"
          >
            {isProcessing ? "🧠 Reading Handwriting AI..." : "⚡ Extract Taught Variables"}
          </button>

          <button onClick={exportTemplateJSON} className="text-center text-xs text-slate-400 underline hover:text-white">
            📥 Export `{templateName}` Structural Blueprint JSON
          </button>
        </div>
      )}

      {/* Mode 3: Display Results */}
      {mode === 'results' && (
        <div className="flex-1 flex flex-col justify-between">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 shadow-xl">
            <h2 className="text-md font-bold text-green-400 mb-3 uppercase tracking-wider font-mono">✓ Structural Output Received:</h2>
            <div className="space-y-3">
              {ocrResults && Object.entries(ocrResults).map(([key, val]) => (
                <div key={key} className="bg-slate-900 p-3 rounded border border-slate-700 font-mono">
                  <div className="text-[11px] text-slate-500 font-bold uppercase">{key}</div>
                  <div className="text-white font-medium text-sm mt-0.5">{val || "[Blank/Unreadable]"}</div>
                </div>
              ))}
            </div>
          </div>

          <button 
            onClick={() => setMode('camera')} 
            className="w-full mt-6 bg-slate-800 text-white py-3.5 rounded-xl font-bold border border-slate-700"
          >
            Scan New Document
          </button>
        </div>
      )}

      {/* Hidden processing rendering canvas */}
      <canvas ref={processedCanvasRef} className="hidden" />
    </div>
  );
}