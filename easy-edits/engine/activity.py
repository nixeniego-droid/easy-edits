#!/usr/bin/env python3
"""Easy Edits screen activity track: where things change on a screen recording (typing, scrolling, clicks, new
panels), as a smoothed point per sample in the same JSON shape as facetrack.py, so the composer can zoom to it.

    python activity.py <video> <out.json> [--fps 4]

Per sample: absolute difference to the previous sample (grey, 320 px wide), thresholded and dilated; the box of
the changed pixels (2nd-98th percentile, so a blinking cursor elsewhere does not stretch it) gives the point; a
full-frame change (page switch, scroll of everything) re-centres on the frame centre. Quiet samples hold the last
point. "fw" = the activity box width in source px (the composer zooms tighter on small activity).
"""
import json
import sys

import cv2
import numpy as np


def main():
    argv = sys.argv[1:]
    pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--fps')]
    rate = float(argv[argv.index('--fps') + 1]) if '--fps' in argv else 4.0
    src, out = pos
    cap = cv2.VideoCapture(src)
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vfps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(vfps / rate))
    sw = 320
    sh = int(H * sw / W)
    prev, i, raw = None, 0, []
    while True:
        if not cap.grab():
            break
        if i % step == 0:
            ok, fr = cap.retrieve()
            if not ok:
                break
            g = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(fr, (sw, sh)), cv2.COLOR_BGR2GRAY), (3, 3), 0)
            pt = None
            if prev is not None:
                d = cv2.absdiff(g, prev)
                m = cv2.dilate((d > 18).astype(np.uint8), np.ones((5, 5), np.uint8))
                ys, xs = np.nonzero(m)
                share = len(xs) / m.size
                if share > 0.55:
                    pt = (W / 2, H / 2, W, 'full')
                elif len(xs) > 12:
                    x0, x1 = np.percentile(xs, [2, 98])
                    y0, y1 = np.percentile(ys, [2, 98])
                    s = W / sw
                    pt = ((x0 + x1) / 2 * s, (y0 + y1) / 2 * s, max(80.0, (x1 - x0) * s), 'part')
            raw.append((i / vfps, pt))
            prev = g
        i += 1
    cap.release()
    last = (W / 2, H / 2, W)
    samples = []
    for t, pt in raw:
        if pt:
            last = pt[:3]
        samples.append({'t': round(t, 3), 'cx': last[0], 'cy': last[1], 'fw': last[2], 'seen': pt is not None})
    # smooth: median 5 then EMA (the camera should glide, not chase every keystroke)
    if samples:
        a = np.array([[s['cx'], s['cy'], s['fw']] for s in samples], float)
        p = 2
        ap = np.pad(a, ((p, p), (0, 0)), mode='edge')
        a = np.array([np.median(ap[j:j + 5], axis=0) for j in range(len(a))])
        for j in range(1, len(a)):
            a[j] = 0.25 * a[j] + 0.75 * a[j - 1]
        for j, s in enumerate(samples):
            s['cx'], s['cy'], s['fw'] = round(float(a[j, 0]), 1), round(float(a[j, 1]), 1), round(float(a[j, 2]), 1)
            s['box'] = [s['cx'] - s['fw'] / 2, s['cy'] - s['fw'] / 2, s['fw'], s['fw']]
    seen = sum(1 for s in samples if s['seen'])
    with open(out, 'w') as f:
        json.dump({'tool': 'easy-edits/engine/activity.py', 'width': W, 'height': H, 'fps': rate, 'kind': 'screen',
                   'coverage': round(seen / max(1, len(samples)), 3), 'samples': samples}, f)
    print(f'activity: {len(samples)} samples, change seen {seen}/{len(samples)} -> {out}')


if __name__ == '__main__':
    main()
