"""
FaceNetra DeepFace-style Engine
--------------------------------
Implements real-time emotion detection using:
  - OpenCV Haar Cascade (face detection, same approach as deepface/OpenCV)
  - FERPlus ONNX model  (emotion classification, 8 classes)
  - No TensorFlow / PyTorch dependency - pure ONNX Runtime

Emotion labels (FERPlus 8-class):
  Neutral, Happiness, Surprise, Sadness, Anger, Disgust, Fear, Contempt
"""
import os
import cv2
import numpy as np
import onnxruntime as ort
import logging

logger = logging.getLogger("facenetra.deepface_engine")

# ── Emotion labels (FERPlus 8-class) ─────────────────────────────────────────
FERPLUS_LABELS = [
    "Neutral", "Happiness", "Surprise", "Sadness",
    "Anger", "Disgust", "Fear", "Contempt"
]

EMOTION_COLOR = {
    "Happiness": (74, 222, 128),   # green
    "Surprise":  (251, 191, 36),   # amber
    "Sadness":   (96, 165, 250),   # blue
    "Anger":     (248, 113, 113),  # red
    "Fear":      (167, 139, 250),  # violet
    "Disgust":   (52, 211, 153),   # teal
    "Contempt":  (251, 146, 60),   # orange
    "Neutral":   (148, 163, 184),  # slate
}


class DeepFaceEngine:
    """
    OpenCV + ONNX implementation of real-time face emotion detection,
    following the same approach as the deepface library but without
    TensorFlow or PyTorch requirements.
    """

    def __init__(self):
        # Haar cascade for face detection
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.face_cascade = cv2.CascadeClassifier(cascade_path)
        if self.face_cascade.empty():
            raise RuntimeError(f"Failed to load Haar cascade from {cascade_path}")
        logger.info("✅ Haar cascade loaded")

        # FERPlus ONNX emotion model
        model_path = os.path.join(os.path.dirname(__file__), "emotion_ferplus.onnx")
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"FERPlus model not found at {model_path}. "
                "Download from: https://github.com/onnx/models/raw/main/validated/"
                "vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx"
            )
        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"]
        )
        self.input_name  = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        logger.info(f"✅ FERPlus ONNX model loaded → input={self.input_name} [{self.session.get_inputs()[0].shape}]")

    def _preprocess_face(self, gray_roi: np.ndarray) -> np.ndarray:
        """
        Preprocess a grayscale face ROI for FERPlus:
        - Resize to 64×64
        - Normalize to float32
        - Shape: (1, 1, 64, 64)
        """
        resized = cv2.resize(gray_roi, (64, 64)).astype(np.float32)
        # FERPlus uses raw pixel values (0-255 range works, model is pre-normalized)
        tensor = resized.reshape(1, 1, 64, 64)
        return tensor

    def _softmax(self, x: np.ndarray) -> np.ndarray:
        e = np.exp(x - np.max(x))
        return e / e.sum()

    def predict_emotion(self, gray_roi: np.ndarray) -> tuple[str, float, dict]:
        """
        Predict emotion from a grayscale face ROI.
        Returns: (label, confidence, all_probs_dict)
        """
        tensor = self._preprocess_face(gray_roi)
        raw    = self.session.run([self.output_name], {self.input_name: tensor})[0][0]
        probs  = self._softmax(raw)
        idx    = int(np.argmax(probs))
        label  = FERPLUS_LABELS[idx]
        conf   = float(probs[idx])
        all_probs = {FERPLUS_LABELS[i]: float(probs[i]) for i in range(len(probs))}
        return label, conf, all_probs

    def analyze(self, image: np.ndarray, scale_factor: float = 1.1,
                min_neighbors: int = 5, min_size: tuple = (30, 30)) -> list[dict]:
        """
        Full DeepFace-style pipeline:
          1. Convert to grayscale
          2. Detect faces with Haar cascade
          3. For each face: predict emotion with FERPlus ONNX
          4. Return structured results

        Args:
            image: BGR OpenCV image
            scale_factor: Haar cascade scale factor
            min_neighbors: Haar cascade min neighbors
            min_size: Minimum face size

        Returns:
            List of dicts with: bbox, emotion, emotion_confidence, all_emotions
        """
        gray  = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=scale_factor,
            minNeighbors=min_neighbors,
            minSize=min_size,
        )

        results = []
        for (x, y, w, h) in faces:
            face_roi  = gray[y:y+h, x:x+w]
            try:
                emotion, conf, all_emotions = self.predict_emotion(face_roi)
            except Exception as e:
                logger.warning(f"Emotion prediction failed: {e}")
                emotion, conf, all_emotions = "Unknown", 0.0, {}

            results.append({
                "bbox":               [float(x), float(y), float(x+w), float(y+h)],
                "emotion":            emotion,
                "emotion_confidence": conf,
                "all_emotions":       all_emotions,
            })

        return results

    def draw_results(self, image: np.ndarray, results: list[dict]) -> np.ndarray:
        """
        Draw OpenCV-style Haar + emotion overlays on the image.
        Matches the visual style of the deepface reference project.
        """
        out = image.copy()
        font = cv2.FONT_HERSHEY_SIMPLEX

        for face in results:
            x1, y1, x2, y2 = [int(v) for v in face["bbox"]]
            emotion = face["emotion"]
            conf    = face["emotion_confidence"]
            color   = EMOTION_COLOR.get(emotion, (0, 212, 255))

            # Rectangle (glow: thick outer + thin inner)
            cv2.rectangle(out, (x1-1, y1-1), (x2+1, y2+1), color, 3)
            cv2.rectangle(out, (x1,   y1  ), (x2,   y2  ), (255, 255, 255), 1)

            # Corner accent marks
            cs = 18
            for (cx, cy, sdx, sdy) in [(x1,y1,1,1),(x2,y1,-1,1),(x1,y2,1,-1),(x2,y2,-1,-1)]:
                cv2.line(out, (cx, cy+sdy*cs), (cx, cy), color, 2)
                cv2.line(out, (cx+sdx*cs, cy), (cx, cy), color, 2)

            # Label
            label = f"{emotion}  {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(label, font, 0.6, 1)
            bar_y = y1 - th - 10
            if bar_y < 0:
                bar_y = y2 + 4
            cv2.rectangle(out, (x1, bar_y), (x1+tw+12, bar_y+th+8), color, -1)
            cv2.putText(out, label, (x1+6, bar_y+th+4), font, 0.6, (255,255,255), 1, cv2.LINE_AA)

            # Mini emotion bar (top 3 emotions)
            top3 = sorted(face.get("all_emotions", {}).items(), key=lambda e: -e[1])[:3]
            bar_x, bar_y2 = x2 + 8, y1
            for emo, prob in top3:
                if bar_y2 + 20 > y2:
                    break
                bar_color = EMOTION_COLOR.get(emo, (100,100,100))
                bar_w = max(8, int(80 * prob))
                cv2.rectangle(out, (bar_x, bar_y2), (bar_x+bar_w, bar_y2+14), bar_color, -1)
                cv2.putText(out, f"{emo[:3]}", (bar_x+bar_w+3, bar_y2+11),
                            font, 0.35, (255,255,255), 1, cv2.LINE_AA)
                bar_y2 += 18

        return out


# Module-level singleton
_engine: DeepFaceEngine | None = None


def get_engine() -> DeepFaceEngine:
    global _engine
    if _engine is None:
        _engine = DeepFaceEngine()
    return _engine
