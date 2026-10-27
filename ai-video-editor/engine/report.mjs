/** Shape report.json for the user / bot: when delivery PASSes, hide internal gate FAIL lines. */
import { reusedPhraseNote } from './words.mjs';

const GATE_FAIL = /gate\s+\w+\s+(FAIL|info)|quality note\s*\(|\bOVER FACE\b|gate seconds:/i;
const JARGON_NOTE = /phrase\(s\) the speaker uses in two different places[^"]*"([^"]+)"\s*x(\d+)/i;

function isGateLine(s) {
  return GATE_FAIL.test(String(s));
}

function plainNote(note) {
  let n = String(note || '');
  const m = JARGON_NOTE.exec(n);
  if (m) n = reusedPhraseNote(m[1], Number(m[2]) || 2);
  // also strip leftover jargon fragments
  n = n.replace(/phrase\(s\) the speaker uses in two different places \(not a retake\):[^.]*\./gi, '').trim();
  return n || undefined;
}

function scrubCheck(check, pass) {
  if (pass === false) return check;
  const lines = String(check || '').split('\n');
  return lines
    .filter((l) => !isGateLine(l))
    .map((l) => {
      const m = /^NOTE\s+no-repeat\s+(.*)$/i.exec(l);
      if (!m) return l;
      const jm = JARGON_NOTE.exec(m[1]) || /"([^"]+)"\s*x(\d+)/i.exec(m[1]);
      if (jm) return `NOTE  ${reusedPhraseNote(jm[1], Number(jm[2]) || 2)}`;
      if (/reused|two different places/i.test(m[1])) {
        const k = /"([^"]+)"/.exec(m[1]);
        return `NOTE  ${reusedPhraseNote(k?.[1] || '', 2)}`;
      }
      return l;
    })
    .filter((l) => !/^FAIL\b/.test(l))
    .join('\n');
}

/** When delivery PASSed, rewrite "gate X FAIL" -> "gate X info" for diagnostics only. */
function asInfoGates(lines) {
  return (lines || []).map((l) => String(l).replace(/\bFAIL\b/g, 'info'));
}

/**
 * @param {object} report raw report (mode, exports, cleanCut?, …)
 * @returns {object} user-facing report with diagnostics.gates when needed
 */
export function publicReport(report) {
  const out = { ...report };
  const gateLines = [];
  if (Array.isArray(out.cleanCut)) {
    for (const line of out.cleanCut) if (isGateLine(line)) gateLines.push(line);
    const deliveryPass = (out.exports || []).every((e) => e.pass !== false);
    if (deliveryPass) {
      out.diagnostics = { ...(out.diagnostics || {}), gates: asInfoGates(out.cleanCut) };
      delete out.cleanCut;
    }
  }
  if (Array.isArray(out.exports)) {
    out.exports = out.exports.map((e) => {
      const copy = { ...e };
      if (copy.gates && isGateLine(copy.gates) && copy.pass !== false) {
        copy.diagnostics = { ...(copy.diagnostics || {}), gates: String(copy.gates).replace(/\bFAIL\b/g, 'info') };
        delete copy.gates;
      }
      if (copy.check) copy.check = scrubCheck(copy.check, copy.pass);
      if (copy.pass !== false && copy.note) {
        if (isGateLine(copy.note)) {
          copy.diagnostics = { ...(copy.diagnostics || {}), note: copy.note };
          copy.note = undefined;
        } else {
          copy.note = plainNote(copy.note);
        }
      }
      return copy;
    });
  }
  if (gateLines.length && !out.diagnostics?.gates) {
    const deliveryPass = (out.exports || []).every((e) => e.pass !== false);
    out.diagnostics = { ...(out.diagnostics || {}), gates: deliveryPass ? asInfoGates(gateLines) : gateLines };
  }
  return out;
}
