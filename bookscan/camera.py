"""Camera enumeration and a background frame grabber.

The grabber runs on its own thread and keeps only the newest frame. The UI
polls for that frame, so a slow render never backs up the capture pipeline.
"""

from __future__ import annotations

import platform
import threading
from dataclasses import dataclass

import cv2

IS_WINDOWS = platform.system() == "Windows"
_BACKEND = cv2.CAP_DSHOW if IS_WINDOWS else cv2.CAP_ANY

# DirectShow is the fastest to open and gives the friendliest device names,
# but some webcams (and most virtual cameras) only work through Media
# Foundation, so fall through rather than giving up on the first refusal.
_BACKENDS = (
    (cv2.CAP_DSHOW, "DirectShow"),
    (cv2.CAP_MSMF, "Media Foundation"),
    (cv2.CAP_ANY, "default"),
) if IS_WINDOWS else ((cv2.CAP_ANY, "default"),)


@dataclass(frozen=True)
class CameraInfo:
    index: int
    name: str

    def __str__(self) -> str:
        return f"{self.index}: {self.name}"


def list_cameras(max_probe: int = 8) -> list[CameraInfo]:
    """Return the cameras attached to this machine.

    On Windows pygrabber gives real DirectShow device names. Everywhere else
    (and if pygrabber is missing) we fall back to opening indices in turn.
    """
    if IS_WINDOWS:
        try:
            from pygrabber.dshow_graph import FilterGraph

            names = FilterGraph().get_input_devices()
            if names:
                return [CameraInfo(i, n) for i, n in enumerate(names)]
        except Exception:
            pass

    found: list[CameraInfo] = []
    for index in range(max_probe):
        capture = cv2.VideoCapture(index, _BACKEND)
        if capture.isOpened():
            ok, _ = capture.read()
            if ok:
                found.append(CameraInfo(index, f"Camera {index}"))
        capture.release()
    return found


class CameraStream:
    """Continuously reads one camera into a single-slot buffer."""

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self._width = width
        self._height = height
        self._capture: cv2.VideoCapture | None = None
        self._frame = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.error: str | None = None
        self.backend: str = ""
        # What the camera actually gave us, which is often not what we asked
        # for. Worth surfacing, because ISBN OCR depends on it.
        self.actual_size: tuple[int, int] = (0, 0)

    @property
    def is_open(self) -> bool:
        return self._capture is not None and self._capture.isOpened()

    def open(self, index: int) -> bool:
        self.close()
        self.error = None

        capture = None
        frame = None
        for backend, label in _BACKENDS:
            attempt = cv2.VideoCapture(index, backend)
            if not attempt.isOpened():
                attempt.release()
                continue

            attempt.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
            attempt.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
            # A one-frame buffer keeps the preview honest about "now".
            attempt.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            ok, frame = attempt.read()
            if ok and frame is not None:
                capture = attempt
                self.backend = label
                break

            attempt.release()

        if capture is None:
            self.error = (
                f"Camera {index} could not be opened. It may be unplugged, "
                "in use by another program, blocked by Windows camera "
                "privacy settings, or a virtual device that has no feed."
            )
            return False

        self._capture = capture
        self._frame = frame
        self.actual_size = (frame.shape[1], frame.shape[0])
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            capture = self._capture
            if capture is None:
                break
            ok, frame = capture.read()
            if not ok or frame is None:
                # A dropped frame is normal on USB webcams. Keep going and
                # let the previous frame stand.
                continue
            with self._lock:
                self._frame = frame

    def read(self):
        """Return a copy of the newest frame, or None if nothing yet."""
        with self._lock:
            frame = self._frame
        return None if frame is None else frame.copy()

    def close(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=2.0)
        if self._capture is not None:
            self._capture.release()
            self._capture = None
        with self._lock:
            self._frame = None
