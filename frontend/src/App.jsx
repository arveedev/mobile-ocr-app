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
  
  // NEW: State to track original AI guesses vs User edits
  const [ocrResults, setOcrResults] = useState(null);
  const [originalResults, setOriginalResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const EXPORT_WIDTH = 800;
  const EXPORT_HEIGHT = 1100;

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
          let gray = new window.cv.Mat();
          
          window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
          window.cv.GaussianBlur(gray, gray, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
          window.cv.Canny(gray, gray, 50, 150, 3, false);
          
          let M_dilate = window.cv.Mat.ones(3, 3, window.cv.CV_8U);
          window.cv.dilate(gray, gray, M_dilate, new window.cv.Point(-1, -1), 1, window.cv.BORDER_CONSTANT, window.cv.morphologyDefaultBorderValue());

          let contours = new window.cv.MatVector();
          let hierarchy = new window.cv.Mat();
          window.cv.findContours(gray, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
          
          let maxArea = 0;
          let bestContour = null;
          let isPerfectSquare = false;
          
          for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = window.cv.contourArea(cnt);
            
            if (area > (canvas.width * canvas.height * 0.10) && area > maxArea) { 
              let approx = new window.cv.Mat();
              let peri = window.cv.arcLength(cnt, true);
              
              window.cv.approxPolyDP(cnt, approx, 0.05 * peri, true);
              
              if (bestContour) bestContour.delete();
              
              if (approx.rows === 4) {
                bestContour = approx.clone();
                isPerfectSquare = true;
                maxArea = area;
              } else {
                bestContour = approx.clone();
                isPerfectSquare = false;
                maxArea = area;
              }
              approx.delete();
            }
          }
          
          if (bestContour) {
            ctx.strokeStyle = isPerfectSquare ? "#00ff00" : "#ffcc00"; 
            ctx.lineWidth = 6;
            ctx.beginPath();
            
            let pts = bestContour.rows;
            for (let i = 0; i < pts; i++) {
              let x = bestContour.data32S[i * 2];
              let y = bestContour.data32S[i * 2 + 1];
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();

            ctx.fillStyle = isPerfectSquare ? "#00ff00" : "#ffcc00";
            for (let i = 0; i < pts; i++) {
              ctx.beginPath();
              ctx.arc(bestContour.data32S[i * 2], bestContour.data32S[i * 2 + 1], 8, 0, 2 * Math.PI);
              ctx.fill();
            }
            
            bestContour.delete();
          }
          
          src.delete(); gray.delete(); M_dilate.delete(); contours.delete(); hierarchy.delete();
        } catch (err) {
          // ignore dropped frames
        }
      }
      requestAnimationFrame(processFrame);
    };
    requestAnimationFrame(processFrame);
  };

  const orderPoints = (pts) => {
    let sortedX = [...pts].sort((a, b) => a.x - b.x);
    let left = [sortedX[0], sortedX[1]].sort((a, b) => a.y - b.y);
    let right = [sortedX[2], sortedX[3]].sort((a, b) => a.y - b.y);
    return [left[0], right[0], right[1], left[1]]; 
  };

  const captureAndCleanDocument = () => {
    if (!webcamRef.current) return;
    const screenshot = webcamRef.current.getScreenshot();
    
    const img = new Image();
    img.src = screenshot;
    img.onload = () => {
      try {
        let src = window.cv.imread(img);
        let gray = new window.cv.Mat();
        
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
        window.cv.GaussianBlur(gray, gray, new window.cv.Size(5, 5), 0, 0, window.cv.BORDER_DEFAULT);
        window.cv.Canny(gray, gray, 50, 150, 3, false);
        
        let M_dilate = window.cv.Mat.ones(3, 3, window.cv.CV_8U);
        window.cv.dilate(gray, gray, M_dilate, new window.cv.Point(-1, -1), 1, window.cv.BORDER_CONSTANT, window.cv.morphologyDefaultBorderValue());

        let contours = new window.cv.MatVector();
        let hierarchy = new window.cv.Mat();
        window.cv.findContours(gray, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
        
        let maxArea = 0;
        let docContour = null;
        
        for (let i = 0; i < contours.size(); ++i) {
          let cnt = contours.get(i);
          let area = window.cv.contourArea(cnt);
          if (area > 10000) {
            let approx = new window.cv.Mat();
            window.cv.approxPolyDP(cnt, approx, 0.05 * window.cv.arcLength(cnt, true), true);
            if (approx.rows === 4 && area > maxArea) {
              maxArea = area;
              if (docContour) docContour.delete();
              docContour = approx.clone();
            }
            approx.delete();
          }
        }
        
        let finalMat = new window.cv.Mat();
        
        if (docContour) {
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
            0, 0, EXPORT_WIDTH, 0, EXPORT_WIDTH, EXPORT_HEIGHT, 0, EXPORT_HEIGHT
          ]);
          
          let M = window.cv.getPerspectiveTransform(srcTri, dstTri);
          window.cv.warpPerspective(src, finalMat, M, new window.cv.Size(EXPORT_WIDTH, EXPORT_HEIGHT));
          
          srcTri.delete(); dstTri.delete(); M.delete(); docContour.delete();
        } else {
          window.cv.resize(src, finalMat, new window.cv.Size(EXPORT_WIDTH, EXPORT_HEIGHT));
        }
        
        const canvas = processedCanvasRef.current;
        canvas.width = EXPORT_WIDTH;
        canvas.height = EXPORT_HEIGHT;
        window.cv.imshow(canvas, finalMat);
        
        setEnhancedImage(canvas.toDataURL('image/jpeg', 1.0));
        
        src.delete(); gray.delete(); M_dilate.delete(); contours.delete(); hierarchy.delete(); finalMat.delete();
        
        setMode('tagging');
        if (savedTemplates[templateName]) {
          setBoxes(savedTemplates[templateName]);
        } else {
          setBoxes([]);
        }
      } catch (err) {
        console.error("Processing failed", err);
        alert("Image processing failed.");
      }
    };
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
    try {
      const res = await fetch(enhancedImage);
      const blob = await res.blob();
      const file = new File([blob], "scan.jpg", { type: "image/jpeg" });

      const absoluteBoxes = boxes.map(b => ({
        name: b.name,
        x: Math.round(b.x * EXPORT_WIDTH),
        y: Math.round(b.y * EXPORT_HEIGHT),
        width: Math.round(b.width * EXPORT_WIDTH),
        height: Math.round(b.height * EXPORT_HEIGHT)
      }));

      const formData = new FormData();
      formData.append("image", file);
      formData.append("boxes", JSON.stringify(absoluteBoxes));
      formData.append("template_name", templateName); // NEW: Send the document profile

      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      
      // Store both the editable copy and the original AI copy
      setOcrResults(response.data.data);
      setOriginalResults(response.data.data);
      setMode('results');
    } catch (err) {
      console.error(err);
      alert("Error reading document. Make sure your HuggingFace backend is awake.");
    } finally {
      setIsProcessing(false);
    }
  };

  // NEW FUNCTION: Send correction to backend to learn
  const teachApp = async (key) => {
    const originalText = originalResults[key];
    const newText = ocrResults[key];
    
    if (originalText === newText) return; // Nothing changed

    try {
      await axios.post('https://arvee120-my-ocr-brain.hf.space/correct', {
        template_name: templateName,
        field_name: key,
        original_text: originalText,
        corrected_text: newText
      });
      
      // Update original so button hides, proving it was saved
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
          <div className="flex-1 relative rounded-xl overflow-hidden border-2 border-slate-700 bg-black mb-4">
            <Webcam 
              audio={false} 
              ref={webcamRef} 
              screenshotFormat="image/jpeg"
              screenshotQuality={1}
              videoConstraints={{ facingMode: "environment" }}
              className="absolute inset-0 w-full h-full object-cover opacity-0" 
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
            
            <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-xs text-white shadow font-bold tracking-wider animate-pulse">
              {cvReady ? "🟢 LASER GUIDE ON" : "⚪ LOADING AI..."}
            </div>
          </div>
          
          <button 
            onClick={captureAndCleanDocument}
            disabled={!cvReady}
            className="w-full shrink-0 bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg mb-2 transition-transform active:scale-95"
          >
            📸 Capture Paper
          </button>
        </div>
      )}

      {mode === 'tagging' && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="text-center shrink-0">
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">FLATTENED IMAGE</span>
          </div>

          <div 
            className="flex-1 relative w-full rounded border border-slate-700 touch-none select-none bg-slate-950 overflow-hidden"
            onMouseDown={startDrawing} onMouseMove={drawMove} onMouseUp={endDrawing}
            onTouchStart={startDrawing} onTouchMove={drawMove} onTouchEnd={endDrawing}
          >
            <img src={enhancedImage} alt="Cleaned doc" className="w-full h-full object-contain block pointer-events-none" />
            
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

          <div className="grid grid-cols-2 gap-2 shrink-0">
            <button onClick={() => setMode('camera')} className="bg-slate-800 py-3 rounded-xl font-bold text-sm">Retake</button>
            <button onClick={() => setBoxes([])} className="bg-rose-900/50 text-rose-400 py-3 rounded-xl font-bold text-sm">Clear Boxes</button>
          </div>

          <button 
            onClick={sendToBackendAI}
            disabled={isProcessing}
            className="w-full shrink-0 bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg mb-2"
          >
            {isProcessing ? "Reading..." : "Read Taught Variables"}
          </button>
        </div>
      )}

      {mode === 'results' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex-1 bg-slate-800 rounded-xl p-4 shadow-xl overflow-y-auto">
            <h2 className="text-md font-bold text-green-400 mb-3">✓ EXTRACTED DATA (EDITABLE):</h2>
            <div className="space-y-3">
              {/* NEW: Editable Input Fields instead of static text */}
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
                    
                    {/* Show "Teach App" button ONLY if the user changed the text */}
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
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
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

      <canvas ref={processedCanvasRef} className="hidden" />
    </div>
  );
}