// `ai-video-editor new music-video` recipe (SPEC recipe 6): the user's own song, beat-snapped cuts, length = song length.
import { planMusicVideo } from '../../story/music-video.mjs';
import { renderPlan } from '../../story/render.mjs';
import { RefusalError } from '../../story/errors.mjs';
import { nativeOptions, toRegistryPlan, renderRegistry, requireAttestation } from '../../story/recipe-adapter.mjs';

export const name = 'music-video';
export const describe = 'music video cut to the beat of a song you own (--song FILE --i-own-this-music)';
/** opts: song, iOwnThisMusic (required), brief | shotlist, characters, aspect, backend, shotSec, snapTolerance, lyrics, transition, title. */
export function plan(opts = {}) { return planMusicVideo(opts); }
/** ctx: {outDir, offline, backends?, log?, iOwnThisMusic?}. A plan without a recorded attestation is refused. */
export function render(p, ctx = {}) {
  if (!p?.music?.attestation?.owned) throw new RefusalError('NO_MUSIC_ATTESTATION', 'refusing to render: the plan has no music ownership attestation (--i-own-this-music)');
  return renderPlan(p, ctx);
}

/** The `ai-video-editor new` registry shape (plan.json shots[], approval gate, generation session, host flow). */
export const recipe = {
  name, description: describe,
  keywords: ['music', 'song', 'lyrics', 'beat', 'track', 'band', 'singer', 'album'],
  defaults: { loudness: 'social' },
  plan(o) {
    if (!o.song) throw new Error('new music-video: needs --song FILE (a track you own) and --i-own-this-music');
    if (!o.iOwnThisMusic) throw new Error('new music-video: --song needs --i-own-this-music (only music you own or have licensed; it is recorded in report.json)');
    const native = planMusicVideo({ ...nativeOptions({ ...o, type: 'music-video' }), song: o.song, iOwnThisMusic: true, brief: o.brief || o.script,
      lyrics: o.lyrics, snapTolerance: o.snapTolerance });
    const len = native.durationSec;
    return toRegistryPlan(native, o, { length: [Math.floor(len), Math.ceil(len)], notes: [...native.notes, `song: ${native.music.attestation.song} (ownership attested with --i-own-this-music)`, `beats: ${native.beats.bpm || '?'} BPM; ${native.snap.snapped}/${native.snap.cuts} cuts snapped within ${native.snap.toleranceSec} s`] });
  },
  render(plan, ctx) { requireAttestation(plan.options.native); return renderRegistry(plan, ctx); },
};

export default { name, describe, plan, render };
