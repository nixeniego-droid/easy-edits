// Builds a HyperFrames composition (index.html) for the Easy Edits smoke test from
// assets/transcript.json, captioned with the default preset
// (easy-edits/presets/captions-default.*, from the stock porter-clipper-short project).
// Run from the project directory:  node build.mjs <duration-seconds>
import fs from 'node:fs';
import { captionGroups, captionCss, captionHtml, captionTweens } from '../presets/captions-default.mjs';

const FPS = 30;
const DUR = Number(process.argv[2]);
if (!(DUR > 0)) throw new Error('usage: node build.mjs <duration>');
const r3 = (t) => Math.round(t * 1000) / 1000;
const W = JSON.parse(fs.readFileSync('assets/transcript.json', 'utf8')).words.filter((w) => w.start < DUR);

const caps = captionGroups(W, { duration: DUR, fps: FPS });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Easy Edits smoke</title>
<script src="assets/gsap.min.js"></script>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#000}
#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Montserrat',sans-serif}
#spkwrap{position:absolute;left:0;top:0;width:1080px;height:1920px}
#spk{position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover}
${captionCss({ layout: 'face' })}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="1080" data-height="1920">
<div id="spkwrap"><video id="spk" src="assets/clip.mp4" muted playsinline data-start="0" data-duration="${DUR}" data-track-index="0"></video></div>
${captionHtml(caps)}
<audio id="mix" src="assets/mix.wav" data-start="0" data-duration="${DUR}" data-track-index="6" data-volume="1"></audio>
</div>
<script>
const tl=gsap.timeline({paused:true});
${captionTweens(caps)}
tl.set({}, {}, ${DUR});
window.__timelines=window.__timelines||{};window.__timelines['main']=tl;
</script></body></html>
`;
fs.writeFileSync('index.html', html);
fs.writeFileSync('assets/captions.json', JSON.stringify(caps, null, 1));
console.log(`index.html: ${caps.length} caption groups, ${W.length} words, ${DUR}s`);
