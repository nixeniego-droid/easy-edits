"""Face boxes for source-prep.mjs (OpenCV Haar cascades, CPU, no model download).
  python3 source-prep-faces.py <video> <fps> <max-side> [both]
Decodes <video> with ffmpeg at <fps> as gray frames scaled to <max-side> px on the long side and prints:
  {"detector": "opencv-haar <ver>", "frames": [{"t": s, "faces": [[x, y, w, h], ...]}, ...]}
with boxes in source pixels. `both`: run the profile cascades on every frame, not only when no frontal face. Exit 3 when OpenCV is not importable (the caller falls back to saliency)."""
import json, subprocess, sys

try:
    import cv2
    import numpy as np
except ImportError:
    sys.exit(3)

video, fps, side = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
both = len(sys.argv) > 4 and sys.argv[4] == 'both'
probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                        '-of', 'csv=p=0', video], capture_output=True, text=True, check=True).stdout.split(',')
sw, sh = int(probe[0]), int(probe[1])
k = max(1, max(sw, sh) / side)
width, height = round(sw / k / 2) * 2, round(sh / k / 2) * 2
k = sw / width
data = cv2.data.haarcascades
front = cv2.CascadeClassifier(data + 'haarcascade_frontalface_default.xml')
profile = cv2.CascadeClassifier(data + 'haarcascade_profileface.xml')
min_side = max(24, int(min(width, height) * 0.06))

def detect(cc, img, flip=False):
    src = cv2.flip(img, 1) if flip else img
    out = []
    for (x, y, w, h) in cc.detectMultiScale(src, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side)):
        out.append([int(width - x - w) if flip else int(x), int(y), int(w), int(h)])
    return out

def iou(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    i = ix * iy
    return i / (a[2] * a[3] + b[2] * b[3] - i)

ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', video, '-an', '-vf', f'fps={fps},scale={width}:{height},format=gray',
                       '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
frames, n, size = [], 0, width * height
while True:
    buf = ff.stdout.read(size)
    if len(buf) < size:
        break
    img = cv2.equalizeHist(np.frombuffer(buf, np.uint8).reshape(height, width))
    boxes = detect(front, img)
    # profile cascades only when no frontal face (they cost twice the frontal pass)
    for b in [] if boxes and not both else detect(profile, img) + detect(profile, img, True):
        if all(iou(b, a) < 0.3 for a in boxes):
            boxes.append(b)
    frames.append({'t': round(n / fps, 3), 'faces': [[round(v * k) for v in b] for b in boxes]})
    n += 1
ff.wait()
print(json.dumps({'detector': f'opencv-haar {cv2.__version__}', 'frames': frames}))
