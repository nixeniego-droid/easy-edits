// Likeness consent records (SPEC X1, G5). A consent.json says who the subject is, what may be synthesised
// (face, voice or both), when it was granted and when it expires, the subject's own statement, and the
// reference files with their sha256. `verifyConsent()` is the gate: --likeness self refuses before any
// generation unless a matching, unexpired, self-attested record with intact reference hashes exists.
// Refusals are hard errors (ConsentError), never warnings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CONSENT_VERSION = 1;
export const SCOPES = ['face', 'voice', 'both'];
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i, AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i, VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;

export class ConsentError extends Error {
  constructor(msg) { super(msg); this.name = 'ConsentError'; }
}

export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** What a reference file can stand for: an image = face, audio = voice, video = both. */
export function refKind(file) {
  if (IMAGE.test(file)) return 'face';
  if (AUDIO.test(file)) return 'voice';
  if (VIDEO.test(file)) return 'both';
  return null;
}

/** "face,voice" | "both" | ["face"] -> 'face' | 'voice' | 'both'. */
export function normaliseScope(v) {
  const parts = (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new ConsentError('no scope given: use face, voice or both (e.g. --allow face,voice)');
  for (const p of parts) if (!SCOPES.includes(p)) throw new ConsentError(`unknown scope "${p}": use face, voice or both`);
  const face = parts.includes('face') || parts.includes('both'), voice = parts.includes('voice') || parts.includes('both');
  return face && voice ? 'both' : face ? 'face' : 'voice';
}

const covers = (allowed, use) => allowed === 'both' || allowed === use;
const parseDate = (s, what) => {
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) throw new ConsentError(`${what} is missing or not a date (use YYYY-MM-DD or an ISO time)`);
  return t;
};
// a bare date expires at the END of that day (UTC), so "--expires 2027-01-31" covers 31 Jan
const expiryIso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? `${s}T23:59:59.000Z` : new Date(parseDate(s, '--expires')).toISOString());

export function statementFor(subject, allowed) {
  const what = allowed === 'both' ? 'my face and my voice' : `my ${allowed}`;
  return `I, ${subject}, am the person shown and/or heard in the reference files listed here. I consent to Easy Edits `
    + `synthesising ${what} from these files, on my own machine and with the backends I approve, until the expiry date. `
    + 'This record is not for a third party or a public figure, and I can withdraw it by deleting this file.';
}

/**
 * Build a consent record. Refuses unless the subject attests they are the person in the references
 * (`iAmTheSubject`), and refuses anything for somebody else (`onBehalfOf`).
 * attestation: { method: 'cli' | 'agent-relay', words? } (the user's own words when an agent relays them).
 */
export function createConsent({ subject, allow, refs = [], expires, iAmTheSubject, onBehalfOf, attestation = { method: 'cli' }, now = new Date() }) {
  if (onBehalfOf) throw new ConsentError('refused: consent can only be given by the subject for their own likeness, not on behalf of someone else (no third-party or public-figure likeness)');
  if (!iAmTheSubject) throw new ConsentError('refused: --i-am-the-subject is required. Only the person in the reference media can create a likeness consent record; Easy Edits never synthesises a third party or a public figure');
  subject = String(subject || '').trim();
  if (!subject) throw new ConsentError('--subject NAME is required (the name of the person giving consent: you)');
  const allowed = normaliseScope(allow);
  const exp = expiryIso(expires);
  if (Date.parse(exp) <= now.getTime()) throw new ConsentError(`--expires ${expires} is not in the future`);
  if (attestation.method === 'agent-relay' && !String(attestation.words || '').trim()) throw new ConsentError('agent relay needs the user\'s own words (--relay "...")');
  if (!refs.length) throw new ConsentError('at least one --ref FILE is required (a photo for face, a voice recording for voice, or a video for both)');
  const references = refs.map((f) => {
    const file = path.resolve(f);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ConsentError(`reference file not found: ${f}`);
    const kind = refKind(file);
    if (!kind) throw new ConsentError(`reference ${f}: use an image (face), an audio file (voice) or a video (both)`);
    return { file, kind, sha256: sha256File(file), bytes: fs.statSync(file).size };
  });
  for (const need of allowed === 'both' ? ['face', 'voice'] : [allowed]) {
    if (!references.some((r) => covers(r.kind, need))) throw new ConsentError(`--allow includes ${need} but no reference file covers it (${need === 'face' ? 'add a photo or a video' : 'add a voice recording or a video'})`);
  }
  const att = { method: attestation.method === 'agent-relay' ? 'agent-relay' : 'cli', self: true };
  if (att.method === 'agent-relay') att.words = String(attestation.words).trim();
  return {
    version: CONSENT_VERSION, subject, allowed,
    granted_at: now.toISOString(), expires_at: exp,
    statement: statementFor(subject, allowed),
    self_attested: true, attestation: att, references,
  };
}

/** Write a record with mode 600 (it names a person and points at their media). */
export function writeConsent(record, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/**
 * The gate. Returns { record, id, use, faceRefs, voiceRefs } or throws ConsentError with the reason.
 * use: what this run synthesises ('face' | 'voice' | 'both'); subject: optional name the run expects.
 */
export function verifyConsent(file, { use = 'both', subject, now = new Date() } = {}) {
  // use null = check the record itself (whatever it allows)
  if (!file) throw new ConsentError('refused: --likeness self needs --consent consent.json (create one with `easy-edits consent create --subject NAME --allow face,voice --ref FILE... --expires DATE --i-am-the-subject`)');
  if (!fs.existsSync(file)) throw new ConsentError(`refused: consent record not found: ${file}`);
  let rec;
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ConsentError(`refused: consent record ${file} is not valid JSON (${e.message})`); }
  if (!rec || typeof rec !== 'object') throw new ConsentError('refused: consent record is empty');
  if (rec.version !== CONSENT_VERSION) throw new ConsentError(`refused: consent record version ${rec.version} is not supported (expected ${CONSENT_VERSION})`);
  for (const k of ['subject', 'allowed', 'granted_at', 'expires_at', 'statement']) if (!rec[k]) throw new ConsentError(`refused: consent record has no ${k}`);
  if (rec.self_attested !== true || rec.attestation?.self !== true) throw new ConsentError('refused: the consent record is not self-attested by the subject (third-party and public-figure likeness are never synthesised)');
  if (!SCOPES.includes(rec.allowed)) throw new ConsentError(`refused: consent scope "${rec.allowed}" is not face, voice or both`);
  use = use || rec.allowed;
  if (subject && String(subject).trim().toLowerCase() !== String(rec.subject).trim().toLowerCase()) throw new ConsentError(`refused: the consent record is for "${rec.subject}", not "${subject}"`);
  const granted = parseDate(rec.granted_at, 'granted_at'), expires = parseDate(rec.expires_at, 'expires_at');
  if (granted > now.getTime()) throw new ConsentError(`refused: consent was granted in the future (${rec.granted_at})`);
  if (expires <= now.getTime()) throw new ConsentError(`refused: consent for ${rec.subject} expired at ${rec.expires_at}; create a new record`);
  if (!covers(rec.allowed, use)) throw new ConsentError(`refused: consent for ${rec.subject} allows ${rec.allowed} only, but this run needs ${use}`);
  const refs = Array.isArray(rec.references) ? rec.references : [];
  if (!refs.length) throw new ConsentError('refused: the consent record lists no reference files');
  const base = path.dirname(path.resolve(file));
  const checked = refs.map((r, i) => {
    if (!r?.file || !/^[0-9a-f]{64}$/.test(String(r.sha256 || ''))) throw new ConsentError(`refused: reference ${i + 1} has no file or sha256`);
    const f = path.resolve(base, r.file);
    if (!fs.existsSync(f)) throw new ConsentError(`refused: reference file missing: ${r.file}`);
    if (sha256File(f) !== r.sha256) throw new ConsentError(`refused: reference file changed since consent was given (sha256 mismatch): ${r.file}`);
    return { ...r, file: f, kind: refKind(f) || r.kind };
  });
  const faceRefs = checked.filter((r) => covers(r.kind, 'face')), voiceRefs = checked.filter((r) => covers(r.kind, 'voice'));
  if ((use === 'face' || use === 'both') && !faceRefs.length) throw new ConsentError('refused: no face reference (photo or video) in the consent record');
  if ((use === 'voice' || use === 'both') && !voiceRefs.length) throw new ConsentError('refused: no voice reference (recording or video) in the consent record');
  const id = sha256File(file).slice(0, 16);
  return { record: rec, id, use, faceRefs, voiceRefs };
}

/** What a report / plan may carry about a consent record (no file paths beyond names). */
export function consentSummary(v) {
  return {
    subject: v.record.subject, allowed: v.record.allowed, use: v.use, id: v.id,
    granted_at: v.record.granted_at, expires_at: v.record.expires_at, attestation: v.record.attestation?.method,
    references: [...new Set([...v.faceRefs, ...v.voiceRefs])].map((r) => ({ name: path.basename(r.file), kind: r.kind, sha256: r.sha256 })),
  };
}
