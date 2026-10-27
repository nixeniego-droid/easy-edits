// `ai-video-editor new story` recipe: multi-shot story (SPEC recipe 4). The work lives in ../../story/.
import { planStory } from '../../story/story.mjs';
import { renderPlan } from '../../story/render.mjs';
import { nativeOptions, toRegistryPlan, renderRegistry } from '../../story/recipe-adapter.mjs';

export const name = 'story';
export const describe = 'multi-shot story from a brief or shotlist.json, with character lock and per-shot QA';
/** opts: brief | shotlist, characters, aspect, backend, length, shotSec, narrate, narration, music + iOwnThisMusic, captions, title. */
export function plan(opts = {}) { return planStory(opts); }
/** ctx: {outDir, offline, backends?, log?} -> {file, report, reportFile, pass} */
export function render(p, ctx = {}) { return renderPlan(p, ctx); }

/** The `ai-video-editor new` registry shape (plan.json shots[], approval gate, generation session, host flow). */
export const recipe = {
  name, description: describe,
  keywords: ['story', 'tale', 'character', 'narrative', 'film', 'scene', 'adventure', 'fairy'],
  defaults: { loudness: 'social' },
  plan(o) {
    const brief = o.brief || o.script;
    if (!brief && !o.shotlist) throw new Error('new story: needs --brief "...", --script FILE or --shotlist FILE');
    const native = planStory({ ...nativeOptions({ ...o, type: 'story' }), brief, length: o.length ? (o.length[0] + o.length[1]) / 2 : undefined,
      narrate: !!(o.narrate || o.script), narration: o.narration, music: o.music, iOwnThisMusic: !!o.iOwnThisMusic, captions: !o.noCaptions });
    return toRegistryPlan(native, o, (native.characters || []).length ? { notes: [...native.notes, `characters: ${native.characters.map((c) => c.name).join(', ')} (description on every prompt; reference images go to backends that take them)`] } : {});
  },
  render: renderRegistry,
};

export default { name, describe, plan, render };
