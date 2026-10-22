// easy-edits clean-cut (APPROVED default): easy-edits/bin/clean-cut.sh unchanged for 9:16 (preset
// clean-cut-default.json: cut, review, burn render, gates, post); 1:1 and 16:9 reuse the
// same project (same cut, same mix, same caption text) through the engine with the same caption look.
import fs from 'node:fs';
import path from 'node:path';
import { REPO, run, log, sdrClip, faceTrack, contactSheet, writeSubtitles, deliveryCheck } from '../engine/media.mjs';
import { exportFormats, exportName } from '../engine/export.mjs';
import { measure } from '../audio/master.mjs';

export default async function cleanCut(o) {
  const proj = path.join(o.work, 'proj'), cutOut = path.join(o.work, 'cut.mp4');
  const want916 = o.formats.includes('9x16');
  const args = [path.join(REPO, 'easy-edits/bin/clean-cut.sh'), o.input, proj, cutOut];
  if (!want916) args.push('--build-only');
  if (o.transcript) args.push('--transcript', o.transcript);
  if (o.reviewPatch) args.push('--review-patch', o.reviewPatch);
  else if (o.noReview || process.env.EASY_EDITS_AGENT === 'none') args.push('--no-review');
  if (o.lang) args.push('--lang', o.lang);
  if (o.modeCut) args.push('--mode', o.modeCut);
  if (o.names) args.push('--names', o.names);
  log(`clean cut (approved path${want916 ? '' : ', build only'}) ...`);
  // --face: the approved 9:16 path reads it from the environment (clean-cut.sh -> engine/face-override.mjs)
  const r = run('bash', args, { label: 'clean-cut', logFile: o.logFile, allowFail: true, env: o.face ? { EASY_EDITS_FACE: `${o.face.x},${o.face.y}` } : undefined });
  const summary = (r.stderr || '').split('\n').filter((l) => /^clean-cut: (total|gate )/.test(l));
  const tr = JSON.parse(fs.readFileSync(path.join(proj, 'assets/transcript.json'), 'utf8'));
  const words = tr.words.filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
  const exports = [];
  if (want916) {
    const post = `${cutOut.replace(/\.mp4$/, '')}.post.mp4`;
    if (!fs.existsSync(post)) throw new Error(`clean-cut produced no final (${post}); see ${o.logFile}`);
    const base = exportName(o, '9x16'), out = path.join(o.out, `${base}.mp4`);
    fs.copyFileSync(post, out);
    contactSheet(out, path.join(o.out, `${base}_sheet.png`));
    writeSubtitles(words, path.join(o.out, base), { offset: 0.2 });
    const chk = deliveryCheck(out, { logFile: o.logFile, lang: o.lang || 'auto', words });
    exports.push({ format: '9x16', file: out, loudness: measure(out), pass: chk.pass, note: chk.note, check: chk.out.split('\n').slice(-10).join('\n'), gates: summary.at(-1) });
    log(`9x16: ${out} (approved clean-cut path; ${chk.pass ? 'delivery PASS' : 'delivery FAIL'})`);
  }
  const rest = o.formats.filter((f) => f !== '9x16');
  if (rest.length) {
    const clip = sdrClip(path.join(proj, 'assets/clip.mp4'), path.join(o.work, 'clip_sdr.mp4'));
    const track = faceTrack(clip, path.join(o.work, 'clip.track.json'), { logFile: o.logFile });
    const res = await exportFormats({ ...o, formats: o.formats }, { formatsOnly: rest, clipFile: clip, track, words, voice: path.join(proj, 'assets/mix.wav'), plan: { beats: [] }, captions: 'minimal', intro: 0, outro: 0, progress: false, lowerThird: false, music: null, leadIn: 0.2 });
    exports.push(...res.exports);
  }
  return { exports, cleanCut: summary };
}
