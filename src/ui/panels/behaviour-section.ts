import { ClipStart } from '../../model/play.enums';
import type { Clip, PlayScript } from '../../model/play.types';
import type { GroupId } from '../../model/scene.ids';
import type { GroupNode, SceneObject } from '../../model/scene.types';
import { groupIndex } from '../../world/group-tree';
import { BEHAVIOURS, CLIP_MODES, CLIP_STARTS, SCRIPT_LIMITS } from '../../world/play/behaviour-catalog';
import { type ScriptRef, defaultClip, newBehaviour, scriptTargets, trackTimes, withScript } from '../../world/play/scripts';
import { Feature, isFeatureOn } from '../../world/preview-features';
import { formatClock } from '../chrome/timeline-time';
import { type UiContext, hintOn } from '../context';
import { Button, Choice, NumberField, Select, openMenu } from '../kit/controls';
import { el } from '../kit/dom';
import { type ScriptEditor, behaviourRows, eventField, labelled } from './behaviour-rows';
import { zoneBlock } from './behaviour-zone';
import './behaviour.css';

/**
 * READ ME — Attributes › Behaviour (Play preview), for an object or a group, in
 * the Attributes panel and in the Object Attributes window: its own clip (a
 * stretch of its keys with Loop | Ping-pong | Once, a speed, and Auto or On
 * trigger), its behaviours (Add lists them), and for a trigger zone its rules.
 * Every change is one undo step. The section rebuilds itself when what it shows
 * changes, keeps the field you were in, and hides while Play is off.
 */

const SPEED_DIGITS = 2;
const HINTS = {
  clip: { title: 'Clip', text: 'In Play it plays a stretch of its keys on its own clock' },
  noKeys: { title: 'Clip', text: 'Key it at two times on the timeline, then pick them here' },
  add: { title: 'Add behaviour', text: 'Spin, Bob, Orbit, Follow Path, Formula, Spawner, Button, Counter, Push' },
  speed: { title: 'Speed', text: '1 plays as keyed, 2 twice as fast' },
  mode: { title: 'Mode', text: 'Loop, there and back, or once (a door)' },
  start: { title: 'Start', text: 'Auto plays as Play starts; On trigger waits for a zone or its event' },
} as const;

type Item = SceneObject | GroupNode;

function itemOf(ctx: UiContext, ref: ScriptRef): Item | undefined {
  return 'object' in ref ? ctx.world.object(ref.object) : groupIndex(ctx.world.scene).get(ref.group);
}

function editorOf(ctx: UiContext, ref: ScriptRef): ScriptEditor {
  const self = 'object' in ref ? ref.object : ref.group;
  return {
    ctx,
    ref,
    script: () => itemOf(ctx, ref)?.script ?? {},
    edit: (label, patch) => {
      if ('object' in ref) ctx.world.updateObjects(new Set([ref.object]), label, (o) => withScript(o, patch), true);
      else ctx.world.setGroupScript(ref.group as GroupId, label, patch);
    },
    targets: () => scriptTargets(ctx.world.scene).filter((t) => t.id !== self),
  };
}

const ensureOrder = (c: Clip): Clip | null => (c.from === c.to ? null : c.from < c.to ? c : { ...c, from: c.to, to: c.from });

function clipBlock(e: ScriptEditor, times: readonly number[]): HTMLElement {
  const clip = e.script().clip;
  const title = el('span', { cls: 'props-label bh-title', text: 'Clip' });
  const toggle = new Button({
    cls: 'props-chip',
    label: clip ? 'On' : 'Off',
    onClick: () => e.edit(clip ? 'Clip off' : 'Clip on', (s) => {
      const { clip: _old, ...rest } = s;
      const next = clip ? null : defaultClip(times);
      return next ? { ...rest, clip: next } : rest;
    }),
  });
  toggle.active = !!clip;
  toggle.disabled = !clip && times.length < 2;
  hintOn(e.ctx, toggle.el, times.length < 2 && !clip ? HINTS.noKeys : HINTS.clip);
  if (!clip) {
    const why = times.length < 2 ? 'key it at two times first' : 'plays a stretch of its keys';
    return el('div', { cls: 'bh-line bh-head' }, [title, toggle.el, el('span', { cls: 'bh-none', text: why })]);
  }
  const set = (label: string, patch: Partial<Clip>) => e.edit(label, (s) => {
    const next = s.clip ? ensureOrder({ ...s.clip, ...patch }) : null;
    return next ? { ...s, clip: next } : s;
  });
  const keys = [...new Set([...times, clip.from, clip.to])].sort((a, b) => a - b).map((t) => ({ value: t, label: formatClock(t) }));
  const from = new Select<number>({ items: keys, value: clip.from, title: 'From this key', onChange: (v) => set('Clip from', { from: v }) });
  const to = new Select<number>({ items: keys, value: clip.to, title: 'To this key', onChange: (v) => set('Clip to', { to: v }) });
  const speed = new NumberField({
    value: clip.speed, digits: SPEED_DIGITS, cls: 'bh-number',
    onCommit: (v) => set('Clip speed', { speed: Math.min(SCRIPT_LIMITS.speed.max, Math.max(SCRIPT_LIMITS.speed.min, Math.abs(v))) }),
  });
  speed.el.dataset.key = 'clip-speed';
  const mode = new Choice({ cls: 'segmented', items: CLIP_MODES, value: clip.mode, onChange: (m) => set('Clip mode', { mode: m }) });
  const start = new Choice({ cls: 'segmented', items: CLIP_STARTS, value: clip.start, onChange: (v) => set('Clip start', { start: v }) });
  hintOn(e.ctx, speed.el, HINTS.speed);
  hintOn(e.ctx, mode.el, HINTS.mode);
  hintOn(e.ctx, start.el, HINTS.start);
  const event = clip.start === ClipStart.Trigger
    ? labelled('On', eventField(clip.on, 'An event that plays it: forward, or back from its end', (n) => e.edit('Clip event', (s) => {
      if (!s.clip) return s;
      const { on: _old, ...rest } = s.clip;
      return { ...s, clip: n ? { ...rest, on: n } : rest };
    })))
    : null;
  return el('div', { cls: 'bh-block' }, [
    el('div', { cls: 'bh-line bh-head' }, [title, toggle.el, el('span', { cls: 'bh-param' }, [from.el, el('span', { cls: 'bh-unit', text: '→' }), to.el])]),
    el('div', { cls: 'bh-line' }, [mode.el, labelled('×', speed.el)]),
    el('div', { cls: 'bh-line' }, [start.el, event]),
  ]);
}

function addMenu(e: ScriptEditor, at: HTMLElement): void {
  const r = at.getBoundingClientRect();
  const full = (e.script().behaviours?.length ?? 0) >= SCRIPT_LIMITS.behaviours;
  openMenu(r.left, r.bottom, BEHAVIOURS.map((b) => ({
    label: b.label,
    hint: b.hint,
    disabled: full,
    run: () => e.edit(`Add ${b.label}`, (s: PlayScript) => ({ ...s, behaviours: [...(s.behaviours ?? []), newBehaviour(b.kind)] })),
  })));
}

/** The section's content for what it shows now. */
function content(ctx: UiContext, ref: ScriptRef, item: Item): HTMLElement[] {
  const e = editorOf(ctx, ref);
  const zone = 'kind' in item && item.zone ? zoneBlock(e, item) : null;
  const add = new Button({ cls: 'props-chip bh-add', label: '+ Add', onClick: () => addMenu(e, add.el) });
  hintOn(ctx, add.el, HINTS.add);
  const head = el('div', { cls: 'bh-line bh-head' }, [el('span', { cls: 'props-label bh-title', text: 'Behaviour' }), add.el]);
  const list = (item.script?.behaviours ?? []).map((b, i) => behaviourRows(e, b, i));
  return [zone, head, clipBlock(e, trackTimes(ctx.world.scene, ref)), ...list].filter((x): x is HTMLElement => !!x);
}

/** What the section shows, as text: it is built again only when this changes. */
function signature(ctx: UiContext, ref: ScriptRef, item: Item): string {
  const names = scriptTargets(ctx.world.scene).map((t) => t.name).join('\n');
  return JSON.stringify([item.script ?? null, 'kind' in item ? [item.kind, item.zone ?? null] : null, trackTimes(ctx.world.scene, ref), names]);
}

/** Attributes › Behaviour for an object or a group; hidden while the Play preview is off. */
export function behaviourSection(ctx: UiContext, ref: ScriptRef): HTMLElement {
  const root = el('div', { cls: 'bh' });
  let shown = '';
  const sync = () => {
    const item = itemOf(ctx, ref);
    if (!item) return;
    const sig = signature(ctx, ref, item);
    if (sig === shown) return;
    shown = sig;
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    root.replaceChildren(...content(ctx, ref, item));
    if (focused) root.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
  };
  const gate = () => { root.hidden = !isFeatureOn(ctx.editor.state.features, Feature.Play); };
  const when = (f: () => void) => (root.isConnected ? f() : stop());
  const offs = [
    ctx.world.events.on('changed', () => when(sync)),
    ctx.editor.events.on('changed', ({ state, previous }) => { if (state.features !== previous.features) when(gate); }),
  ];
  const stop = () => { for (const f of offs) f(); };
  gate();
  sync();
  return root;
}
