import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../objects.factory';
import {
  FollowStep, ToolId, attributesTarget, floatSpot, followStep, isDocked, materialTargets, reopened, terrainTarget, toolPlacesFrom, withDocked, withOpen, withSpot,
} from '../tool-places';

const make = (entry: string) => createObject(createEntry(entry), { seed: 1 });
const PAGE = { width: 1440, height: 900 };
const WIN = { width: 400, height: 300 };
const MENU = 22;

describe('tool window places', () => {
  it('read back what was stored, dropping unknown windows and broken entries', () => {
    expect(toolPlacesFrom(undefined)).toEqual({});
    expect(toolPlacesFrom([{ docked: true }])).toEqual({});
    expect(toolPlacesFrom({
      [ToolId.Attributes]: { docked: true },
      [ToolId.Materials]: { docked: false, x: 120.4, y: 80 },
      [ToolId.Terrain]: { docked: 'yes' },
      palette: { docked: true },
    })).toEqual({ [ToolId.Attributes]: { docked: true }, [ToolId.Materials]: { docked: false, x: 120, y: 80 } });
    expect(toolPlacesFrom({ [ToolId.Materials]: { docked: false, x: Number.NaN, y: 3 } })).toEqual({ [ToolId.Materials]: { docked: false } });
  });

  it('remember each window on its own: docking keeps where it floated, so floating again goes back there', () => {
    let places = withSpot({}, ToolId.Attributes, 300, 200);
    places = withDocked(places, ToolId.Materials, true);
    places = withDocked(places, ToolId.Attributes, true);
    expect(isDocked(places, ToolId.Attributes)).toBe(true);
    expect(isDocked(places, ToolId.Materials)).toBe(true);
    expect(isDocked(places, ToolId.Terrain)).toBe(false);
    places = withDocked(places, ToolId.Attributes, false);
    expect(places[ToolId.Attributes]).toEqual({ docked: false, x: 300, y: 200 });
    expect(toolPlacesFrom(JSON.parse(JSON.stringify(places)))).toEqual(places);
  });

  it('open centred the first time, where they were left after that, and always on the page', () => {
    expect(floatSpot(undefined, WIN, PAGE, MENU)).toEqual({ x: 520, y: 300 });
    expect(floatSpot({ docked: false, x: 40, y: 60 }, WIN, PAGE, MENU)).toEqual({ x: 40, y: 60 });
    expect(floatSpot({ docked: false, x: 1400, y: -50 }, WIN, PAGE, MENU)).toEqual({ x: 1040, y: MENU });
    expect(floatSpot({ docked: false, x: 10, y: 10 }, { width: 2000, height: 1200 }, PAGE, MENU)).toEqual({ x: 0, y: MENU });
  });
});

describe('following the selection', () => {
  it('pick what each window works on', () => {
    const ball = make('sphere');
    const lamp = make('spot');
    const land = make('terrain');
    expect(attributesTarget([])).toBeNull();
    expect(attributesTarget([lamp, ball])).toBe(lamp);
    expect(materialTargets([lamp, ball, land])).toEqual([ball, land]);
    expect(terrainTarget([ball, land])).toBe(land);
    expect(terrainTarget([ball, lamp])).toBeNull();
  });

  it('rebuild for another object, refresh in place when the same one changed, else stay', () => {
    const ball = make('sphere');
    const moved = { ...ball, transform: { ...ball.transform, position: [1, 2, 3] as const } };
    expect(followStep(null, ball)).toBe(FollowStep.Show);
    expect(followStep(ball, make('sphere'))).toBe(FollowStep.Show);
    expect(followStep(ball, null)).toBe(FollowStep.Show);
    expect(followStep(ball, moved)).toBe(FollowStep.Refresh);
    expect(followStep(ball, ball)).toBe(FollowStep.Stay);
    expect(followStep(null, null)).toBe(FollowStep.Stay);
  });
});

describe('windows that come back', () => {
  it('reopen at start only the docked windows that were open', () => {
    const order = [ToolId.Attributes, ToolId.Materials, ToolId.Terrain];
    let places = withDocked({}, ToolId.Attributes, true);
    places = withOpen(places, ToolId.Attributes, true);
    places = withOpen(places, ToolId.Materials, true);
    places = withOpen(withDocked(places, ToolId.Terrain, true), ToolId.Terrain, false);
    expect(reopened(places, order)).toEqual([ToolId.Attributes]);
    expect(reopened(toolPlacesFrom(JSON.parse(JSON.stringify(places))), order)).toEqual([ToolId.Attributes]);
    expect(withOpen(places, ToolId.Attributes, true)).toBe(places);
    expect(withSpot(places, ToolId.Attributes, 5, 6)[ToolId.Attributes]).toEqual({ docked: false, open: true, x: 5, y: 6 });
  });
});
