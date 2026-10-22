// Easy Edits composition theme: the colours, fonts and motion choices compose() draws with. HOUSE is the look every
// mode had before style packs (navy panels, Montserrat, yellow accent, hard cuts); themeOf(pack) maps a validated
// style pack (engine/style-pack.mjs) onto the same fields, so compose() has one code path for both.
import { hexRgb, rgba, relLum } from './contrast.mjs';

export const FONT_STACK = {
  Montserrat: "'Montserrat',sans-serif",
  'Playfair Display': "'Playfair Display',Georgia,serif",
  'JetBrains Mono': "'JetBrains Mono',ui-monospace,monospace",
};
/** a + (b - a) * t per channel, as '#rrggbb'. */
export const mix = (a, b, t) => { const B = hexRgb(b); return `#${hexRgb(a).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`; };

export const HOUSE = {
  id: null, house: true,
  bg: '#0b1020', text: '#fff', A: '#FFC83D', A2: '#4FD1C5', onA: '#0b1020',
  panelBg: 'radial-gradient(120% 90% at 30% 20%,#1d2b5a 0%,#111a3a 55%,#0b1020 100%)',
  cardBg: 'radial-gradient(110% 80% at 50% 30%,#22336b 0%,#121b3d 55%,#0b1020 100%)',
  grid: 'rgba(255,255,255,.045)', cardGrid: 'rgba(255,255,255,.05)', line: (a) => `rgba(255,255,255,${a})`,
  ring: 'rgba(255,255,255,.9)', labBg: '#fff', labFg: '#0b1020', ltBg: 'rgba(11,16,32,.88)', hookBg: 'rgba(11,16,32,.84)', hookFg: '#fff',
  font: { display: { stack: "'Montserrat',sans-serif", weight: 900 }, body: { stack: "'Montserrat',sans-serif", weight: 800 }, numbers: { stack: "'Montserrat',sans-serif", weight: 900 } },
  transition: 'cut', tDur: 0, entrance: 'drop', numbers: 'pop', signature: null, drift: 0.035, minGap: 0, punchZoom: null,
  sfx: 'full', cap: null,
};

/** pack (validated) -> theme; no pack -> HOUSE with the --preset accent. */
export function themeOf(pack, accent) {
  if (!pack) return { ...HOUSE, A: accent || HOUSE.A };
  const P = pack.palette, A = accent || P.accent, dark = relLum(P.background) < 0.2;
  const f = (r) => ({ stack: FONT_STACK[pack.fonts[r].family], weight: pack.fonts[r].weight, family: pack.fonts[r].family });
  return {
    id: pack.id, name: pack.name, house: false,
    bg: P.background, text: P.text, A, A2: P.accent2, onA: P.onAccent,
    panelBg: `radial-gradient(120% 90% at 30% 20%,${P.surface} 0%,${mix(P.surface, P.background, 0.5)} 55%,${P.background} 100%)`,
    cardBg: `radial-gradient(110% 80% at 50% 30%,${mix(P.surface, A, 0.08)} 0%,${mix(P.surface, P.background, 0.5)} 55%,${P.background} 100%)`,
    grid: rgba(P.text, dark ? 0.045 : 0.06), cardGrid: rgba(P.text, dark ? 0.05 : 0.07), line: (a) => rgba(P.text, a),
    ring: dark ? rgba(P.text, 0.9) : rgba(P.background, 0.95), labBg: P.text, labFg: P.background,
    ltBg: rgba(P.background, 0.9), hookBg: rgba(P.background, 0.88), hookFg: P.text,
    font: { display: f('display'), body: f('body'), numbers: f('numbers') },
    transition: pack.motion.transition, tDur: pack.motion.transitionDuration, entrance: pack.motion.entrance,
    numbers: pack.motion.numbers, signature: pack.motion.signature, drift: pack.motion.drift,
    minGap: pack.pacing.minBeatGap, punchZoom: pack.pacing.punchZoom, sfx: pack.sound.sfx,
    cap: { ...pack.captions, family: pack.fonts[pack.captions.font].family, stack: FONT_STACK[pack.fonts[pack.captions.font].family] },
  };
}

/** inline font css for a role; the house look keeps its original per-element weight. */
export const fontCss = (Th, role, houseWeight) => (Th.house ? `font-weight:${houseWeight}` : `font-family:${Th.font[role].stack};font-weight:${Th.font[role].weight}`);
