import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import HistoryPanel from './HistoryPanel';
import './App.css';

const API_BASE = 'http://localhost:8000';

// Emotion → emoji + color
const EMOTION_EMOJI = {
  angry:'😠', disgust:'🤢', fear:'😨', happy:'😄',
  sad:'😢', surprise:'😲', neutral:'😐', contempt:'😒',
  // FERPlus capitalized versions
  anger:'😠', happiness:'😄', sadness:'😢',
};
const EMOTION_COLORS = {
  happiness:'#4ade80', happy:'#4ade80',
  surprise:'#fbbf24', sadness:'#60a5fa', sad:'#60a5fa',
  anger:'#f87171', angry:'#f87171', fear:'#a78bfa',
  disgust:'#34d399', contempt:'#fb923c', neutral:'#94a3b8',
};

// ── Canvas drawing (shared for both modes) ────────────────────────────────────
function drawFacesOnCanvas(canvas, faces, imgW, imgH, mode = 'uniface') {
  const ctx = canvas.getContext('2d');
  const sx = canvas.width  / imgW;
  const sy = canvas.height / imgH;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  faces.forEach((face) => {
    const [x1, y1, x2, y2] = face.bbox.map((v, idx) =>
      Math.round(idx % 2 === 0 ? v * sx : v * sy)
    );

    // Color: gender-based for uniface, emotion-based for deepface
    let color = '#00d4ff';
    if (mode === 'uniface') {
      const gender = (face.gender || '').toLowerCase();
      color = gender === 'female' ? '#f472b6' : gender === 'male' ? '#60a5fa' : '#00d4ff';
    } else {
      const emo = (face.emotion || '').toLowerCase();
      color = EMOTION_COLORS[emo] || '#fbbf24';
    }

    // Glow box
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.strokeRect(x1, y1, x2-x1, y2-y1);
    ctx.shadowBlur = 0;

    // Corner marks
    ctx.lineWidth = 3;
    const cs = 14;
    [[x1,y1,1,1],[x2,y1,-1,1],[x1,y2,1,-1],[x2,y2,-1,-1]].forEach(([cx,cy,sdx,sdy]) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy+sdy*cs); ctx.lineTo(cx, cy); ctx.lineTo(cx+sdx*cs, cy);
      ctx.stroke();
    });

    // Landmarks (uniface only)
    (face.landmarks || []).forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.arc(Math.round(lx*sx), Math.round(ly*sy), 3, 0, Math.PI*2);
      ctx.fillStyle = '#ff6400'; ctx.shadowColor = '#ff6400'; ctx.shadowBlur = 6;
      ctx.fill(); ctx.shadowBlur = 0;
    });

    // Label
    const fs = Math.max(12, Math.round(12 * sx));
    ctx.font = `bold ${fs}px Outfit, sans-serif`;
    let lines = [];
    if (mode === 'uniface') {
      const emoEmoji = EMOTION_EMOJI[(face.emotion||'').toLowerCase()] || '';
      const g = (face.gender||'').toLowerCase() === 'female' ? '♀' : (face.gender||'').toLowerCase() === 'male' ? '♂' : '?';
      const age = face.age != null ? `${Math.round(face.age)}y` : '??';
      lines.push(`${g} ${age} · ${(face.confidence*100).toFixed(0)}%`);
      if (face.emotion) lines.push(`${emoEmoji} ${face.emotion}`);
    } else {
      const emoEmoji = EMOTION_EMOJI[(face.emotion||'').toLowerCase()] || '😐';
      const conf = face.emotion_confidence != null ? `${(face.emotion_confidence*100).toFixed(0)}%` : '';
      lines.push(`${emoEmoji} ${face.emotion || '?'} ${conf}`);
    }

    const lh = fs + 8;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bh = lh * lines.length + 8;
    const ly_ = y1 > bh+4 ? y1-bh-4 : y2+4;
    ctx.fillStyle = color; ctx.globalAlpha = 0.88;
    ctx.beginPath(); ctx.roundRect(x1, ly_, tw+14, bh, 6); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, x1+7, ly_+(i+1)*lh-2));

    // DeepFace: mini all_emotions bars inside bounding box
    if (mode === 'deepface' && face.all_emotions) {
      const sorted = Object.entries(face.all_emotions).sort((a,b) => b[1]-a[1]).slice(0, 4);
      let barY = y1 + 6;
      sorted.forEach(([emo, prob]) => {
        const barW = Math.max(4, Math.round((x2-x1-12) * prob));
        const bc   = EMOTION_COLORS[emo.toLowerCase()] || '#aaa';
        ctx.fillStyle = bc; ctx.globalAlpha = 0.75;
        ctx.fillRect(x1+6, barY, barW, 6);
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(9, fs-3)}px Outfit, sans-serif`;
        ctx.fillText(emo.slice(0,3), x1+barW+9, barY+6);
        ctx.globalAlpha = 1;
        barY += 10;
      });
    }
  });
}

// ── Shared UI components ──────────────────────────────────────────────────────
function StatusBadge({ status, dfReady }) {
  const map = {
    ready:   { label:'UniFace Ready', cls:'' },
    loading: { label:'Loading…',      cls:'loading' },
    error:   { label:'Offline',       cls:'error' },
  };
  const { label, cls } = map[status] || map.loading;
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <div className="header-badge">
        <div className={`status-dot ${cls}`} />
        {label}
      </div>
      <div className="header-badge" style={{
        background: dfReady ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
        borderColor: dfReady ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)',
        color: dfReady ? '#fbbf24' : 'rgba(255,255,255,0.3)',
      }}>
        <div className="status-dot" style={{
          background: dfReady ? '#fbbf24' : '#475569',
          boxShadow: dfReady ? '0 0 8px #fbbf24' : 'none',
        }} />
        DeepFace {dfReady ? 'Ready' : 'N/A'}
      </div>
    </div>
  );
}

function EmotionBar({ emotion, confidence }) {
  if (!emotion) return null;
  const emoji = EMOTION_EMOJI[(emotion||'').toLowerCase()] || '😐';
  const pct   = confidence != null ? Math.round(confidence * 100) : null;
  const col   = EMOTION_COLORS[(emotion||'').toLowerCase()] || '#00d4ff';
  return (
    <div className="emotion-bar-wrap">
      <div className="emotion-bar-label">
        <span style={{ fontSize:'1.1rem' }}>{emoji}</span>
        <span style={{ color: col, fontWeight:700 }}>{emotion}</span>
        {pct != null && <span style={{ marginLeft:'auto', color:'rgba(255,255,255,0.5)', fontSize:'0.75rem' }}>{pct}%</span>}
      </div>
      {pct != null && (
        <div className="emotion-bar-track">
          <div className="emotion-bar-fill" style={{ width:`${pct}%`, background: col }} />
        </div>
      )}
    </div>
  );
}

function AllEmotionsPanel({ allEmotions }) {
  if (!allEmotions || Object.keys(allEmotions).length === 0) return null;
  const sorted = Object.entries(allEmotions).sort((a,b) => b[1]-a[1]);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:4 }}>
      {sorted.map(([emo, prob]) => {
        const col = EMOTION_COLORS[emo.toLowerCase()] || '#94a3b8';
        const pct = Math.round(prob * 100);
        const emoji = EMOTION_EMOJI[emo.toLowerCase()] || '😐';
        return (
          <div key={emo} style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:'0.85rem', width:20 }}>{emoji}</span>
            <span style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.5)', width:64 }}>{emo}</span>
            <div style={{ flex:1, height:5, background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden' }}>
              <div style={{ width:`${pct}%`, height:'100%', background:col, borderRadius:3,
                transition:'width 0.5s ease' }} />
            </div>
            <span style={{ fontSize:'0.68rem', color:col, width:30, textAlign:'right' }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── UniFace face card ─────────────────────────────────────────────────────────
function ClassificationCard({ face, index }) {
  const gClass = (face.gender||'').toLowerCase();
  return (
    <div className="face-card">
      <div className="face-card-header">
        <div className="face-number">{index+1}</div>
        <div style={{ flex:1 }}>
          <div className="face-label">Face #{index+1}</div>
          {face.classification && (
            <div style={{ fontSize:'0.72rem', color:'rgba(255,255,255,0.4)', marginTop:2 }}>
              {face.classification}
            </div>
          )}
        </div>
        <div className="face-conf">{(face.confidence*100).toFixed(1)}%</div>
      </div>
      <div className="face-attrs">
        <div className="attr-item">
          <div className="attr-label">Gender</div>
          <div className={`attr-value ${gClass}`}>{face.gender || '—'}</div>
        </div>
        <div className="attr-item">
          <div className="attr-label">Age</div>
          <div className="attr-value">{face.age != null ? `${Math.round(face.age)}y` : '—'}</div>
        </div>
        <div className="attr-item">
          <div className="attr-label">Landmarks</div>
          <div className="attr-value">{face.landmarks ? `${face.landmarks.length} pts` : '—'}</div>
        </div>
        <div className="attr-item">
          <div className="attr-label">Confidence</div>
          <div className="attr-value">{(face.confidence*100).toFixed(1)}%</div>
        </div>
        {face.emotion && (
          <div className="attr-item" style={{ gridColumn:'1/-1' }}>
            <div className="attr-label">Emotion Recognition</div>
            <EmotionBar emotion={face.emotion} confidence={face.emotion_confidence} />
          </div>
        )}
        <div className="attr-item bbox-item">
          <div className="attr-label">Bounding Box</div>
          <div className="bbox-coords">[{face.bbox.map(v=>Math.round(v)).join(', ')}]</div>
        </div>
      </div>
    </div>
  );
}

// ── DeepFace face card ────────────────────────────────────────────────────────
function DeepFaceCard({ face, index }) {
  const emoji = EMOTION_EMOJI[(face.emotion||'').toLowerCase()] || '😐';
  const col   = EMOTION_COLORS[(face.emotion||'').toLowerCase()] || '#fbbf24';
  const conf  = Math.round((face.emotion_confidence||0)*100);
  return (
    <div className="face-card" style={{ borderColor: col + '33' }}>
      <div className="face-card-header">
        <div className="face-number" style={{ background: col }}>{index+1}</div>
        <div style={{ flex:1 }}>
          <div className="face-label">
            <span style={{ marginRight:6 }}>{emoji}</span>
            {face.emotion || 'Unknown'}
          </div>
          <div style={{ fontSize:'0.72rem', color: col, marginTop:2 }}>
            DeepFace · FERPlus ONNX · {conf}% confidence
          </div>
        </div>
      </div>
      <div className="face-attrs">
        <div className="attr-item" style={{ gridColumn:'1/-1' }}>
          <div className="attr-label">All Emotions — FERPlus 8-Class</div>
          <AllEmotionsPanel allEmotions={face.all_emotions} />
        </div>
        <div className="attr-item bbox-item">
          <div className="attr-label">Bounding Box (Haar Cascade)</div>
          <div className="bbox-coords">[{face.bbox.map(v=>Math.round(v)).join(', ')}]</div>
        </div>
      </div>
    </div>
  );
}

function StatBadge({ value, label }) {
  return (
    <div className="stat-badge">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
    </div>
  );
}

// ── Mode Toggle ───────────────────────────────────────────────────────────────
function ModeToggle({ mode, setMode }) {
  return (
    <div className="df-mode-toggle">
      <button
        id="mode-uniface-btn"
        className={`df-mode-btn ${mode === 'uniface' ? 'active' : ''}`}
        onClick={() => setMode('uniface')}
      >
        <span>⚡</span>
        <div>
          <div>UniFace Mode</div>
          <div style={{ fontSize:'0.65rem', opacity:0.6 }}>SCRFD · AgeGender · Fast</div>
        </div>
      </button>
      <button
        id="mode-deepface-btn"
        className={`df-mode-btn deepface ${mode === 'deepface' ? 'active' : ''}`}
        onClick={() => setMode('deepface')}
      >
        <span>🧠</span>
        <div>
          <div>DeepFace Mode</div>
          <div style={{ fontSize:'0.65rem', opacity:0.6 }}>Haar · FERPlus ONNX · 8 Emotions</div>
        </div>
      </button>
    </div>
  );
}

// ── Upload Panel ──────────────────────────────────────────────────────────────
function UploadPanel({ onResult, mode, privacyMode }) {
  const [dragging,   setDragging]   = useState(false);
  const [preview,    setPreview]    = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState(null);
  const canvasRef = useRef(null);
  const inputRef  = useRef(null);
  const imgRef    = useRef(null);

  const analyzeFile = useCallback(async (file) => {
    if (!file?.type.startsWith('image/')) { setError('Please upload a valid image.'); return; }
    setError(null); setProcessing(true);
    setPreview(URL.createObjectURL(file));
    const fd = new FormData(); fd.append('file', file);
    const endpoint = mode === 'deepface' ? `/analyze/deepface?privacy_mode=${privacyMode}` : `/analyze?privacy_mode=${privacyMode}`;
    try {
      const res  = await fetch(`${API_BASE}${endpoint}`, { method:'POST', body:fd });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      onResult(data, 'image', mode);
      setTimeout(() => {
        const img=imgRef.current, cvs=canvasRef.current;
        if (img && cvs) {
          cvs.width=img.offsetWidth; cvs.height=img.offsetHeight;
          drawFacesOnCanvas(cvs, data.faces, img.naturalWidth, img.naturalHeight, mode);
        }
      }, 150);
    } catch(e) { setError(`${e.message} — Is the backend running?`); }
    finally    { setProcessing(false); }
  }, [onResult, mode, privacyMode]);

  const analyzeMatting = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) { setError('Select an image via browse to remove background.'); return; }
    setError(null); setProcessing(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/matting`, { method:'POST', body:fd });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      setPreview(`data:image/png;base64,${data.annotated_image}`);
      if(canvasRef.current) canvasRef.current.getContext('2d').clearRect(0,0,canvasRef.current.width, canvasRef.current.height);
    } catch(e) { setError(`${e.message} — Matting failed.`); }
    finally { setProcessing(false); }
  };

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); analyzeFile(e.dataTransfer.files[0]); }, [analyzeFile]);

  const modeLabel = mode === 'deepface' ? '🧠 DeepFace Analysis' : '🖼️ Image Analysis';
  const modeSubtitle = mode === 'deepface'
    ? 'Haar Cascade + FERPlus ONNX (8 emotions)'
    : 'Upload a photo for face detection';

  return (
    <div className="card upload-card" style={{
      borderColor: mode === 'deepface' ? 'rgba(251,191,36,0.4)' : 'rgba(0,212,255,0.2)',
      boxShadow: mode === 'deepface' ? '0 0 30px rgba(251,191,36,0.05)' : undefined
    }}>
      <div className="card-header">
        <div className="card-icon" style={{
          background: mode === 'deepface' ? 'rgba(251,191,36,0.15)' : 'rgba(0,212,255,0.15)',
          boxShadow: mode === 'deepface' ? '0 0 20px rgba(251,191,36,0.4)' : '0 0 20px rgba(0,212,255,0.4)',
          textShadow: mode === 'deepface' ? '0 0 10px rgba(251,191,36,0.8)' : '0 0 10px rgba(0,212,255,0.8)'
        }}>{mode === 'deepface' ? '🧠' : '🖼️'}</div>
        <div>
          <div className="card-title">{modeLabel}</div>
          <div className="card-subtitle">{modeSubtitle}</div>
        </div>
        {mode === 'deepface' && (
          <div className="deepface-badge" style={{ marginLeft:'auto' }}>
            FERPlus ONNX
          </div>
        )}
      </div>
      <div className="card-body">
        <div className={`drop-zone ${dragging?'dragging':''} ${mode==='deepface'?'deepface-drop':''}`} id="drop-zone"
          onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
          onDrop={onDrop} onClick={()=>inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}} id="file-input"
            onChange={e=>analyzeFile(e.target.files[0])} />
          <div className="drop-zone-content">
            <span className="drop-icon">{mode === 'deepface' ? '🧠' : '📤'}</span>
            <div className="drop-title">
              {mode === 'deepface' ? 'Drop image for emotion detection' : 'Drop an image here'}
            </div>
            <div className="drop-subtitle">or click to browse your files</div>
            <div className="drop-formats">
              {['JPG','PNG','WEBP','BMP'].map(f=><span key={f} className="format-badge">{f}</span>)}
            </div>
          </div>
        </div>
        {error && <div className="error-banner"><span>⚠️</span><span>{error}</span></div>}
        <div style={{ marginTop: 12, display:'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={analyzeMatting} disabled={processing} title="Uses MODNet to perfectly isolate the subject">
            🎭 Remove Background (Matting)
          </button>
        </div>
        <div className="preview-area" style={{ marginTop:18 }}>
          {processing && (
            <div className="processing-overlay">
              <div className="spinner"/>
              <span className="processing-text">
                {mode === 'deepface' ? '🧠 Running FERPlus emotion analysis…' : 'Analyzing faces…'}
              </span>
              <div className="scan-line" style={{
                background:`linear-gradient(90deg, transparent, ${mode==='deepface'?'var(--amber)':'var(--cyan)'}, transparent)`,
                boxShadow:`0 0 16px ${mode==='deepface'?'var(--amber)':'var(--cyan)'}`
              }}/>
            </div>
          )}
          {preview
            ? <img ref={imgRef} src={preview} alt="preview" className="preview-img" id="preview-img"/>
            : <div className="preview-placeholder">
                {mode === 'deepface' ? '🧠 Emotion-annotated image will appear here' : '📷 Annotated image will appear here'}
              </div>}
          <canvas ref={canvasRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none'}}/>
        </div>
      </div>
    </div>
  );
}

// ── Webcam Panel ──────────────────────────────────────────────────────────────
function WebcamPanel({ onResult, mode, privacyMode }) {
  const [active,     setActive]     = useState(false);
  const [liveMode,   setLiveMode]   = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState(null);
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const liveTimer = useRef(null);

  const startCam = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video:{width:1280,height:720} });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject=s; videoRef.current.play(); }
      setActive(true);
    } catch { setError('Camera access denied.'); }
  };

  const stopCam = () => {
    stopLive();
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null; setActive(false);
  };

  const capture = useCallback(async () => {
    const vid=videoRef.current, cvs=canvasRef.current;
    if (!vid||!cvs||!active) return;
    const w=vid.videoWidth||640, h=vid.videoHeight||480;
    cvs.width=vid.offsetWidth; cvs.height=vid.offsetHeight;
    const tmp=document.createElement('canvas');
    tmp.width=w; tmp.height=h;
    tmp.getContext('2d').drawImage(vid,0,0,w,h);
    const b64=tmp.toDataURL('image/jpeg',0.85);
    const endpoint = mode === 'deepface' ? '/analyze/deepface/base64' : '/analyze/base64';
    setProcessing(true);
    try {
      const res=await fetch(`${API_BASE}${endpoint}`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({image:b64,source:'webcam', privacy_mode: privacyMode}),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data=await res.json();
      onResult(data,'webcam',mode);
      drawFacesOnCanvas(cvs, data.faces, w, h, mode);
    } catch(e) { setError(`${e.message}`); }
    finally    { setProcessing(false); }
  }, [active, onResult, mode, privacyMode]);

  const startLive = () => { setLiveMode(true); liveTimer.current=setInterval(capture,900); };
  const stopLive  = () => { setLiveMode(false); clearInterval(liveTimer.current); liveTimer.current=null; };

  // Restart live mode when mode changes
  useEffect(() => {
    if (liveMode) { stopLive(); startLive(); }
  }, [mode]);

  useEffect(()=>()=>{stopCam();},[]);

  const scanColor = mode === 'deepface' ? 'var(--amber)' : 'var(--cyan)';

  return (
    <div className="card webcam-card" style={{
      borderColor: mode === 'deepface' ? 'rgba(251,191,36,0.4)' : 'rgba(0,212,255,0.2)',
      boxShadow: mode === 'deepface' ? '0 0 30px rgba(251,191,36,0.05)' : undefined
    }}>
      <div className="card-header">
        <div className="card-icon" style={{
          background: mode === 'deepface' ? 'rgba(251,191,36,0.15)' : 'rgba(0,212,255,0.15)',
          boxShadow: mode === 'deepface' ? '0 0 20px rgba(251,191,36,0.4)' : '0 0 20px rgba(0,212,255,0.4)',
          textShadow: mode === 'deepface' ? '0 0 10px rgba(251,191,36,0.8)' : '0 0 10px rgba(0,212,255,0.8)'
        }}>📷</div>
        <div>
          <div className="card-title">Live Webcam</div>
          <div className="card-subtitle">
            {mode === 'deepface' ? '🧠 DeepFace · Haar + FERPlus Emotion' : 'Real-time face detection & emotion'}
          </div>
        </div>
        {processing && <div className="spinner" style={{width:22,height:22,marginLeft:'auto'}}/>}
      </div>
      <div className="card-body">
        <div className="webcam-wrapper" style={{ 
          borderColor: mode === 'deepface' ? 'rgba(251,191,36,0.4)' : 'rgba(0,212,255,0.4)',
          boxShadow: active ? `0 0 40px ${mode === 'deepface' ? 'rgba(251,191,36,0.2)' : 'rgba(0,212,255,0.2)'}, inset 0 0 60px rgba(0,0,0,0.6)` : 'inset 0 0 60px rgba(0,0,0,0.4)'
        }}>
          <video ref={videoRef} className="webcam-video" muted playsInline id="webcam-video"/>
          <canvas ref={canvasRef} className="webcam-overlay-canvas" id="webcam-canvas"/>
          {active && liveMode && (
            <div className="scan-line" style={{
              background:`linear-gradient(90deg, transparent, ${scanColor}, transparent)`,
              boxShadow:`0 0 16px ${scanColor}, 0 0 40px ${scanColor}`,
            }}/>
          )}
          {!active && <div className="webcam-off-state"><span className="webcam-off-icon">📷</span><span>Camera is off</span></div>}
        </div>
        {error && <div className="error-banner" style={{marginTop:14}}><span>⚠️</span><span>{error}</span></div>}
        <div className="webcam-controls">
          {!active
            ? <button className="btn btn-primary btn-full" id="start-camera-btn" onClick={startCam}>🎥 Start Camera</button>
            : (
              <>
                <button className="btn btn-outline" id="capture-btn" onClick={capture} disabled={processing} style={{flex:1}}>📸 Capture</button>
                {!liveMode
                  ? <button className="btn btn-primary" id="live-btn" onClick={startLive} disabled={processing} style={{flex:1}}>⚡ Live Mode</button>
                  : <button className="btn btn-ghost" id="stop-live-btn" onClick={stopLive} style={{flex:1}}>⏹ Stop Live</button>
                }
                <button className="btn btn-danger btn-sm" id="stop-camera-btn" onClick={stopCam}>✕</button>
              </>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ── Results Panel ─────────────────────────────────────────────────────────────
function ResultsPanel({ result }) {
  if (!result) return (
    <div className="card results-card">
      <div className="card-header">
        <div className="card-icon">📊</div>
        <div><div className="card-title">Analysis Results</div><div className="card-subtitle">Face classification output</div></div>
      </div>
      <div className="card-body">
        <EmptyState icon="🔍" title="No analysis yet" text="Upload an image or start the webcam to begin." />
      </div>
    </div>
  );

  const { faces, face_count, processing_time_ms, model_status, source, resultMode, engine } = result;
  const isDeepFace = resultMode === 'deepface';

  const topEmo = (() => {
    const map={};
    faces.forEach(f => { if(f.emotion) map[f.emotion]=(map[f.emotion]||0)+1; });
    const top = Object.entries(map).sort((a,b)=>b[1]-a[1])[0];
    return top ? top[0] : null;
  })();

  const unifaceFaces    = faces.filter(f => 'confidence' in f && !('all_emotions' in f));
  const withAge         = faces.filter(f=>f.age!=null);
  const avgAge          = withAge.length ? withAge.reduce((s,f)=>s+f.age,0)/withAge.length : null;
  const females         = faces.filter(f=>(f.gender||'').toLowerCase()==='female').length;

  return (
    <div className="card results-card" style={{
      borderColor: isDeepFace ? 'rgba(251,191,36,0.4)' : 'rgba(0,212,255,0.2)',
      boxShadow: isDeepFace ? '0 0 30px rgba(251,191,36,0.05)' : undefined
    }}>
      <div className="card-header">
        <div className="card-icon" style={{ 
          background: isDeepFace ? 'rgba(251,191,36,0.15)' : 'rgba(0,212,255,0.15)',
          boxShadow: isDeepFace ? '0 0 20px rgba(251,191,36,0.4)' : '0 0 20px rgba(0,212,255,0.4)',
          textShadow: isDeepFace ? '0 0 10px rgba(251,191,36,0.8)' : '0 0 10px rgba(0,212,255,0.8)'
        }}>
          {isDeepFace ? '🧠' : '📊'}
        </div>
        <div>
          <div className="card-title">
            {isDeepFace
              ? 'DeepFace Emotion Recognition — Haar + FERPlus ONNX'
              : 'Analysis Results — Face Classification'}
          </div>
          <div className="card-subtitle">
            {source==='webcam'?'Webcam frame':'Uploaded image'}
            {isDeepFace ? ` · ${engine || 'DeepFace-ONNX'}` : ` · ${model_status || 'UniFace'}`}
          </div>
        </div>
        {isDeepFace && (
          <div className="deepface-badge" style={{ marginLeft:'auto' }}>
            FERPlus · 8 Emotions
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="stats-row">
          <StatBadge value={face_count} label="Faces Detected" />
          <StatBadge value={`${processing_time_ms?.toFixed(0)||0}ms`} label="Proc. Time" />
          {isDeepFace ? (
            <>
              <StatBadge value={topEmo ? `${EMOTION_EMOJI[(topEmo||'').toLowerCase()]||''}` : '—'} label="Top Emotion" />
              <StatBadge value={topEmo || '—'} label="Emotion Label" />
            </>
          ) : (
            <>
              <StatBadge value={avgAge!=null ? `${Math.round(avgAge)}y` : '—'} label="Avg Age" />
              <StatBadge value={topEmo ? `${EMOTION_EMOJI[(topEmo||'').toLowerCase()]||''}${topEmo}` : '—'} label="Top Emotion" />
            </>
          )}
        </div>

        {face_count === 0
          ? <EmptyState icon="😶" title="No faces detected" text={
              isDeepFace
                ? 'Haar cascade did not detect any faces. Try a clearer, well-lit image.'
                : 'Try a clearer image with visible faces.'
            } />
          : (
            <div className="results-grid">
              {faces.map((face, i) =>
                isDeepFace
                  ? <DeepFaceCard key={i} face={face} index={i} />
                  : <ClassificationCard key={i} face={face} index={i} />
              )}
            </div>
          )
        }

        {isDeepFace && (
          <div className="deepface-attribution">
            <span>🔬</span>
            <span>
              Approach based on{' '}
              <a href="https://github.com/manish-9245/Facial-Emotion-Recognition-using-OpenCV-and-Deepface"
                 target="_blank" rel="noreferrer" className="footer-link">
                Facial-Emotion-Recognition-using-OpenCV-and-Deepface
              </a>
              {' '}· Powered by OpenCV Haar Cascade + FERPlus ONNX (no TF required)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [backendStatus, setBackendStatus] = useState('loading');
  const [dfReady,       setDfReady]       = useState(false);
  const [result,        setResult]        = useState(null);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [mode,          setMode]          = useState('uniface'); // 'uniface' | 'deepface'
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [privacyMode,   setPrivacyMode]   = useState(false);
  const navigate = useNavigate();

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('fn_user') || 'null'); } catch { return null; }
  })();

  useEffect(() => { if (!user) navigate('/'); }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const res  = await fetch(`${API_BASE}/health`, {signal: AbortSignal.timeout(3000)});
        const data = await res.json();
        setBackendStatus(data.models_ready ? 'ready' : 'loading');
        setDfReady(!!data.deepface_ready);
      } catch { setBackendStatus('error'); }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  const handleResult = useCallback((data, src, resultMode) => {
    setResult({...data, source:src, resultMode});
  }, []);

  const handleLogout = () => { localStorage.removeItem('fn_user'); navigate('/'); };

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <img src="/logo.png" alt="FaceNetra" className="header-logo-img" />
          <div>
            <div className="logo-text">FaceNetra</div>
            <div className="logo-sub">Advanced Face Analysis</div>
          </div>
        </div>

        <div style={{ flex:1, display:'flex', justifyContent:'center' }}>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button 
            className={`btn btn-sm ${privacyMode ? 'btn-danger' : 'btn-ghost'}`} 
            onClick={() => setPrivacyMode(!privacyMode)}
            style={{ display:'flex', alignItems:'center', gap:6 }}
            title="Toggle Privacy: Automatically blurs all detected faces"
          >
            {privacyMode ? '🕵️ Privacy ON' : '🕵️ Privacy OFF'}
          </button>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
          <StatusBadge status={backendStatus} dfReady={dfReady} />
          {user && (
            <div style={{ position: 'relative' }}>
              <div className="user-chip" style={{ cursor: 'pointer' }} onClick={() => setUserMenuOpen(!userMenuOpen)}>
                <span>{user.avatar || '👤'}</span>
                <div>
                  <div style={{ fontWeight:700, fontSize:'0.78rem', color:'#fff' }}>{user.username}</div>
                  <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.4)' }}>{user.role}</div>
                </div>
                <span style={{ fontSize: '0.6rem', opacity: 0.5, marginLeft: 4 }}>▼</span>
              </div>
              
              {userMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setUserMenuOpen(false)} />
                  <div className="user-dropdown">
                    <button className="dropdown-item" onClick={() => { setHistoryOpen(true); setUserMenuOpen(false); }}>
                      <span>📜</span> Analysis History
                    </button>
                    <div className="dropdown-divider" />
                    <button className="dropdown-item danger" onClick={handleLogout}>
                      <span>⏻</span> Secure Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        <UploadPanel  onResult={handleResult} mode={mode} privacyMode={privacyMode} />
        <WebcamPanel  onResult={handleResult} mode={mode} privacyMode={privacyMode} />
        <ResultsPanel result={result} />
      </main>

      <footer className="app-footer">
        Powered by{' '}
        <a href="https://github.com/yakhyo/uniface" className="footer-link" target="_blank" rel="noreferrer">UniFace 3.5</a>
        {' '}·{' '}
        <a href="https://github.com/manish-9245/Facial-Emotion-Recognition-using-OpenCV-and-Deepface" className="footer-link" target="_blank" rel="noreferrer">DeepFace-ONNX</a>
        {' '}·{' '}
        <a href="http://localhost:8000/docs" className="footer-link" target="_blank" rel="noreferrer">API Docs</a>
        {' '}· FaceNetra v3.0
      </footer>

      <HistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
