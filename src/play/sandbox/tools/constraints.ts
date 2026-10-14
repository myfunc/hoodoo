import { JointKind } from '../../../model/scene.enums';
import type { SceneJoint } from '../../../model/scene.types';
import { SettingKind } from '../../../ui/sandbox/tool-menu';
import { type PairClick, PairTool } from './pair-tool';
import { ToolCategory, ToolId } from './tool';

/**
 * Garry's Mod's Constraints tools on the two clicks of PairTool: Weld glues the
 * two where they are, Ball Socket pivots the first about the second click, and
 * No-Collide lets them pass through each other.
 */

enum OnOff {
  On = 'on',
  Off = 'off',
}
const ON_OFF = [{ value: OnOff.On, label: 'On' }, { value: OnOff.Off, label: 'Off' }];

export class Weld extends PairTool {
  /** Garry's Mod's "No-Collide" box: the welded pair stop touching each other. */
  noCollide = OnOff.On;
  override readonly settings = [{
    kind: SettingKind.Segments, label: 'No-collide', items: ON_OFF,
    get: () => this.noCollide, set: (v: string) => { this.noCollide = v as OnOff; },
  } as const];

  constructor() {
    super({
      id: ToolId.Weld, name: 'Weld', category: ToolCategory.Constraints, about: 'Weld objects together', kind: JointKind.Weld,
      first: 'Pick the first object', second: 'Weld it to the second',
    });
  }

  protected joint({ a, b, hit, ctx }: PairClick): SceneJoint | null {
    // Both anchors at the second click: the weld holds the pair as they stand now.
    const [anchorA, anchorB] = [ctx.anchor(a, hit.point), ctx.anchor(b, hit.point)];
    return anchorA && anchorB ? this.make(a, b, anchorA, anchorB, this.noCollide === OnOff.Off ? { collide: true } : {}) : null;
  }
}

export class BallSocket extends PairTool {
  constructor() {
    super({
      id: ToolId.BallSocket, name: 'Ball Socket', category: ToolCategory.Constraints, about: 'Join objects at a pivot they turn about', kind: JointKind.BallSocket,
      first: 'Pick the object that turns', second: 'Pivot it at this point',
    });
  }

  protected joint({ a, b, hit, ctx }: PairClick): SceneJoint | null {
    const [anchorA, anchorB] = [ctx.anchor(a, hit.point), ctx.anchor(b, hit.point)];
    return anchorA && anchorB ? this.make(a, b, anchorA, anchorB) : null;
  }
}

export class NoCollide extends PairTool {
  constructor() {
    super({
      id: ToolId.NoCollide, name: 'No-Collide', category: ToolCategory.Constraints, about: 'Let two objects pass through each other', kind: JointKind.NoCollide,
      first: 'Pick the first object', second: 'It passes through this one',
    });
  }

  protected joint({ a, b, firstAnchor, hit, ctx }: PairClick): SceneJoint | null {
    const anchorB = ctx.anchor(b, hit.point);
    return anchorB ? this.make(a, b, firstAnchor, anchorB) : null;
  }
}
