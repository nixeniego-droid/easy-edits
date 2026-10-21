#!/usr/bin/env python3
"""Easy Edits face track: one smoothed main-face box per sample over a whole video.

    python facetrack.py <video> <out.json> [--fps 4] [--model yunet.onnx] [--switch]

Detector: OpenCV YuNet (face_detection_yunet_2023mar.onnx, OpenCV Zoo, MIT) when the model file exists
(--model, $EASY_EDITS_YUNET, ~/.easy-edits/models-cv/), else OpenCV's bundled Haar cascade (more false faces on
slides, posters and lecterns). The main face is the one that continues the track (nearest to the last box,
size-weighted) inside a shot. Camera cuts (grey-histogram jumps) split the video into shots; in each shot the
faces are clustered by position and the track follows the most active one (mouth-region motion x size x
confidence: the speaking person on a multi-person wide shot). Gaps are held; smoothing never crosses a cut
(the sample after a cut carries "cut": true, so the composer hard-cuts the framing instead of panning). --switch
(podcasts): a long multi-face shot is split into speaker turns (speaker_turns: hysteresis + minimum turn), each
turn starting with "cut": true. Output (source pixel coordinates, box = [x, y, w, h], centre cx/cy):
  {"width", "height", "fps", "duration", "detector", "samples": [{"t", "box", "cx", "cy", "seen"}], "coverage"}
"""
import json
import os
import sys

import cv2
import numpy as np


def find_model(arg):
    for p in (arg, os.environ.get('EASY_EDITS_YUNET'), os.path.expanduser('~/.easy-edits/models-cv/face_detection_yunet_2023mar.onnx')):
        if p and os.path.isfile(p):
            return p
    return None


CUT_THUMB = 20.0
SW_MIN_SHOT, SW_WIN, SW_HOLD, SW_MIN_TURN, SW_RATIO = 5.0, 2.0, 1.5, 2.5, 1.3


def speaker_turns(raw, shot, good, rate):
    """--switch: a multi-face shot (podcast wide) split into speaker turns: per face cluster the mouth activity of
    its nearest detection, averaged over SW_WIN s; the framing switches to another face only when that face is
    SW_RATIO x more active for SW_HOLD s and the current turn has lasted SW_MIN_TURN s (no ping-pong, no jitter).
    Returns [(a, b, cluster index)] over positions in `shot`."""
    A = np.zeros((len(shot), len(good)))
    for j, k in enumerate(shot):
        for ci, c in enumerate(good):
            d = [(np.hypot(bx[0] + bx[2] / 2 - c['cx'], bx[1] + bx[3] / 2 - c['cy']), act) for (bx, sc, act) in raw[k][1]]
            d = [x for x in d if x[0] < 0.8 * c['w']]
            A[j, ci] = min(d)[1] if d else 0.0
    win = max(1, int(round(rate * SW_WIN)))
    ker = np.ones(win) / win
    S = np.stack([np.convolve(np.pad(A[:, ci], (win // 2, win - 1 - win // 2), mode='edge'), ker, mode='valid') for ci in range(len(good))], 1)
    hold, min_turn = int(round(rate * SW_HOLD)), int(round(rate * SW_MIN_TURN))
    cur = int(np.argmax(S[:max(1, win)].mean(0)))
    turns, a, run, cand = [], 0, 0, None
    for j in range(len(shot)):
        b = int(np.argmax(S[j]))
        if b != cur and S[j, b] > SW_RATIO * S[j, cur] + 0.3:
            run = run + 1 if cand == b else 1
            cand = b
        else:
            run, cand = 0, None
        start = j - run + 1
        if run >= hold and start - a >= min_turn and len(shot) - start >= min_turn:
            turns.append((a, start, cur))
            a, cur, run, cand = start, b, 0, None
    turns.append((a, len(shot), cur))
    return turns


def main():
    argv = sys.argv[1:]
    opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
    pos = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] not in ('--fps', '--model'))]
    if len(pos) != 2:
        sys.exit('usage: facetrack.py <video> <out.json> [--fps 4] [--model yunet.onnx] [--switch]')
    src, out = pos
    rate = float(opt('--fps', 4))
    switch = '--switch' in argv
    cap = cv2.VideoCapture(src)
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vfps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(vfps / rate))
    model = find_model(opt('--model'))
    scale = min(1.0, 960 / max(W, H))
    dw, dh = int(W * scale), int(H * scale)
    if model:
        det = cv2.FaceDetectorYN.create(model, '', (dw, dh), 0.7, 0.3, 50)
        detector = 'yunet'
    else:
        det = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        detector = 'haar'
    raw = []  # (t, boxes [(box, score, activity)], cut)
    i, prev_g, prev_h, prev_t = 0, None, None, None
    while True:
        ok = cap.grab()
        if not ok:
            break
        if i % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            small = cv2.resize(frame, (dw, dh))
            g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            # camera cut: the grey histogram changes a lot between samples (multi-camera podcasts, edits)
            h = cv2.calcHist([g], [0], None, [32], [0, 256]); cv2.normalize(h, h)
            # ... or a 64x36 thumbnail changes wholesale (two angles of one set share a histogram: mean abs
            # difference ~50 grey levels at a cut, ~1-3 while people talk and gesture)
            th = cv2.resize(g, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
            cut = prev_h is not None and (cv2.compareHist(prev_h, h, cv2.HISTCMP_BHATTACHARYYA) > 0.35 or float(np.mean(np.abs(th - prev_t))) > CUT_THUMB)
            boxes = []
            if detector == 'yunet':
                _, faces = det.detect(small)
                found = [([float(v) for v in f[:4]], float(f[14])) for f in (faces if faces is not None else [])]
            else:
                found = [([float(x), float(y), float(w), float(hh)], 0.8) for (x, y, w, hh) in det.detectMultiScale(g, 1.1, 6, minSize=(24, 24))]
            for (bx, sc) in found:
                x, y, w, hh = [int(round(v)) for v in bx]
                # mouth activity: change in the lower 45% of the face box since the previous sample (same shot)
                act = 0.0
                if prev_g is not None and not cut:
                    y0, y1 = max(0, y + int(hh * 0.55)), min(dh, y + hh + int(hh * 0.1))
                    x0, x1 = max(0, x), min(dw, x + w)
                    if y1 > y0 and x1 > x0:
                        act = float(np.mean(cv2.absdiff(g[y0:y1, x0:x1], prev_g[y0:y1, x0:x1])))
                boxes.append(([v / scale for v in bx], sc, act))
            raw.append((i / vfps, boxes, cut))
            prev_g, prev_h, prev_t = g, h, th
        i += 1
    cap.release()
    dur = (n or i) / vfps
    # shots: split at camera cuts; in each shot cluster the faces by position and follow the most active speaker
    # (mouth motion x size x confidence); one face in the shot = that face
    shots, cur = [], []
    for k, r in enumerate(raw):
        if r[2] and cur:
            shots.append(cur); cur = []
        cur.append(k)
    if cur:
        shots.append(cur)
    samples = [None] * len(raw)
    plan = []  # (sample indices, cluster): a shot, or one speaker turn of a shot (--switch)
    for shot in shots:
        clusters = []  # {cx, cy, w, score, members: {k: box}}
        for k in shot:
            for (bx, sc, act) in raw[k][1]:
                cx, cy = bx[0] + bx[2] / 2, bx[1] + bx[3] / 2
                cl = next((c for c in clusters if np.hypot(cx - c['cx'], cy - c['cy']) < 0.7 * max(c['w'], bx[2])), None)
                if cl is None:
                    cl = {'cx': cx, 'cy': cy, 'w': bx[2], 'score': 0.0, 'n': 0, 'members': {}}
                    clusters.append(cl)
                cl['members'][k] = bx
                cl['n'] += 1
                cl['score'] += (act + 0.5) * sc * (bx[2] ** 0.5)
                cl['cx'] += 0.2 * (cx - cl['cx']); cl['cy'] += 0.2 * (cy - cl['cy']); cl['w'] += 0.2 * (bx[2] - cl['w'])
        # a cluster seen in under a quarter of the shot is a false or passing face
        good = [c for c in clusters if c['n'] >= max(1, len(shot) // 4)] or clusters
        best = max(good, key=lambda c: c['score']) if good else None
        if switch and len(good) >= 2 and len(shot) >= rate * SW_MIN_SHOT:
            plan += [(shot[a:b], good[ci]) for (a, b, ci) in speaker_turns(raw, shot, good, rate)]
        else:
            plan.append((shot, best))
    for sub, best in plan:
        # the cluster says WHO; continuity says WHERE (a walking speaker leaves his first cluster): each sample takes
        # the detection nearest to the last box, within 1.5 face widths
        last = best['members'][min(best['members'], key=lambda m: abs(m - sub[0]))] if best else None
        for j, k in enumerate(sub):
            bx = None
            if last is not None and raw[k][1]:
                lx, ly = last[0] + last[2] / 2, last[1] + last[3] / 2
                near = min(raw[k][1], key=lambda d: np.hypot(d[0][0] + d[0][2] / 2 - lx, d[0][1] + d[0][3] / 2 - ly))
                if np.hypot(near[0][0] + near[0][2] / 2 - lx, near[0][1] + near[0][3] / 2 - ly) < 1.5 * max(last[2], near[0][2]):
                    bx = near[0]
            if bx is not None:
                last = bx
            samples[k] = {'t': round(raw[k][0], 3), 'box': last, 'seen': bx is not None, 'cut': j == 0 and k > 0}
        first = next((samples[k]['box'] for k in sub if samples[k]['box']), None)
        for k in sub:
            if samples[k]['box'] is None:
                samples[k]['box'] = first
    # smooth centres and size inside each shot only (a cut is a cut, never a pan): median 5 then EMA
    def med(a, kk=5):
        p = kk // 2
        ap = np.pad(a, p, mode='edge')
        return np.array([np.median(ap[j:j + kk]) for j in range(len(a))])
    def ema(a, al=0.35):
        o = a.copy()
        for j in range(1, len(a)):
            o[j] = al * a[j] + (1 - al) * o[j - 1]
        return o
    turns = len(plan) - len(shots)
    for shot in [sub for sub, _ in plan]:
        if not any(samples[k]['box'] for k in shot):
            for k in shot:
                samples[k]['cx'], samples[k]['cy'], samples[k]['box'] = W / 2, H * 0.35, None
            continue
        arr = np.array([samples[k]['box'] for k in shot], dtype=float)
        cx, cy, sz = arr[:, 0] + arr[:, 2] / 2, arr[:, 1] + arr[:, 3] / 2, arr[:, 2]
        cx, cy, sz = ema(med(cx)), ema(med(cy)), ema(med(sz), 0.2)
        for j, k in enumerate(shot):
            s = samples[k]
            s['cx'], s['cy'] = round(float(cx[j]), 1), round(float(cy[j]), 1)
            s['box'] = [round(float(cx[j] - sz[j] / 2), 1), round(float(cy[j] - sz[j] / 2), 1), round(float(sz[j]), 1), round(float(sz[j]), 1)]
    detector += f', {len(shots)} shot(s)' + (f', {turns} speaker switch(es)' if switch else '')
    seen = sum(1 for s in samples if s['seen'])
    res = {'tool': 'easy-edits/engine/facetrack.py', 'width': W, 'height': H, 'fps': rate, 'duration': round(dur, 3),
           'detector': detector, 'coverage': round(seen / max(1, len(samples)), 3), 'samples': samples}
    with open(out, 'w') as f:
        json.dump(res, f)
    print(f'facetrack: {detector} {len(samples)} samples, face seen {seen}/{len(samples)} -> {out}')


if __name__ == '__main__':
    main()
