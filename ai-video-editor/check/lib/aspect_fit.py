# AI Video Editor aspect pixel fit: how the source footage is scaled into the final, per frame, x and y separately.
#   python3 -P aspect_fit.py <final.mp4> <source.mp4> <t:srcT>[,<t:srcT>...]   -> JSON list on stdout
# Per pair: grab final frame at t and source frame at srcT (ffmpeg, gray), (1) ORB matches + RANSAC affine
# source -> final: sx = |column x|, sy = |column y| (rotation-proof); (2) NCC grid refine: the final region
# covered by the ORB inliers is resampled back to source scale with x / y factors 0.80-1.20 (coarse 0.02, fine
# 0.005) around the ORB scale and template-matched in the source; best (kx, ky) gives sx / sy. ratio = sx / sy
# (1.00 = uniform). A pair with too few matches reports ok: false (the footage is not on screen there).
import json
import os
import subprocess
import sys

import cv2
import numpy as np


def frame(path, t):
    p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                        '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    w, h = map(int, p.stdout.strip().split(',')[:2])
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.4f}', '-i', path, '-frames:v', '1', '-f', 'rawvideo',
                        '-pix_fmt', 'gray', '-'], capture_output=True, check=True)
    if len(r.stdout) < w * h:
        return None
    return np.frombuffer(r.stdout[:w * h], np.uint8).reshape(h, w)


def orb_affine(src, fin):
    orb = cv2.ORB_create(4000)
    k1, d1 = orb.detectAndCompute(src, None)
    k2, d2 = orb.detectAndCompute(fin, None)
    if d1 is None or d2 is None:
        return None
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
    if len(m) < 12:
        return None
    a = np.float32([k1[x.queryIdx].pt for x in m])
    b = np.float32([k2[x.trainIdx].pt for x in m])
    M, inl = cv2.estimateAffine2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=5000, confidence=0.999)
    if M is None or inl is None or int(inl.sum()) < 12:
        return None
    inl = inl.ravel().astype(bool)
    sx, sy = float(np.hypot(M[0, 0], M[1, 0])), float(np.hypot(M[0, 1], M[1, 1]))
    return {'M': M, 'sx': sx, 'sy': sy, 'inliers': int(inl.sum()), 'pts': b[inl]}


def ncc_fit(src, fin, s0, box):
    x0, y0, x1, y1 = box
    patch = fin[y0:y1, x0:x1].astype(np.float32)
    S = src.astype(np.float32)

    def score(img, d, kx, ky):
        w, h = int(round(patch.shape[1] / (s0 * kx * d))), int(round(patch.shape[0] / (s0 * ky * d)))
        if w < 16 or h < 16 or w >= img.shape[1] or h >= img.shape[0]:
            return (-1.0, (0, 0))
        t = cv2.resize(patch, (w, h), interpolation=cv2.INTER_AREA)
        _, v, _, loc = cv2.minMaxLoc(cv2.matchTemplate(img, t, cv2.TM_CCOEFF_NORMED))
        return (float(v), loc)

    # coarse: half resolution, 0.02 steps; fine: full resolution, 0.005 steps, in a window around the coarse hit
    half = cv2.resize(S, (S.shape[1] // 2, S.shape[0] // 2), interpolation=cv2.INTER_AREA)
    best = (-2.0, 1.0, 1.0, (0, 0))
    for kx in np.arange(0.80, 1.2001, 0.02):
        for ky in np.arange(0.80, 1.2001, 0.02):
            v, loc = score(half, 2, kx, ky)
            best = max(best, (v, kx, ky, loc))
    _, bx, by, (lx, ly) = best
    m = 24
    wx0, wy0 = max(0, lx * 2 - m), max(0, ly * 2 - m)
    tw, th = patch.shape[1] / (s0 * bx * 0.97), patch.shape[0] / (s0 * by * 0.97)
    win = S[wy0:min(S.shape[0], int(ly * 2 + th + m)), wx0:min(S.shape[1], int(lx * 2 + tw + m))]
    fine = (-2.0, bx, by)
    for kx in np.arange(bx - 0.02, bx + 0.0201, 0.005):
        for ky in np.arange(by - 0.02, by + 0.0201, 0.005):
            fine = max(fine, (score(win, 1, kx, ky)[0], kx, ky))
    sc, kx, ky = fine
    return {'sx': s0 * kx, 'sy': s0 * ky, 'ncc': sc}


def fit(final, source, t, st):
    fin, src = frame(final, t), frame(source, st)
    out = {'t': t, 'srcT': st}
    if fin is None or src is None:
        return {**out, 'ok': False, 'why': 'no frame'}
    o = orb_affine(src, fin)
    if o is None:
        return {**out, 'ok': False, 'why': 'too few source matches (footage not on screen)'}
    p = o['pts']
    x0, y0 = np.percentile(p, 5, axis=0).astype(int)
    x1, y1 = np.percentile(p, 95, axis=0).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(fin.shape[1], x1), min(fin.shape[0], y1)
    if o['inliers'] < 40 or x1 - x0 < 160 or y1 - y0 < 160:
        return {**out, 'ok': False, 'why': f"weak fit ({o['inliers']} inliers, box {x1 - x0}x{y1 - y0}): footage not identifiable"}
    out.update(ok=True, orb={'sx': round(o['sx'], 4), 'sy': round(o['sy'], 4), 'ratio': round(o['sx'] / o['sy'], 4),
                             'inliers': o['inliers']}, box=[int(x0), int(y0), int(x1), int(y1)])
    s0 = (o['sx'] * o['sy']) ** 0.5
    if x1 - x0 >= 64 and y1 - y0 >= 64:
        n = ncc_fit(src, fin, s0, (x0, y0, x1, y1))
        out['ncc'] = {'sx': round(n['sx'], 4), 'sy': round(n['sy'], 4), 'ratio': round(n['sx'] / n['sy'], 4), 'score': round(n['ncc'], 3)}
    return out


if __name__ == '__main__':
    final, source, pairs = sys.argv[1], sys.argv[2], sys.argv[3]
    jobs = [(final, source, float(a), float(b)) for a, b in (p.split(':') for p in pairs.split(',') if p)]
    # the pairs are independent: AI_VIDEO_EDITOR_ASPECT_PROCS worker processes (default 4), same fits, same order
    procs = max(1, min(len(jobs), int(os.environ.get('AI_VIDEO_EDITOR_ASPECT_PROCS', '4'))))
    if procs > 1:
        import multiprocessing as mp
        with mp.get_context('fork').Pool(procs, initializer=cv2.setNumThreads, initargs=(1,)) as pool:
            res = pool.starmap(fit, jobs)
    else:
        res = [fit(*j) for j in jobs]
    print(json.dumps(res))
