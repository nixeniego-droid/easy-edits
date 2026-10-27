// Default caption preset (captions-default.json) as an ASS subtitle file, for burning captions
// into a finished video with ffmpeg/libass (no HyperFrames render). Same grouping and timing as
// captionGroups; spring pop approximated with \t scale transforms; one layout (safe-zone Y).
import { preset, captionGroups, captionY } from './captions-default.mjs';

const ts = (t) => { const cs = Math.round(t * 100), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const ms = (s) => Math.round(s * 1000);

export function captionAss(words, { duration, fps = 30, layout = 'face', p = preset, width = 1080, height = 1920 } = {}) {
  const f = p.font, P = p.pop, y = captionY(layout, p), caps = captionGroups(words, { duration, fps, p });
  const pct = Math.round(P.overshoot * 100);
  // libass sizes by ascent+descent, CSS by em: Montserrat's is 1.219 em, so scale to match the 84px CSS size
  const size = Math.round(f.size * 1.219);
  const text = (c) => (f.transform === 'uppercase' ? c.text.toUpperCase() : c.text).replace(/[{}\\]/g, '');
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${f.family},${size},&H00FFFFFF,&H00FFFFFF,&H80000000,&H26000000,-1,0,0,0,100,100,${f.letterSpacing},0,1,0.6,2,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${caps.map((c) => `Dialogue: 0,${ts(c.start)},${ts(c.end)},Cap,,0,0,0,,{\\pos(${width / 2},${y})\\fscx0\\fscy0\\t(0,${ms(P.inDuration)},\\fscx${pct}\\fscy${pct})\\t(${ms(P.settleAt)},${ms(P.settleAt + P.settleDuration)},\\fscx100\\fscy100)}${text(c)}`).join('\n')}
`;
}
