/** Shape report.json for the user / bot: when delivery PASSes, hide internal gate FAIL lines. */

const GATE_FAIL = /gate\s+\w+\s+FAIL|\bOVER FACE\b|gate seconds:/i;

function isGateLine(s) {
  return GATE_FAIL.test(String(s));
}

function scrubCheck(check, pass) {
  if (pass === false) return check; // keep delivery FAIL detail
  const lines = String(check || '').split('\n');
  const keep = lines.filter((l) => !/^FAIL\b/.test(l) || !isGateLine(l));
  // drop clean-cut gate FAIL blobs; keep PASS/NOTE/DELIVERY
  return keep.filter((l) => !isGateLine(l) || /^(PASS|NOTE|DELIVERY)\b/.test(l)).join('\n');
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
      out.diagnostics = { ...(out.diagnostics || {}), gates: out.cleanCut };
      delete out.cleanCut; // not user-facing on PASS
    }
  }
  if (Array.isArray(out.exports)) {
    out.exports = out.exports.map((e) => {
      const copy = { ...e };
      if (copy.gates && isGateLine(copy.gates) && copy.pass !== false) {
        copy.diagnostics = { ...(copy.diagnostics || {}), gates: copy.gates };
        delete copy.gates;
      }
      if (copy.check) copy.check = scrubCheck(copy.check, copy.pass);
      // note stays delivery-related (no-repeat NOTE etc.); strip gate FAIL phrases if any
      if (copy.pass !== false && copy.note && isGateLine(copy.note)) {
        copy.diagnostics = { ...(copy.diagnostics || {}), note: copy.note };
        copy.note = String(copy.note).split('\n').filter((l) => !isGateLine(l)).join('\n') || undefined;
      }
      return copy;
    });
  }
  if (gateLines.length && !out.diagnostics?.gates) {
    out.diagnostics = { ...(out.diagnostics || {}), gates: gateLines };
  }
  return out;
}
