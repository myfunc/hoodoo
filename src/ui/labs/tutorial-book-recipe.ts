import { Action } from '../../input/actions';
import { ViewKind } from '../../model/scene.enums';
import type { Camera } from '../../model/scene.types';
import { PaletteTab } from '../../world/editor-store';
import { PictureMode } from '../../world/world.enums';
import type { UiContext } from '../context';

/** Where a recipe's Try it starts. */
export enum TutorialStart {
  /** File › New Scene. */
  Empty = 'empty',
  /** A new scene with the camera in close: one object fills the picture. */
  Close = 'close',
  /** File › Open Demo. */
  Demo = 'demo',
}

/** A marker on a step picture: a rectangle in fractions of the picture (0..1 from the top left). */
export interface TutorialMark {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TutorialStep {
  /** One line: what to click or drag. */
  readonly text: string;
  /** Where; several marks are done in order (5a, then 5b). */
  readonly marks: readonly TutorialMark[];
}

/** One page of the Tutorial Book: a goal, the steps with a picture each, and the picture it ends with. */
export interface TutorialRecipe {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly start: TutorialStart;
  readonly steps: readonly TutorialStep[];
  /** One line that says how to tell it worked. */
  readonly result: string;
}

/** The room a mark's number takes beside it, in fractions of a step picture shown in the floating window. */
const TAG_SIZE = { w: 0.04, h: 0.045 } as const;
/** A mark this many times wider than tall (a menu line, a field) carries its number at the side. */
const WIDE = 3;

/** Where a mark's number sits: outside the box, on a side with room, clear of the step's other marks. */
export enum TagSide {
  Above = 'above',
  Below = 'below',
  Left = 'left',
  Right = 'right',
}

const TAG_ORDER: Readonly<Record<'wide' | 'box', readonly TagSide[]>> = {
  wide: [TagSide.Left, TagSide.Right, TagSide.Above, TagSide.Below],
  box: [TagSide.Above, TagSide.Left, TagSide.Below, TagSide.Right],
};

/** The rectangle a number would take on `side` of mark `m`. */
function tagSpot(m: TutorialMark, side: TagSide): TutorialMark {
  const { w, h } = TAG_SIZE;
  if (side === TagSide.Above) return { x: m.x, y: m.y - h, w, h };
  if (side === TagSide.Below) return { x: m.x, y: m.y + m.h, w, h };
  if (side === TagSide.Left) return { x: m.x - w, y: m.y, w, h };
  return { x: m.x + m.w, y: m.y, w, h };
}

const overlaps = (a: TutorialMark, b: TutorialMark): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: TutorialMark): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1;

/** Where the number of mark `m` goes among the step's `others`; `aspect` is the picture's width / height. */
export function tagSide(m: TutorialMark, others: readonly TutorialMark[], aspect: number): TagSide {
  const order = TAG_ORDER[m.w * aspect > WIDE * m.h ? 'wide' : 'box'];
  return order.find((side) => {
    const spot = tagSpot(m, side);
    return inside(spot) && !others.some((o) => overlaps(spot, o));
  }) ?? order[0];
}

/** The pictures live in public/tutorials/<id>/ (tools/make-tutorials.mjs): one per step, then the result. */
export const stepPicture = (id: string, n: number): string => `tutorials/${id}/${n}.webp`;
export const resultPicture = (id: string): string => `tutorials/${id}/result.webp`;

/** In close, a little from the right and above: a cube or a ball at the centre fills a third of the picture. */
const CLOSE_CAMERA: Camera = { position: [2.6, 2.6, 5.8], yaw: 24, pitch: -14, bank: 0, fov: 52, focus: 6.4, aperture: 0 };

/** A fresh scene for step 1, and the editor as the pictures show it: Create tray, Camera view, Render View off. */
export function startRecipe(ctx: UiContext, start: TutorialStart): void {
  ctx.dispatch(start === TutorialStart.Demo ? Action.LoadDemo : Action.New);
  if (start === TutorialStart.Close) ctx.world.setCamera(CLOSE_CAMERA, 'Tutorial camera');
  const s = ctx.editor.state;
  ctx.editor.update({ tab: PaletteTab.Create, view: ViewKind.Camera, quad: false, maximized: false, ...(s.picture === PictureMode.Final ? { picture: PictureMode.Edit } : {}) });
}
