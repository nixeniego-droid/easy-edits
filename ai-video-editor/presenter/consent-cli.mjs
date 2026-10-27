// ai-video-editor consent create | verify | show (SPEC X1). Records live outside the repo:
// ~/.ai-video-editor/consent/<subject>.json by default (AI_VIDEO_EDITOR_HOME moves ~/.ai-video-editor), mode 600.
import '../engine/env-compat.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConsent, writeConsent, verifyConsent, consentSummary, normaliseScope, ConsentError } from './consent.mjs';

export const CONSENT_HELP = `ai-video-editor consent: likeness consent records for --likeness self (presenter).

usage
  ai-video-editor consent create --subject NAME --allow face,voice --ref FILE [--ref FILE...] --expires DATE --i-am-the-subject
                            [-o consent.json] [--relay "the user's own words"]
  ai-video-editor consent verify consent.json [--use face|voice|both] [--subject NAME]
  ai-video-editor consent show consent.json

create
  --subject NAME        your name: the person in the reference media (consent is only ever for yourself)
  --allow SCOPE         face, voice or both (face,voice = both)
  --ref FILE            reference media: a photo (face), a voice recording (voice) or a video (both); hashed with
                        sha256, so a changed file voids the record. The files stay on this machine
  --expires DATE        YYYY-MM-DD (end of that day, UTC) or an ISO time; required
  --i-am-the-subject    required: you attest you are the person in the references. Third-party and public-figure
                        likeness is refused
  --relay "..."         an agent creating the record for its user: the user's own words of consent, recorded verbatim
  -o FILE               where to write (default ~/.ai-video-editor/consent/<subject>.json, mode 600; keep it out of the repo)
`;

const easyHome = () => process.env.AI_VIDEO_EDITOR_HOME || path.join(os.homedir(), '.ai-video-editor');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subject';

export function parseConsentArgs(argv) {
  const o = { refs: [], pos: [] };
  const val = (i, a) => { if (i + 1 >= argv.length) throw new ConsentError(`${a} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--ref') { o.refs.push(val(i, a)); i++; }
    else if (a === '-o' || a === '--out') { o.out = val(i, a); i++; }
    else if (['--subject', '--allow', '--expires', '--relay', '--use', '--on-behalf-of'].includes(a)) { o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val(i, a); i++; }
    else if (a === '--i-am-the-subject') o.iAmTheSubject = true;
    else if (a.startsWith('-')) throw new ConsentError(`unknown option ${a}`);
    else o.pos.push(a);
  }
  return o;
}

/** Returns an exit code: 0 ok, 2 usage / refused. */
export function consentMain(argv, { out = process.stdout, err = process.stderr, now } = {}) {
  let o;
  try { o = parseConsentArgs(argv); } catch (e) { err.write(`ai-video-editor consent: ${e.message}\n`); return 2; }
  const cmd = o.pos.shift();
  if (o.help || !cmd) { out.write(CONSENT_HELP); return o.help ? 0 : 2; }
  try {
    if (cmd === 'create') {
      const rec = createConsent({
        subject: o.subject, allow: o.allow, refs: o.refs, expires: o.expires, iAmTheSubject: o.iAmTheSubject, onBehalfOf: o.onBehalfOf,
        attestation: o.relay != null ? { method: 'agent-relay', words: o.relay } : { method: 'cli' }, now,
      });
      const file = path.resolve(o.out || path.join(easyHome(), 'consent', `${slug(rec.subject)}.json`));
      writeConsent(rec, file);
      out.write(`consent: ${rec.subject} allows ${rec.allowed} until ${rec.expires_at}; ${rec.references.length} reference file(s) hashed\n${file}\n`);
      return 0;
    }
    if (cmd === 'verify' || cmd === 'show') {
      const file = o.pos[0];
      const v = verifyConsent(file, { use: o.use ? normaliseScope(o.use) : null, subject: o.subject, now });
      // `show` / a verify without --use only checks the record itself; scope is checked when --use is given
      if (cmd === 'show' || !o.use) out.write(`${JSON.stringify({ ...consentSummary(v), use: undefined, statement: v.record.statement }, null, 2)}\n`);
      else out.write(`consent OK: ${v.record.subject} allows ${v.record.allowed} (needed ${v.use}) until ${v.record.expires_at}\n`);
      return 0;
    }
    err.write(`ai-video-editor consent: unknown command ${cmd} (create, verify, show)\n`);
    return 2;
  } catch (e) {
    if (e instanceof ConsentError) { err.write(`ai-video-editor consent: ${e.message}\n`); return 2; }
    throw e;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(consentMain(process.argv.slice(2)));
