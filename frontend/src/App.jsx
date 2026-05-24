import React, { useRef, useState } from 'react';
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

  // We capture at a standard high-res size so coordinates always match
  const EXPORT_WIDTH = 1080;
  const EXPORT_HEIGHT = 1440;

  const captureDocument = () => {
    if (!webcamRef.current) return;
    const screenshot = webcamRef.current.getScreenshot();
    
    // Instead of glitchy auto-cropping, we just take the high-res photo directly
    const img = new Image();
    img.src = screenshot;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_WIDTH;
      canvas.height = EXPORT_HEIGHT;
      const ctx = canvas.getContext('2d');
      
      // Draw the image filling our standard canvas
      ctx.drawImage(img, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      setCapturedImage(canvas.toDataURL('image/jpeg', 0.9));
      
      setMode('tagging');
      if (savedTemplates[templateName]) {
        setBoxes(savedTemplates[templateName]);
      } else {
        setBoxes([]);
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
      const res = await fetch(capturedImage);
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
      formData.append("template_name", templateName);

      const response = await axios.post('https://arvee120-my-ocr-brain.hf.space/scan', formData);
      
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
              videoConstraints={{ facingMode: "environment", aspectRatio: 3/4 }}
              className="absolute inset-0 w-full h-full object-cover" 
            />
            
            {/* STATIC ALIGNMENT GUIDE */}
            <div className="absolute inset-4 border-2 border-dashed border-white/70 rounded-lg pointer-events-none flex flex-col justify-center items-center">
               <div className="bg-black/50 px-3 py-1 rounded text-white text-xs font-bold tracking-wider mb-2">
                 ALIGN DOCUMENT INSIDE LINES
               </div>
            </div>
          </div>
          
          <button 
            onClick={captureDocument}
            className="w-full shrink-0 bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg mb-2 transition-transform active:scale-95"
          >
            📸 Capture Document
          </button>
        </div>
      )}

      {mode === 'tagging' && (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="text-center shrink-0">
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">DRAW EXTRACTION BOXES</span>
          </div>

          <div 
            className="flex-1 relative w-full rounded border border-slate-700 touch-none select-none bg-slate-950 overflow-hidden"
            onMouseDown={startDrawing} onMouseMove={drawMove} onMouseUp={endDrawing}
            onTouchStart={startDrawing} onTouchMove={drawMove} onTouchEnd={endDrawing}
          >
            <img src={capturedImage} alt="Captured doc" className="w-full h-full object-cover block pointer-events-none" />
            
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
            <button onClick={() => setMode('camera')} className="bg-slate-800 py-3 rounded-xl font-bold text-sm">Retake Photo</button>
            <button onClick={() => setBoxes([])} className="bg-rose-900/50 text-rose-400 py-3 rounded-xl font-bold text-sm">Clear Boxes</button>
          </div>

          <button 
            onClick={sendToBackendAI}
            disabled={isProcessing}
            className="w-full shrink-0 bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg mb-2 flex justify-center items-center gap-2"
          >
            {isProcessing ? "Reading Document..." : "Read Taught Variables"}
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
    </div>
  );
}