// AI Video Editor icon set: simple stroke icons on a 24-unit grid, drawn for AI Video Editor (no third-party glyphs, no emoji
// font needed: a fresh machine renders them the same). Each value is the inner SVG markup; icon() wraps it.
export const ICONS = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/>',
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9c0 6.1-8 11-8 11z"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6.5 18a2.5 2.5 0 0 0 5 .5V5.5A1.8 1.8 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3 3 0 0 1-2.5 5.3 2.5 2.5 0 0 1-5 .5V5.5A1.8 1.8 0 0 1 15 4.5z"/>',
  camera: '<path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.2" r="3.6"/>',
  book: '<path d="M3.5 5.5C6 4.5 9 4.5 12 6.5c3-2 6-2 8.5-1v13c-2.5-1-5.5-1-8.5 1-3-2-6-2-8.5-1z"/><path d="M12 6.5v13"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.1v1.6h5.2v-1.6c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/><circle cx="12" cy="12" r="1.6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.2 5.4-5.4 2.2 2.2-5.4z"/>',
  pin: '<path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5z"/><circle cx="12" cy="10" r="2.6"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.6-3.6 3.1-5.6 6.2-5.6s5.6 2 6.2 5.6"/><path d="M15.5 4.9a3.3 3.3 0 0 1 0 6.3M17.6 14.6c2 .7 3.3 2.6 3.7 5.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-4.2 3.6-6.6 7.5-6.6s6.8 2.4 7.5 6.6"/>',
  rocket: '<path d="M12 2.5c3.2 2.3 4.8 5.6 4.8 9.3l-1.8 4.7H9l-1.8-4.7c0-3.7 1.6-7 4.8-9.3z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9 16.5l-2.8 2.3.6-4.6M15 16.5l2.8 2.3-.6-4.6M10.5 19.5L12 22l1.5-2.5"/>',
  chart: '<path d="M3 3.5v17h17.5"/><path d="M6.5 15.5l4-4.5 3.2 3 5.8-6.5"/><path d="M15.5 7.5h4v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.6 2.2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  sparkles: '<path d="M10 3l1.6 4.6L16 9.2l-4.4 1.6L10 15.5 8.4 10.8 4 9.2l4.4-1.6z"/><path d="M18 13l.9 2.4 2.4.9-2.4.9L18 19.6l-.9-2.4-2.4-.9 2.4-.9z"/>',
  quote: '<path d="M4 17.5c0-4.6 1.4-7.9 5-10.5l1.2 1.6C8.3 10.4 7.6 12 7.5 13.3H10v4.2zM14 17.5c0-4.6 1.4-7.9 5-10.5l1.2 1.6c-1.9 1.8-2.6 3.4-2.7 4.7H20v4.2z"/>',
  flag: '<path d="M5 21.5V3.5"/><path d="M5 4.2c4.5-2 7.5 2 12.5 0v9c-5 2-8-2-12.5 0"/>',
  mountain: '<path d="M2.5 20l6.5-11 4 6.5 2.5-3.5 6 8z"/><path d="M7.4 11.7l1.6 1.3 1.4-1.4"/>',
  arrow: '<path d="M4 12h15.5"/><path d="M13.5 6l6 6-6 6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 1 1 3.7 2.5c-.7.3-1.1.9-1.1 1.6v.8"/><circle cx="12" cy="17" r=".5"/>',
  mic: '<rect x="9" y="2.8" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>',
  money: '<circle cx="12" cy="12" r="9"/><path d="M15 8.6c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.3 0 3.2 6.2 1.7 6.2 4.9 0 1.4-1.3 2.4-3.2 2.4-1.4 0-2.6-.6-3.2-1.7M12 5.2v1.9M12 16.9v1.9"/>',
  home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.2V20h12V9.2"/><path d="M10 20v-5.5h4V20"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.3l5.6 3.7-5.6 3.7z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.6 7-6.5 7-2.7 0-4.3-1.4-5.6-3.6L3.4 14a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  shield: '<path d="M12 2.8l7.5 3v6c0 4.7-3.2 8.3-7.5 9.7-4.3-1.4-7.5-5-7.5-9.7v-6z"/><path d="M8.6 12.2l2.4 2.4 4.6-4.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  path: '<circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><path d="M7.5 18.5h7a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h7"/>',
};

/** keyword (lower-case stem) -> icon; first match in transcript order wins. Concepts only, never decoration. */
export const KEYWORD_ICONS = [
  [/^(vision|visions|see|seeing|sight|look|watch)$/, 'eye'],
  [/^(heart|hearts|love|loves|passion|feel|feelings?)$/, 'heart'],
  [/^(head|mind|minds|brain|think|thinking|logic|reason)$/, 'brain'],
  [/^(picture|pictures|snapshot|photo|photos|image|camera)$/, 'camera'],
  [/^(bible|scripture|proverbs|psalms?|verse|book|books|read|reading)$/, 'book'],
  [/^(idea|ideas|insight|inspires?|inspired|inspiration|creative|creativity)$/, 'bulb'],
  [/^(goal|goals|purpose|aim|target|focus|mission)$/, 'target'],
  [/^(direction|directions|guide|guidance|navigate|compass)$/, 'compass'],
  [/^(destination|destinations|location|arrive|arrival|map)$/, 'pin'],
  [/^(people|team|teams|community|together|everyone|church|family|families)$/, 'users'],
  [/^(future|launch|grow|growth|scale|rocket|spacecraft|space)$/, 'rocket'],
  [/^(data|results?|numbers?|percent|increase|progress)$/, 'chart'],
  [/^(world|global|planet|earth|country|countries|international)$/, 'globe'],
  [/^(time|minutes?|hours?|years?|days?|today|tomorrow|deadline)$/, 'clock'],
  [/^(money|cost|costs|price|pay|paid|budget|dollars?|pesos?|revenue|sales)$/, 'money'],
  [/^(question|questions|why|wonder)$/, 'question'],
  [/^(safe|safety|protect|protection|shield|secure|security)$/, 'shield'],
  [/^(home|house)$/, 'home'],
  [/^(journey|road|path|steps?|process)$/, 'path'],
];

export function icon(name, { size = 120, stroke = 1.7, color = 'currentColor' } = {}) {
  const inner = ICONS[name] || ICONS.sparkles;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export const iconFor = (word) => {
  const w = String(word).toLowerCase().replace(/[^a-z']/g, '');
  const hit = KEYWORD_ICONS.find(([re]) => re.test(w));
  return hit ? hit[1] : null;
};
