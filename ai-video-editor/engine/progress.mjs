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
 * returns { tick(percent?), end() }
 */
export function startProgress(stage, message, { everySec = 10 } = {}) {
  const t0 = Date.now();
  let last = 0;
  const emit = (percent, final = false) => {
    const elapsedSec = (Date.now() - t0) / 1000;
    const pct = percent == null || Number.isNaN(Number(percent)) ? null : Math.max(0, Math.min(100, Math.round(Number(percent))));
    if (mode() === 'json') {
      const row = { stage, message, elapsedSec: Math.round(elapsedSec * 10) / 10 };
      if (pct != null) row.percent = pct;
      if (final) row.done = true;
      process.stderr.write(`ai-video-editor-progress: ${JSON.stringify(row)}\n`);
      return;
    }
    const bits = [message];
    if (pct != null) bits.push(`${pct}%`);
    bits.push(`(${fmtElapsed(elapsedSec)}${final ? ' done' : ' elapsed'})`);
    process.stderr.write(`ai-video-editor: ${bits.join(' ')}\n`);
  };
  emit(null, false);
  return {
    tick(percent) {
      const now = Date.now();
      if (now - last < everySec * 1000 && percent !== 100) return;
      last = now;
      emit(percent, false);
    },
    end() { emit(100, true); },
  };
}

/** Run async fn while pulsing elapsed every everySec. */
export async function withProgress(stage, message, fn, { everySec = 10 } = {}) {
  const p = startProgress(stage, message, { everySec });
  const iv = setInterval(() => p.tick(), everySec * 1000);
  try { return await fn(p); }
  finally { clearInterval(iv); p.end(); }
}
