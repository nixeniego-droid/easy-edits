#!/usr/bin/env python3
"""Easy Edits face id: WHO the face track is framing, per sample, by appearance against reference stills.

    python faceid.py <video> <track.json> <refs.json> <out.json> [--fps 2]

refs.json: [{"name": "Ana Cruz" | null, "image": "ref.jpg", "x": 0.85?}]; each image is a frame where that person
is the largest face (a single shot), or the face nearest x (fraction of the width) on a wide shot. A null name is a known OTHER person (a host to tell apart, never labelled).
Signature: hue x saturation histograms of the face box and of the torso under it (people keep their clothes for a
whole recording; a shirt colour survives angle and framing changes better than the face alone). Each sampled
track box is matched to the nearest reference (Bhattacharyya distance, torso weighted 0.6); farther than MAX_D
from every reference = unknown. Output: {"fps", "samples": [{"t", "who", "d"}]} (who = reference index or null).
"""
import json
import os
import sys

import cv2
import numpy as np

MAX_D = 0.55


def find_model():
    for p in (os.environ.get('EASY_EDITS_YUNET'), os.path.expanduser('~/.easy-edits/models-cv/face_detection_yunet_2023mar.onnx')):
        if p and os.path.isfile(p):
            return p
    return None


def hist(img):
    if img is None or img.size == 0 or img.shape[0] < 4 or img.shape[1] < 4:
        return None
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [18, 8], [0, 180, 0, 256])
    cv2.normalize(h, h)
    return h


def signature(frame, box):
    H, W = frame.shape[:2]
    x, y, w, h = [float(v) for v in box]
    fx0, fy0, fx1, fy1 = int(max(0, x + w * 0.15)), int(max(0, y + h * 0.1)), int(min(W, x + w * 0.85)), int(min(H, y + h * 0.9))
    tx0, ty0, tx1, ty1 = int(max(0, x - w * 0.6)), int(min(H, y + h * 1.25)), int(min(W, x + w * 1.6)), int(min(H, y + h * 2.6))
    return hist(frame[fy0:fy1, fx0:fx1]), hist(frame[ty0:ty1, tx0:tx1])


def dist(a, b):
    ds, ws = [], []
    for k, wt in ((0, 0.4), (1, 0.6)):
        if a[k] is not None and b[k] is not None:
            ds.append(cv2.compareHist(a[k], b[k], cv2.HISTCMP_BHATTACHARYYA)); ws.append(wt)
    return float(np.average(ds, weights=ws)) if ds else 1.0


def ref_signature(path, det, xhint=None):
    img = cv2.imread(path)
    if img is None:
        sys.exit(f'faceid: cannot read {path}')
    H, W = img.shape[:2]
    if det is not None:
        det.setInputSize((W, H))
        _, faces = det.detect(img)
        boxes = [f[:4] for f in faces] if faces is not None else []
    else:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        boxes = list(cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml').detectMultiScale(g, 1.1, 6, minSize=(40, 40)))
    if not len(boxes):
        sys.exit(f'faceid: no face in the reference still {path} (pick a time where that person is on screen)')
    if xhint is not None:  # a wide shot: the face nearest that horizontal position (0 = left edge, 1 = right)
        return signature(img, min(boxes, key=lambda b: abs(b[0] + b[2] / 2 - xhint * W)))
    return signature(img, max(boxes, key=lambda b: b[2] * b[3]))


def main():
    argv = sys.argv[1:]
    rate = float(argv[argv.index('--fps') + 1]) if '--fps' in argv else 2.0
    pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--fps')]
    if len(pos) != 4:
        sys.exit('usage: faceid.py <video> <track.json> <refs.json> <out.json> [--fps 2]')
    src, trk, refs_p, out = pos
    track = json.load(open(trk))
    refs = json.load(open(refs_p))
    model = find_model()
    det = cv2.FaceDetectorYN.create(model, '', (320, 320), 0.7, 0.3, 50) if model else None
    R = [ref_signature(r['image'], det, r.get('x')) for r in refs]
    S = [s for s in track['samples'] if s.get('box')]
    cap = cv2.VideoCapture(src)
    res, nxt = [], 0.0
    for s in S:
        if s['t'] + 1e-6 < nxt:
            continue
        nxt = s['t'] + 1.0 / rate
        cap.set(cv2.CAP_PROP_POS_MSEC, s['t'] * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        sig = signature(frame, s['box'])
        d = [dist(sig, r) for r in R]
        k = int(np.argmin(d))
        res.append({'t': s['t'], 'who': k if d[k] <= MAX_D else None, 'd': [round(x, 3) for x in d]})
    cap.release()
    with open(out, 'w') as f:
        json.dump({'tool': 'easy-edits/engine/faceid.py', 'fps': rate, 'refs': [r.get('name') for r in refs], 'samples': res}, f)
    print(f'faceid: {len(res)} samples, ' + ', '.join(f"{r.get('name') or 'other'} {sum(1 for x in res if x['who'] == i)}" for i, r in enumerate(refs)) + f' -> {out}')


if __name__ == '__main__':
    main()
