"""Finding a held-up book in a frame, and deciding when to fire the shutter.

Two pieces:

  BookDetector    per-frame, "is there a book-shaped thing here right now"
  ShutterController  across frames, "has it held still long enough to keep"
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import cv2
import numpy as np

from .config import Settings


@dataclass
class Detection:
    """A book-shaped region in the downscaled detection image."""

    quad: np.ndarray | None  # 4x2 corner points when we found a clean rectangle
    bbox: tuple[int, int, int, int]  # x, y, w, h
    area_ratio: float
    aspect: float
    sharpness: float
    center: tuple[float, float]  # normalised 0..1


class BookDetector:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    def prepare(self, frame: np.ndarray) -> tuple[np.ndarray, float]:
        """Downscale a full frame for detection. Returns the small frame and
        the scale factor needed to map coordinates back to full size."""
        height, width = frame.shape[:2]
        if width <= self.s.detect_width:
            return frame, 1.0
        scale = self.s.detect_width / float(width)
        small = cv2.resize(
            frame, (self.s.detect_width, int(round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
        return small, scale

    def detect(self, small: np.ndarray) -> Detection | None:
        height, width = small.shape[:2]
        frame_area = float(width * height)

        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 40, 130)
        # Dilating closes the gaps where a cover's edge fades into a similar
        # background, which is the usual reason a book contour breaks up.
        edges = cv2.dilate(edges, self._kernel, iterations=2)
        edges = cv2.erode(edges, self._kernel, iterations=1)

        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            return None

        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

        best_fallback: Detection | None = None
        for contour in contours:
            area_ratio = cv2.contourArea(contour) / frame_area
            if area_ratio < self.s.min_area_ratio:
                break  # sorted by area, so nothing after this qualifies either
            if area_ratio > self.s.max_area_ratio:
                continue

            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            x, y, w, h = cv2.boundingRect(contour)
            if h == 0:
                continue
            aspect = w / float(h)
            if not (self.s.min_aspect <= aspect <= self.s.max_aspect):
                continue

            candidate = Detection(
                quad=approx.reshape(-1, 2).astype(np.float32)
                if len(approx) == 4 else None,
                bbox=(x, y, w, h),
                area_ratio=area_ratio,
                aspect=aspect,
                sharpness=sharpness,
                center=((x + w / 2) / width, (y + h / 2) / height),
            )

            # A clean convex quadrilateral is a book front-on. Take it now.
            if len(approx) == 4 and cv2.isContourConvex(approx):
                return candidate
            if best_fallback is None:
                best_fallback = candidate

        return best_fallback


@dataclass
class ShutterState:
    """What the controller wants the interface to say and do this frame."""

    status: str  # "waiting" | "holding" | "settling" | "blurry" | "changed"
    message: str
    progress: float  # 0..1, how close we are to firing
    fire: bool


class ShutterController:
    """Fires once a detection has been stable and sharp for long enough."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self._history: deque = deque(maxlen=settings.stable_frames)
        self._armed = True
        self._rearm_count = 0
        self._reference_gray: np.ndarray | None = None
        self._last_fire_time = 0.0

    def reset(self, *, armed: bool = True) -> None:
        """Clear all history. Used when starting a fresh book."""
        self._history.clear()
        self._armed = armed
        self._rearm_count = 0
        self._reference_gray = None

    def notify_captured(self, small: np.ndarray, now: float) -> None:
        """Called right after a capture, to disarm until the scene changes."""
        self._history.clear()
        self._armed = False
        self._rearm_count = 0
        self._last_fire_time = now
        self._reference_gray = self._signature(small)

    @staticmethod
    def _signature(small: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        return cv2.resize(gray, (64, 48), interpolation=cv2.INTER_AREA).astype(
            np.float32
        )

    def update(
        self, detection: Detection | None, small: np.ndarray, now: float
    ) -> ShutterState:
        if not self._armed:
            return self._try_rearm(detection, small, now)

        if now - self._last_fire_time < self.s.cooldown_seconds:
            return ShutterState("waiting", "Ready in a moment...", 0.0, False)

        if detection is None:
            self._history.clear()
            return ShutterState(
                "waiting", "Hold the book up to the camera", 0.0, False
            )

        if detection.sharpness < self.s.min_sharpness:
            self._history.clear()
            return ShutterState(
                "blurry", "Too blurry, hold steady", 0.0, False
            )

        self._history.append(
            (detection.center[0], detection.center[1], detection.area_ratio)
        )

        if not self._is_stable():
            progress = len(self._history) / float(self.s.stable_frames) * 0.4
            return ShutterState("settling", "Hold still...", progress, False)

        progress = len(self._history) / float(self.s.stable_frames)
        if len(self._history) < self.s.stable_frames:
            return ShutterState("holding", "Hold still...", progress, False)

        return ShutterState("holding", "Captured", 1.0, True)

    def _is_stable(self) -> bool:
        if len(self._history) < 3:
            return True  # not enough evidence to call it unstable yet
        xs = [h[0] for h in self._history]
        ys = [h[1] for h in self._history]
        areas = [h[2] for h in self._history]

        if max(xs) - min(xs) > self.s.center_tolerance:
            return False
        if max(ys) - min(ys) > self.s.center_tolerance:
            return False

        mean_area = sum(areas) / len(areas)
        if mean_area <= 0:
            return False
        spread = (max(areas) - min(areas)) / mean_area
        return spread <= self.s.area_tolerance

    def _try_rearm(
        self, detection: Detection | None, small: np.ndarray, now: float
    ) -> ShutterState:
        """Wait for the scene to change before allowing the next capture.

        Either the book leaves the frame, or it changes enough that we are
        clearly looking at a different face of it. Flipping a book in place
        satisfies the second test, which is why we do not simply wait for an
        empty frame.
        """
        changed = detection is None
        if not changed and self._reference_gray is not None:
            current = self._signature(small)
            diff = float(np.mean(cv2.absdiff(current, self._reference_gray)))
            changed = diff > self.s.rearm_diff

        if changed:
            self._rearm_count += 1
        else:
            self._rearm_count = 0

        if (
            self._rearm_count >= self.s.rearm_frames
            and now - self._last_fire_time >= self.s.cooldown_seconds
        ):
            self._armed = True
            self._rearm_count = 0
            return ShutterState("waiting", "Ready", 0.0, False)

        return ShutterState("changed", "Turn the book over", 0.0, False)
