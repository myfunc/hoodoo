import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import { BooleanMode } from '../../../model/scene.enums';
import { asGroupId } from '../../../model/scene.ids';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { worldBox } from '../../../world/bounds';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { Button } from '../../sim/actor';
import { Motion } from '../../sim/physics';
import { PlaySim } from '../../sim/play-sim';
import { SceneEdits } from '../scene-edits';
import { Colour } from '../tools/colour';
import { MaterialTool } from '../tools/material';
import { Remover } from '../tools/remover';
import { Resize, ResizeAxis, ResizeMode } from '../tools/resize';
import { SettingKind } from '../../../ui/sandbox/tool-menu';
import { ToolButton, type ToolContext, type ToolHit } from '../tools/tool';
import { createTools } from '../tools/tools';
import { ToolGun } from '../weapons/toolgun';
import type { WeaponContext } from '../weapons/weapon';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });

function stage(objects: SceneObject[], groups: Scene['groups'] = []): Scene {
  const base = emptyScene();
  return { ...base, objects, groups, camera: { ...base.camera, position: [0, 1.7, 8], yaw: 0, pitch: 0 } };
}

/** The editor's world, play following it, and the tools' context, as Sandbox wires them. */
async function bench(scene: Scene) {
  const world = new World(scene);
  const sim = await PlaySim.create({ scene: world.scene, time: 0, player: human });
  world.events.on('changed', ({ scene: s }) => sim.sync(s));
  const edits = new SceneEdits(world, sim);
  const ctx: ToolContext = {
    edits,
    moving: (id) => (sim.bodies.itemOf(id)?.motion ?? Motion.Fixed) !== Motion.Fixed,
    joined: (id) => sim.bodies.sharing([id]),
    anchor: () => null,
    whole: (id) => new Set([id]), decalsOn: () => new Set(), carved: () => false, pose: () => null,
  };
  const hit = (name: string): ToolHit => {
    const object = world.scene.objects.find((o) => o.name === name)!;
    return { object, point: object.transform.position };
  };
  const object = (name: string) => world.scene.objects.find((o) => o.name === name);
  return { world, sim, edits, ctx, hit, object };
}

const ground = () => at('ground', [0, 0, 0]);
const crate = () => ({ ...at('cube', [0, 1, 0], [1, 1, 1], 3), name: 'Crate' });

describe('Material', () => {
  it('applies the chosen preset as one History step, copies one with Mouse 2, gives the first one back with R', async () => {
    const b = await bench(stage([ground(), crate()]));
    const first = b.object('Crate')!.material;
    const tool = new MaterialTool();
    tool.preset = 'Gold';
    expect(tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate')!.material.name).toBe('Gold');
    expect(b.edits.labels).toEqual(['Material Crate']);
    tool.preset = 'Chrome';
    expect(tool.use(ToolButton.Secondary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(tool.preset).toBe('Gold');
    expect(tool.use(ToolButton.Reload, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate')!.material).toBe(first);
    expect(tool.use(ToolButton.Primary, b.hit('Ground Plane'), b.ctx)).toBe(true);
  });
});

describe('Colour', () => {
  it('paints the diffuse colour flat, an alpha under 100% lets light through, R takes the colour back', async () => {
    const b = await bench(stage([ground(), crate()]));
    const first = b.object('Crate')!.material;
    const tool = new Colour();
    tool.colour = [1, 0, 0];
    tool.alpha = '0.5';
    expect(tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    const m = b.object('Crate')!.material;
    expect(m.colors.diffuse).toEqual([1, 0, 0]);
    expect(m.values.transparency).toBe(50);
    tool.colour = [0, 0, 1];
    tool.use(ToolButton.Secondary, b.hit('Crate'), b.ctx);
    expect(tool.colour).toEqual([1, 0, 0]);
    expect(tool.alpha).toBe('0.5');
    tool.use(ToolButton.Reload, b.hit('Crate'), b.ctx);
    expect(b.object('Crate')!.material.colors.diffuse).toEqual(first.colors.diffuse);
    expect(b.object('Crate')!.material.values.transparency).toBe(first.values.transparency);
    expect(b.edits.labels).toEqual(['Colour Crate', 'Colour Crate']);
  });
});

describe('Resize', () => {
  it('grows a step, its weight with its volume, along one axis when asked; R gives the size back', async () => {
    const heavy = withBody(crate(), { physical: true, mass: 10 });
    const b = await bench(stage([ground(), heavy]));
    const tool = new Resize();
    tool.step = 2;
    expect(tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate')!.transform.size).toEqual([2, 2, 2]);
    expect(b.object('Crate')!.body?.mass).toBeCloseTo(80, 6);
    tool.axis = ResizeAxis.Y;
    tool.use(ToolButton.Secondary, b.hit('Crate'), b.ctx);
    expect(b.object('Crate')!.transform.size).toEqual([2, 1, 2]);
    tool.use(ToolButton.Reload, b.hit('Crate'), b.ctx);
    expect(b.object('Crate')!.transform.size).toEqual([1, 1, 1]);
    expect(b.edits.labels).toEqual(['Resize Crate', 'Resize Crate', 'Resize Crate']);
  });

  it('a prop keeps its place in play; an object the scene holds still grows up from its bottom in the scene', async () => {
    const prop = { ...withBody(at('cube', [4, 1, 0], [1, 1, 1], 4), { physical: true }), name: 'Prop' };
    const b = await bench(stage([ground(), crate(), prop]));
    const tool = new Resize();
    tool.step = 2;
    tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx);
    expect(worldBox(b.object('Crate')!).min[1]).toBeCloseTo(0, 6);
    tool.use(ToolButton.Primary, b.hit('Prop'), b.ctx);
    expect(b.object('Prop')!.transform.position).toEqual([4, 1, 0]);
    const shown = b.sim.frame(1).scene.objects.find((o) => o.name === 'Prop')!;
    expect(worldBox(shown).min[1]).toBeGreaterThan(-0.01);
  });

  it('Set gives an exact scale of the first size, ratio locked or not; Mouse 2 copies the object\'s scale', async () => {
    const b = await bench(stage([ground(), crate()]));
    const tool = new Resize();
    tool.mode = ResizeMode.Set;
    const scaleX = tool.settings.find((s) => s.label === 'Scale X')!;
    if (scaleX.kind !== SettingKind.Slider) throw new Error('slider expected');
    scaleX.set(2);
    expect(tool.scale).toEqual([2, 2, 2]);
    tool.lockRatio = false;
    tool.scale = [3, 1, 0.5];
    expect(tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate')!.transform.size).toEqual([3, 1, 0.5]);
    tool.scale = [1, 1, 1];
    tool.use(ToolButton.Secondary, b.hit('Crate'), b.ctx);
    expect(tool.scale).toEqual([3, 1, 0.5]);
  });

  it('leaves the map alone', async () => {
    const b = await bench(stage([ground(), crate()]));
    expect(new Resize().use(ToolButton.Primary, b.hit('Ground Plane'), b.ctx)).toBe(false);
    expect(b.edits.labels).toEqual([]);
  });
});

describe('Remover', () => {
  it('Mouse 1 removes the object, Mouse 2 the whole body it is part of, Z brings them back', async () => {
    const g = asGroupId('board');
    const a = { ...at('cube', [3, 1, 0], [1, 1, 1], 5), name: 'Left', groupId: g };
    const c = { ...at('cube', [5, 1, 0], [1, 1, 1], 6), name: 'Right', groupId: g };
    const b = await bench(stage([ground(), crate(), a, c], [{ id: g, name: 'Board', parentId: null, collapsed: true, body: { solid: true, physical: true } }]));
    const tool = new Remover();
    expect(tool.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate')).toBeUndefined();
    expect(tool.use(ToolButton.Secondary, b.hit('Left'), b.ctx)).toBe(true);
    expect(b.object('Right')).toBeUndefined();
    expect(tool.use(ToolButton.Primary, b.hit('Ground Plane'), b.ctx)).toBe(false);
    expect(b.edits.undo()).toBe('Remove Left');
    expect(b.edits.undo()).toBe('Remove Crate');
    expect(b.world.scene.objects.map((o) => o.name)).toEqual(['Ground Plane', 'Crate', 'Left', 'Right']);
  });
});

describe('a carved object', () => {
  /** A cup: a cube carved by a sphere, with a decal on it, one body as the player sees it. */
  async function cup() {
    const g = asGroupId('cup');
    const body = { ...at('cube', [0, 1, 0], [1, 1, 1], 7), name: 'Cup', groupId: g };
    const hollow = { ...at('sphere', [0, 1.8, 0], [0.8, 0.8, 0.8], 8), name: 'Hollow', groupId: g, boolean: BooleanMode.Negative };
    const decal = { ...at('cube', [1, 1, 0], [0.01, 0.2, 0.2], 9), name: 'Dot', groupId: g, boolean: BooleanMode.Positive };
    const b = await bench(stage([ground(), body, hollow, decal], [{ id: g, name: 'Cup', parentId: null, collapsed: true }]));
    const parts = () => new Set(b.world.scene.objects.filter((o) => o.groupId === g).map((o) => o.id));
    const ctx: ToolContext = { ...b.ctx, whole: () => parts(), decalsOn: () => new Set([b.object('Dot')!.id]), carved: () => true };
    return { ...b, ctx };
  }

  it('Colour and Material change it whole but the decal; a repeat changes nothing and makes no step', async () => {
    const b = await cup();
    const colour = new Colour();
    colour.colour = [1, 0, 0];
    expect(colour.use(ToolButton.Primary, b.hit('Hollow'), b.ctx)).toBe(true);
    expect(['Cup', 'Hollow'].map((n) => b.object(n)!.material.colors.diffuse)).toEqual([[1, 0, 0], [1, 0, 0]]);
    expect(b.object('Dot')!.material.colors.diffuse).not.toEqual([1, 0, 0]);
    expect(colour.use(ToolButton.Primary, b.hit('Cup'), b.ctx)).toBe(false);
    const material = new MaterialTool();
    expect(material.use(ToolButton.Primary, b.hit('Cup'), b.ctx)).toBe(true);
    expect(['Cup', 'Hollow', 'Dot'].map((n) => b.object(n)!.material.name)).toEqual(['Chrome', 'Chrome', expect.not.stringMatching('Chrome')]);
    expect(material.use(ToolButton.Primary, b.hit('Cup'), b.ctx)).toBe(false);
    expect(b.edits.labels).toEqual(['Material Cup', 'Colour Cup']);
  });

  it('Resize grows every part, decal too, by one factor about the part hit; R brings the first size back', async () => {
    const b = await cup();
    const tool = new Resize();
    expect(tool.use(ToolButton.Primary, b.hit('Cup'), b.ctx)).toBe(true);
    expect(b.object('Cup')!.transform.size).toEqual([1.25, 1.25, 1.25]);
    expect(b.object('Hollow')!.transform.size[0]).toBeCloseTo(1);
    expect(b.object('Dot')!.transform.position[0]).toBeCloseTo(1.25);
    expect(b.object('Hollow')!.transform.position[1] - b.object('Cup')!.transform.position[1]).toBeCloseTo(1);
    expect(tool.use(ToolButton.Reload, b.hit('Hollow'), b.ctx)).toBe(true);
    expect(b.object('Cup')!.transform.size[0]).toBeCloseTo(1);
    expect(b.object('Hollow')!.transform.size[0]).toBeCloseTo(0.8);
    expect(b.object('Dot')!.transform.position[0]).toBeCloseTo(1);
  });
});

describe('the Tool Gun', () => {
  it('fires once a press: a tool that acted shows the shot where it hit, a miss shows nothing', async () => {
    const b = await bench(stage([ground(), crate()]));
    let target: ToolHit | null = b.hit('Crate');
    const gun = new ToolGun(createTools(), { trace: () => target, context: () => b.ctx });
    gun.select(new Remover().id);
    const ctx = { eye: b.sim.driver.eye(), aim: [0, 0, -1], time: 2 } as unknown as WeaponContext;
    const press = (held: Button[], pressed: Button[]) => gun.step({ held: new Set(held), pressed: new Set(pressed), reach: 0 }, ctx);
    press([Button.Attack], [Button.Attack]);
    expect(gun.view().shot?.time).toBe(2);
    expect(b.object('Crate')).toBeUndefined();
    target = null;
    press([Button.Reload], [Button.Reload]);
    expect(gun.firedAt).toBe(2);
  });
});
