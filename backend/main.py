"""
FaceNetra Backend - FastAPI server for face analysis using UniFace
Supports: Face Detection, Age, Gender, Emotion Recognition, Face Classification
"""
import base64
import time
import logging
import uuid
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager
from collections import deque

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facenetra")

# ── Globals ─────────────────────────────────────────────────────────────────
face_analyzer  = None
df_engine      = None   # DeepFace-style ONNX engine
modnet_engine  = None
MODELS_READY   = False
DF_ENGINE_READY = False

# In-memory history (last 50 analyses)
analysis_history: deque = deque(maxlen=50)

# Emotion labels → emoji mapping
EMOTION_EMOJI = {
    "angry":    "😠", "disgust": "🤢", "fear":    "😨",
    "happy":    "😄", "sad":     "😢", "surprise": "😲",
    "neutral":  "😐", "contempt": "😒",
}

GENDER_COLORS = {
    "female": (255, 105, 180),   # pink
    "male":   (72,  149, 239),   # blue
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models at startup."""
    global face_analyzer, MODELS_READY
    logger.info("Loading UniFace models (SCRFD + AgeGender + Emotion)…")
    try:
        from uniface import AgeGender, FaceAnalyzer, MODNet

        attributes = [AgeGender()]

        # Emotion model requires torch — load if available
        try:
            from uniface import Emotion
            attributes.append(Emotion())
            logger.info("✅ Emotion model loaded (torch available)")
        except (ImportError, Exception) as emo_err:
            logger.warning(f"⚠️  Emotion model skipped: {emo_err}")

        face_analyzer = FaceAnalyzer(attributes=attributes)
        
        global modnet_engine
        modnet_engine = MODNet()
        
        MODELS_READY  = True
        logger.info(f"✅ UniFace models ready! Attributes: {[type(a).__name__ for a in attributes]}")
    except Exception as e:
        logger.error(f"❌ UniFace model load failed: {e}")
        MODELS_READY = False

    # ── Load DeepFace-style ONNX engine ──────────────────────────────────────
    global df_engine, DF_ENGINE_READY
    try:
        from deepface_engine import get_engine
        df_engine = get_engine()
        DF_ENGINE_READY = True
        logger.info("✅ DeepFace ONNX engine ready! (Haar + FERPlus)")
    except Exception as e:
        logger.warning(f"⚠️  DeepFace engine not available: {e}")
        DF_ENGINE_READY = False

    yield
    logger.info("Shutting down FaceNetra…")



# ── App Setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="FaceNetra API",
    description="Advanced Face Analysis — Detection · Age · Gender · Emotion",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ──────────────────────────────────────────────────────────
class FaceResult(BaseModel):
    bbox:               list[float]
    confidence:         float
    landmarks:          Optional[list[list[float]]] = None
    age:                Optional[float]             = None
    gender:             Optional[str]               = None
    gender_confidence:  Optional[float]             = None
    emotion:            Optional[str]               = None
    emotion_confidence: Optional[float]             = None
    classification:     Optional[str]               = None   # e.g. "Young Adult Male, Happy"


class AnalysisResponse(BaseModel):
    id:                  str
    faces:               list[FaceResult]
    face_count:          int
    annotated_image:     str           # base64 PNG
    processing_time_ms:  float
    model_status:        str
    timestamp:           str
    source:              str = "image"  # "image" | "webcam"


class HistoryItem(BaseModel):
    id:                 str
    timestamp:          str
    face_count:         int
    processing_time_ms: float
    source:             str
    thumbnail:          str            # small base64 JPEG
    faces_summary:      list[dict]


# ── Image Utilities ──────────────────────────────────────────────────────────
def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes.")
    return img


def encode_b64(img: np.ndarray, ext: str = ".png", quality: int = 90) -> str:
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext == ".jpg" else []
    _, buf = cv2.imencode(ext, img, params)
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def make_thumbnail(img: np.ndarray, size: int = 120) -> str:
    h, w = img.shape[:2]
    scale = size / max(h, w)
    thumb = cv2.resize(img, (int(w * scale), int(h * scale)))
    return encode_b64(thumb, ".jpg", 70)


def age_group(age: Optional[float]) -> str:
    if age is None:
        return "Unknown"
    a = int(age)
    if a < 13:   return "Child"
    if a < 18:   return "Teen"
    if a < 30:   return "Young Adult"
    if a < 50:   return "Adult"
    if a < 65:   return "Middle Aged"
    return "Senior"


def classify_face(gender: Optional[str], age: Optional[float], emotion: Optional[str]) -> str:
    parts = []
    if age is not None:
        parts.append(age_group(age))
    if gender:
        parts.append(gender.capitalize())
    if emotion:
        parts.append(emotion.capitalize())
    return ", ".join(parts) if parts else "Unknown"


# ── Drawing ──────────────────────────────────────────────────────────────────
def draw_face(img: np.ndarray, fd: dict) -> np.ndarray:
    x1, y1, x2, y2 = [int(v) for v in fd["bbox"]]
    gender  = (fd.get("gender") or "").lower()
    age     = fd.get("age")
    conf    = fd.get("confidence", 0)
    emotion = fd.get("emotion") or ""

    color = GENDER_COLORS.get(gender, (0, 212, 255))

    # Outer glow box + inner thin line
    cv2.rectangle(img, (x1-1, y1-1), (x2+1, y2+1), color, 3)
    cv2.rectangle(img, (x1,   y1  ), (x2,   y2  ), (255, 255, 255), 1)

    # Corner accent marks
    cs = 16
    for (cx, cy, sx, sy) in [(x1,y1,1,1),(x2,y1,-1,1),(x1,y2,1,-1),(x2,y2,-1,-1)]:
        cv2.line(img, (cx, cy + sy*cs), (cx, cy), color, 2)
        cv2.line(img, (cx + sx*cs, cy), (cx, cy), color, 2)

    # 5-pt landmarks
    for pt in (fd.get("landmarks") or []):
        cx, cy = int(pt[0]), int(pt[1])
        cv2.circle(img, (cx, cy), 3, (255, 100, 0), -1)
        cv2.circle(img, (cx, cy), 4, (255, 255, 255), 1)

    # Label bar
    emo_emoji = EMOTION_EMOJI.get(emotion.lower(), "")
    age_str   = f"{age:.0f}y" if age is not None else "??"
    line1     = f"{'M' if gender=='male' else 'F' if gender=='female' else '?'} · {age_str} · {conf:.0%}"
    line2     = f"{emo_emoji} {emotion.capitalize()}" if emotion else ""

    font  = cv2.FONT_HERSHEY_SIMPLEX
    sc, tk = 0.5, 1
    (w1, th), _ = cv2.getTextSize(line1, font, sc, tk)
    bar_h = (th + 6) * (2 if line2 else 1) + 6
    bar_y = y1 - bar_h - 4
    if bar_y < 0:
        bar_y = y2 + 4

    cv2.rectangle(img, (x1, bar_y), (x1 + max(w1, 120) + 10, bar_y + bar_h), color, -1)
    cv2.putText(img, line1, (x1+5, bar_y + th + 4),        font, sc, (255,255,255), tk, cv2.LINE_AA)
    if line2:
        cv2.putText(img, line2, (x1+5, bar_y + th*2 + 10), font, sc, (255,255,255), tk, cv2.LINE_AA)

    return img


# ── Core Processing ──────────────────────────────────────────────────────────
def apply_privacy_blur(img: np.ndarray, bbox: list[float]) -> None:
    """In-place heavy anonymization blur on a bounding box."""
    x1, y1, x2, y2 = [int(v) for v in bbox]
    h, w = img.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    roi = img[y1:y2, x1:x2]
    if roi.size > 0:
        img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (99, 99), 30)

def process_image(img: np.ndarray, source: str = "image", privacy_mode: bool = False) -> AnalysisResponse:
    t0      = time.perf_counter()
    out_img = img.copy()
    results: list[FaceResult] = []
    rid     = str(uuid.uuid4())[:8]
    ts      = datetime.now().isoformat()

    if not MODELS_READY:
        return AnalysisResponse(
            id=rid, faces=[], face_count=0,
            annotated_image=encode_b64(out_img),
            processing_time_ms=0,
            model_status="Models not loaded", timestamp=ts, source=source,
        )

    try:
        faces = face_analyzer.analyze(img)
        for face in faces:
            bbox = [float(v) for v in face.bbox]
            conf = float(getattr(face, "confidence", 0) or 0)
            lm   = face.landmarks.tolist() if getattr(face, "landmarks", None) is not None else None
            age  = float(face.age) if getattr(face, "age", None) is not None else None
            gend = str(face.sex).lower() if getattr(face, "sex", None) else None
            emo  = str(face.emotion) if getattr(face, "emotion", None) else None
            emo_conf = float(face.emotion_confidence) if getattr(face, "emotion_confidence", None) is not None else None

            fd = {"bbox": bbox, "confidence": conf, "landmarks": lm,
                  "age": age, "gender": gend, "emotion": emo}
                  
            if privacy_mode:
                apply_privacy_blur(out_img, bbox)
                
            draw_face(out_img, fd)

            results.append(FaceResult(
                bbox=bbox, confidence=conf, landmarks=lm,
                age=age, gender=gend.capitalize() if gend else None,
                emotion=emo.capitalize() if emo else None,
                emotion_confidence=emo_conf,
                classification=classify_face(gend, age, emo),
            ))
    except Exception as e:
        logger.error(f"Analysis error: {e}")

    elapsed = (time.perf_counter() - t0) * 1000

    # Store in history (thumbnail of original)
    summary: list[dict] = []
    for r in results:
        summary.append({
            "gender":    r.gender,
            "age":       round(r.age) if r.age else None,
            "emotion":   r.emotion,
            "class":     r.classification,
            "bbox":      [round(v) for v in r.bbox],
        })

    analysis_history.appendleft({
        "id":                 rid,
        "timestamp":          ts,
        "face_count":         len(results),
        "processing_time_ms": round(elapsed, 1),
        "source":             source,
        "thumbnail":          make_thumbnail(img),
        "faces_summary":      summary,
    })

    return AnalysisResponse(
        id=rid, faces=results, face_count=len(results),
        annotated_image=encode_b64(out_img),
        processing_time_ms=round(elapsed, 2),
        model_status="Ready",
        timestamp=ts, source=source,
    )


# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health", methods=["GET", "HEAD"])
async def health():
    return {
        "status":           "ok",
        "models_ready":     MODELS_READY,
        "deepface_ready":   DF_ENGINE_READY,
        "version":          "2.0.0",
        "service":          "FaceNetra",
        "capabilities":     ["detection", "age", "gender", "emotion", "classification", "deepface"],
    }


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_image(file: UploadFile = File(...), privacy_mode: bool = False):
    """Upload an image file for full face analysis."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image.")
    data = await file.read()
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return process_image(img, source="image", privacy_mode=privacy_mode)


@app.post("/analyze/base64", response_model=AnalysisResponse)
async def analyze_base64(payload: dict):
    """Analyze a base64-encoded image (for webcam frames)."""
    raw = payload.get("image", "")
    src = payload.get("source", "webcam")
    privacy = payload.get("privacy_mode", False)
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        img = decode_image(base64.b64decode(raw))
    except Exception as e:
        raise HTTPException(422, f"Invalid image data: {e}")
    return process_image(img, source=src, privacy_mode=privacy)

class ModnetResponse(BaseModel):
    annotated_image: str

@app.post("/matting", response_model=ModnetResponse)
async def perform_matting(file: UploadFile = File(...)):
    """Remove background from image using MODNet."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image.")
    data = await file.read()
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
        
    if not modnet_engine:
        raise HTTPException(503, "MODNet engine uninitialized.")
        
    try:
        matte = modnet_engine.predict(img)
        matte_uint8 = (matte * 255).astype(np.uint8)
        b, g, r = cv2.split(img)
        rgba = cv2.merge([b, g, r, matte_uint8])
        return ModnetResponse(annotated_image=encode_b64(rgba, ext=".png"))
    except Exception as e:
        logger.error(f"Matting error: {e}")
        raise HTTPException(500, str(e))


@app.get("/history", response_model=list[HistoryItem])
async def get_history():
    """Return the last 50 analysis results."""
    return list(analysis_history)


@app.delete("/history")
async def clear_history():
    """Clear all analysis history."""
    analysis_history.clear()
    return {"message": "History cleared."}


# ══════════════════════════════════════════════════════════════════════════════
# DeepFace-Style Routes  (Haar Cascade + FERPlus ONNX)
# Implements the same approach as: github.com/manish-9245/Facial-Emotion-Recognition-using-OpenCV-and-Deepface
# but using pure ONNX Runtime (no TensorFlow/PyTorch required)
# ══════════════════════════════════════════════════════════════════════════════

class DeepFaceResult(BaseModel):
    bbox:               list[float]
    emotion:            str
    emotion_confidence: float
    all_emotions:       dict[str, float]


class DeepFaceResponse(BaseModel):
    id:                  str
    faces:               list[DeepFaceResult]
    face_count:          int
    annotated_image:     str
    processing_time_ms:  float
    engine:              str = "DeepFace-ONNX (Haar + FERPlus)"
    timestamp:           str
    source:              str = "image"


def _deepface_process(img: np.ndarray, source: str = "image", privacy_mode: bool = False) -> DeepFaceResponse:
    """Run DeepFace-style emotion analysis and return annotated results."""
    t0  = time.perf_counter()
    rid = str(uuid.uuid4())[:8]
    ts  = datetime.now().isoformat()

    if not DF_ENGINE_READY:
        return DeepFaceResponse(
            id=rid, faces=[], face_count=0,
            annotated_image=encode_b64(img),
            processing_time_ms=0,
            engine="DeepFace-ONNX (unavailable)",
            timestamp=ts, source=source,
        )

    try:
        results = df_engine.analyze(img)
        if privacy_mode:
            for r in results:
                apply_privacy_blur(img, r['bbox'])
        annotated = df_engine.draw_results(img, results)
    except Exception as e:
        logger.error(f"DeepFace analysis error: {e}")
        results, annotated = [], img

    elapsed = (time.perf_counter() - t0) * 1000
    face_objs = [DeepFaceResult(**r) for r in results]

    # Save to history
    analysis_history.appendleft({
        "id":                 rid,
        "timestamp":          ts,
        "face_count":         len(results),
        "processing_time_ms": round(elapsed, 1),
        "source":             source,
        "thumbnail":          make_thumbnail(img),
        "faces_summary": [
            {"emotion": r["emotion"], "gender": None, "age": None,
             "class": r["emotion"], "bbox": [round(v) for v in r["bbox"]]}
            for r in results
        ],
    })

    return DeepFaceResponse(
        id=rid, faces=face_objs, face_count=len(results),
        annotated_image=encode_b64(annotated),
        processing_time_ms=round(elapsed, 2),
        timestamp=ts, source=source,
    )


@app.post("/analyze/deepface", response_model=DeepFaceResponse)
async def deepface_analyze_image(file: UploadFile = File(...), privacy_mode: bool = False):
    """
    DeepFace-style emotion analysis from uploaded image.
    Uses: OpenCV Haar Cascade + FERPlus ONNX (8 emotions).
    Approach mirrors: github.com/manish-9245/Facial-Emotion-Recognition-using-OpenCV-and-Deepface
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image.")
    data = await file.read()
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return _deepface_process(img, source="image", privacy_mode=privacy_mode)


@app.post("/analyze/deepface/base64", response_model=DeepFaceResponse)
async def deepface_analyze_base64(payload: dict):
    """
    DeepFace-style emotion analysis from base64 image (for webcam frames).
    """
    raw = payload.get("image", "")
    src = payload.get("source", "webcam")
    privacy = payload.get("privacy_mode", False)
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        img = decode_image(base64.b64decode(raw))
    except Exception as e:
        raise HTTPException(422, f"Invalid image data: {e}")
    return _deepface_process(img, source=src, privacy_mode=privacy)


@app.get("/deepface/status")
async def deepface_status():
    """DeepFace engine status."""
    return {
        "engine_ready":    DF_ENGINE_READY,
        "model":           "FERPlus ONNX (8-class)",
        "detector":        "OpenCV Haar Cascade",
        "approach":        "github.com/manish-9245/Facial-Emotion-Recognition-using-OpenCV-and-Deepface",
        "emotions":        ["Neutral","Happiness","Surprise","Sadness","Anger","Disgust","Fear","Contempt"],
    }
