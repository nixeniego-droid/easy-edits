#!/usr/bin/env python3
"""Easy Edits story identity: does a shot's character look like its reference image(s)? Face-region compare.

    python identity.py <out.json> --ref ref1.jpg [--ref ref2.png ...] frame1.png [frame2.png ...]

The largest face (YuNet, the same model as engine/faceid.py) in each reference and each frame gives two regions: the
face box and the torso under it. Each region is a coarse hue x saturation histogram (6 x 3 bins, near-black pixels
left out), compared with the Bhattacharyya distance (face 0.4, torso 0.6, as faceid.py). Only those regions are
compared, so the background (a grey studio backdrop vs a lit scene) no longer counts. The bins are coarse on purpose:
generated scenes relight the character (warm lantern light, dusk); 6 x 3 keeps a +-20 degree hue shift of the same
character under 0.33 while a different outfit colour or a greyscale frame scores >= 0.80 (story/qa.mjs QA_LIMITS).
Output: {"model": bool, "refs": [{"file", "face"}], "frames": [{"file", "face", "d": [per ref] | null}]}
(d = null when the frame has no face or no reference has one). No model file: "model": false, nothing compared.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))
from faceid import find_model  # noqa: E402

BINS = (6, 3)
WEIGHTS = (0.4, 0.6)


def hist(img):
    if img is None or img.size == 0 or img.shape[0] < 4 or img.shape[1] < 4:
        return None
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 0, 40), (180, 255, 255))
    if cv2.countNonZero(mask) < 8:
        return None
    h = cv2.calcHist([hsv], [0, 1], mask, list(BINS), [0, 180, 0, 256])
    cv2.normalize(h, h)
    return h


def signature(img, det):
    H, W = img.shape[:2]
    det.setInputSize((W, H))
    _, faces = det.detect(img)
    if faces is None or not len(faces):
        return None
    x, y, w, h = [float(v) for v in max((f[:4] for f in faces), key=lambda b: b[2] * b[3])]
    face = img[int(max(0, y + h * 0.1)):int(min(H, y + h * 0.9)), int(max(0, x + w * 0.15)):int(min(W, x + w * 0.85))]
    torso = img[int(min(H, y + h * 1.25)):int(min(H, y + h * 2.6)), int(max(0, x - w * 0.6)):int(min(W, x + w * 1.6))]
    return hist(face), hist(torso)


def dist(a, b):
    ds, ws = [], []
    for k in (0, 1):
        if a[k] is not None and b[k] is not None:
            ds.append(cv2.compareHist(a[k], b[k], cv2.HISTCMP_BHATTACHARYYA))
            ws.append(WEIGHTS[k])
    return round(float(np.average(ds, weights=ws)), 3) if ds else 1.0


def main():
    argv = sys.argv[1:]
    if not argv or argv[0].startswith('-'):
        sys.exit('usage: identity.py <out.json> --ref REF [--ref REF ...] FRAME [FRAME ...]')
    out, refs, frames, i = argv[0], [], [], 1
    while i < len(argv):
        if argv[i] == '--ref':
            refs.append(argv[i + 1])
            i += 2
        else:
            frames.append(argv[i])
            i += 1
    model = find_model()
    res = {'tool': 'easy-edits/story/identity.py', 'model': bool(model), 'refs': [], 'frames': []}
    if model:
        det = cv2.FaceDetectorYN.create(model, '', (320, 320), 0.7, 0.3, 50)
        R = []
        for f in refs:
            img = cv2.imread(f)
            s = signature(img, det) if img is not None else None
            R.append(s)
            res['refs'].append({'file': f, 'face': s is not None})
        known = [r for r in R if r is not None]
        for f in frames:
            img = cv2.imread(f)
            s = signature(img, det) if img is not None else None
            res['frames'].append({'file': f, 'face': s is not None, 'd': [dist(s, r) for r in known] if s is not None and known else None})
    with open(out, 'w') as fh:
        json.dump(res, fh)


if __name__ == '__main__':
    main()
