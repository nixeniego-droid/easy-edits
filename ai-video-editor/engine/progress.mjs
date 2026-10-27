// Plain-English + optional JSON progress on stderr. Throttle ~10 s between ticks; always emit stage start/end.
const mode = () => (process.env.AI_VIDEO_EDITOR_PROGRESS || 'plain').toLowerCase();

/** Format elapsed seconds as M:SS or "N s". */
export function fmtElapsed(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Create a progress reporter for one stage.
 * returns { tick(percent?, detail?), stage(name, message), end() }
 */
export function startProgress(stage, message, { everySec = 10 } = {}) {
  const t0 = Date.now();
  let last = 0;
  let curStage = stage;
  let curMsg = message;
  const emit = (percent, final = false, detail = null) => {
    const elapsedSec = (Date.now() - t0) / 1000;
    const pct = percent == null || Number.isNaN(Number(percent)) ? null : Math.max(0, Math.min(100, Math.round(Number(percent))));
    if (mode() === 'json') {
      const row = { stage: curStage, message: curMsg, elapsedSec: Math.round(elapsedSec * 10) / 10 };
      if (pct != null) row.percent = pct;
      if (detail) row.detail = detail;
      if (final) row.done = true;
      process.stderr.write(`ai-video-editor-progress: ${JSON.stringify(row)}\n`);
      return;
    }
    const bits = [curMsg];
    if (detail) bits.push(detail);
    if (pct != null) bits.push(`${pct}%`);
    bits.push(`(${fmtElapsed(elapsedSec)}${final ? ' done' : ' elapsed'})`);
    process.stderr.write(`ai-video-editor: ${bits.join(' ')}\n`);
  };
  emit(0, false);
  return {
    stage(name, msg) { curStage = name; curMsg = msg || name; last = 0; emit(null, false); },
    tick(percent, detail) {
      const now = Date.now();
      if (now - last < everySec * 1000 && percent !== 100 && !detail) return;
      last = now;
      emit(percent, false, detail);
    },
    end() { emit(100, true); },
  };
}

/** Run async fn while pulsing elapsed every everySec. fn may call p.stage / p.tick. */
export async function withProgress(stage, message, fn, { everySec = 10 } = {}) {
  const p = startProgress(stage, message, { everySec });
  let pulsePct = 0;
  const iv = setInterval(() => {
    // gentle climb toward 95% while work runs so the user never sees a stuck 0%
    pulsePct = Math.min(95, pulsePct + Math.max(1, Math.round(8 / Math.max(1, everySec))));
    p.tick(pulsePct);
  }, everySec * 1000);
  try { return await fn(p); }
  finally { clearInterval(iv); p.end(); }
}

/** Parse clean-cut / ffmpeg progress lines into ticks. */
export function ingestProgressLine(p, line, { weights } = {}) {
  if (!p || !line) return;
  const s = String(line);
  // clean-cut: prep 3 s  / clean-cut: render 6 s
  let m = /^clean-cut:\s+(\w+)\s+(\d+)\s*s/.exec(s);
  if (m) {
    const map = {
      prep: ['prep', 'Preparing your video…', 5],
      asr: ['asr', 'Listening and writing captions…', 20],
      cut: ['cut', 'Cutting fillers and pauses…', 30],
      review: ['review', 'Checking the cut…', 35],
      build: ['build', 'Building the edit…', 45],
      verify: ['verify', 'Checking captions…', 55],
      render: ['render', 'Rendering your video…', 70],
      gates: ['gates', 'Running quality checks…', 85],
      post: ['post', 'Finishing sound and delivery…', 95],
    };
    const info = map[m[1]];
    if (info) { p.stage(info[0], info[2] != null ? info[1] : info[1]); p.tick(info[2]); }
    return;
  }
  // ffmpeg -progress: frame=  or out_time_ms=
  m = /out_time_ms=(\d+)/.exec(s);
  if (m) {
    const sec = Number(m[1]) / 1e6;
    p.tick(null, `encode ${sec.toFixed(1)} s`);
    return;
  }
  m = /frame=\s*(\d+)/.exec(s);
  if (m) p.tick(null, `frame ${m[1]}`);
}
