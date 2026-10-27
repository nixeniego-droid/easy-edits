// Test fixtures for the research tests: a tiny text PDF writer and a local HTTP server (no network).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** a one-page PDF with the given lines of text (Helvetica), valid xref so pdftotext reads it cleanly. */
export function writePdf(file, lines, { title = '' } = {}) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 11 Tf 50 760 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${esc(title)}) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  fs.writeFileSync(file, out);
  return file;
}

export const BEES_HTML = `<!doctype html><html><head><title>How bees see the world</title><script>var tracker = "Do not read this sentence.";</script><style>p{color:red}</style></head>
<body><nav>Home | About | Subscribe to our newsletter</nav><article><h1>How bees see the world</h1>
<p>Bees see ultraviolet light, which is invisible to humans.</p>
<p>Many flowers have ultraviolet patterns called nectar guides that point bees toward the nectar. Honeybees use the polarization pattern of the sky to find the direction of the sun even when it is hidden by clouds.</p>
<p>A honeybee&rsquo;s compound eye has about 5,500 lenses &amp; each one sees a small part of the scene.</p></article>
<footer>&copy; 2026 Example Press. All rights reserved.</footer></body></html>`;

export const BEES_MD = `# Honeybee navigation

Honeybees communicate the location of food sources through a behaviour called the **waggle dance**. The angle of the waggle run relative to vertical encodes the direction of the food relative to the sun.

The duration of the waggle run encodes the distance to the food source, with longer runs meaning farther flowers.

- Foragers can recruit nestmates to sources several kilometres away from the hive.
- Karl von Frisch received the Nobel Prize in 1973 for decoding the dance ([link](https://example.org/nobel)).
`;

export const PDF_LINES = [
  'Pollination report 2026',
  '',
  'Honeybees pollinate a large share of the crops that people eat every day.',
  'A single colony can visit millions of flowers during one season of foraging.',
];

/** serve {path: {type, body}} on 127.0.0.1; returns {url(p), close()} */
export async function serve(routes) {
  const srv = http.createServer((req, res) => {
    const r = routes[req.url.split('?')[0]];
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': r.type });
    res.end(r.body);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const { port } = srv.address();
  return { url: (p) => `http://127.0.0.1:${port}${p}`, close: () => new Promise((ok) => srv.close(ok)) };
}

/** a scratch folder for one test */
export function scratch(t, name) {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `ee-research-${name}-`));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
