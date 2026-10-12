import { describe, expect, it } from 'vitest';
import { GAME_ITEMS, GAME_ROWS, GameItemKind, Side } from '../../assets/games.library';
import { LAST_BALL, ballColor, ballName, isStripe, poolBallMaterial } from '../../assets/games.materials';
import { latheProfile } from '../../assets/lathe.profiles';
import { MATERIAL_LIBRARY, presetMaterial } from '../../assets/materials.presets';
import { hexToRgb } from '../../core/color';
import { LatheProfile, ShapeKind, TextureKind } from '../../model/scene.enums';
import { buildGameItem } from '../game-sets';
import { latheT } from '../lathe-ray';
import { landed } from '../transform-ops';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { emptyScene } from '../scene.defaults';

const item = (name: string) => GAME_ITEMS.find((g) => g.name === name)!;

describe('billiard balls', () => {
  it('colour solids 1-8 the standard way and stripe 9-15 in the colours of 1-7', () => {
    expect(ballColor(1)).toEqual(hexToRgb('#f2bd0f'));
    expect(ballColor(8)).toEqual(hexToRgb('#0d0d0f'));
    for (let n = 9; n <= LAST_BALL; n++) {
      expect(ballColor(n)).toEqual(ballColor(n - 8));
      expect(isStripe(n)).toBe(true);
    }
    expect(isStripe(8)).toBe(false);
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ballColor(n).join())).size).toBe(8);
  });

  it('carry their number as the Pool Ball texture seed; the cue ball is plain', () => {
    for (let n = 1; n <= LAST_BALL; n++) {
      const t = poolBallMaterial(n).textures[0]!;
      expect(t.kind).toBe(TextureKind.PoolBall);
      expect(t.seed).toBe(n);
      expect(t.colors[0]).toEqual(ballColor(n));
    }
    expect(poolBallMaterial(0).textures).toEqual([null, null, null]);
    expect(ballName(0)).toBe('Cue Ball');
    expect(ballName(12)).toBe('12 Ball');
  });

  it('rack fifteen balls in a triangle, the 8 in the middle, and the cue ball in front', () => {
    const { objects, groups } = buildGameItem(item('Pool Rack'), 0, 0);
    expect(objects).toHaveLength(16);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Pool Rack');
    expect(new Set(objects.map((o) => o.name)).size).toBe(16);
    for (const o of objects) {
      expect(o.kind).toBe(ShapeKind.Sphere);
      expect(o.groupId).toBe(groups[0].id);
      expect(o.transform.position[1]).toBe(1);
    }
    const at = (name: string) => objects.find((o) => o.name === name)!.transform.position;
    const rows = [...new Set(objects.slice(0, 15).map((o) => o.transform.position[2].toFixed(3)))];
    expect(rows).toHaveLength(5);
    expect(at('8 Ball')[0]).toBeCloseTo(0);
    expect(at('8 Ball')[2]).toBeCloseTo(0);
    expect(at('Cue Ball')[2]).toBeGreaterThan(at('1 Ball')[2]);
    // No two balls overlap.
    for (const a of objects) for (const b of objects) {
      if (a !== b) expect(Math.hypot(a.transform.position[0] - b.transform.position[0], a.transform.position[2] - b.transform.position[2])).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('chess', () => {
  it('sets up the opening position on the board as one group', () => {
    const { objects, groups } = buildGameItem(item('Chess Set'), 0, 0);
    expect(objects).toHaveLength(34);
    expect(groups.map((g) => g.name)).toEqual(['Chess Set']);
    const pieces = objects.filter((o) => o.kind === ShapeKind.Lathe);
    expect(pieces).toHaveLength(32);
    const count = (side: string, p: LatheProfile) => pieces.filter((o) => o.name.startsWith(side) && o.shapeParam === p).length;
    for (const side of [Side.White, Side.Black]) {
      expect(count(side, LatheProfile.Pawn)).toBe(8);
      expect(count(side, LatheProfile.King)).toBe(1);
      expect(count(side, LatheProfile.Queen)).toBe(1);
      for (const p of [LatheProfile.Rook, LatheProfile.Knight, LatheProfile.Bishop]) expect(count(side, p)).toBe(2);
    }
    const pos = (name: string) => objects.find((o) => o.name === name)!.transform.position;
    // White at +Z, the a-file at -X; the queen on her colour (d1), the king beside her.
    expect(pos('White King e1')[2]).toBeGreaterThan(0);
    expect(pos('Black King e8')[2]).toBeLessThan(0);
    expect(pos('White Queen d1')[0]).toBeLessThan(pos('White King e1')[0]);
    expect(pos('White Rook a1')[0]).toBeLessThan(pos('White Rook h1')[0]);
    // Every piece stands on the squares.
    const top = objects.find((o) => o.name === 'Board Squares')!.transform.position[1];
    for (const o of pieces) expect(o.transform.position[1] - o.transform.size[1]).toBeCloseTo(top);
  });

  it('builds single pieces in boxwood and ebony at the set scale', () => {
    const white = buildGameItem(item('White Knight'), 3, -2).objects[0];
    const black = buildGameItem(item('Black Knight'), 0, 0).objects[0];
    expect(white.material).toEqual(presetMaterial('Boxwood'));
    expect(black.material).toEqual(presetMaterial('Ebony'));
    expect(white.transform.position[0]).toBe(3);
    expect(white.transform.rotation[1]).toBe(-black.transform.rotation[1]);
    expect(white.transform.size[1]).toBeCloseTo(latheProfile(LatheProfile.Knight).halfSize[1] * (2 / 57.15));
  });

  it('lists every piece of both sides, the board, the set, the rack and sixteen balls', () => {
    const of = (k: GameItemKind) => GAME_ITEMS.filter((g) => g.kind === k);
    expect(of(GameItemKind.Piece)).toHaveLength(12);
    expect(of(GameItemKind.Ball).map((g) => g.ball)).toEqual([0, ...Array.from({ length: 15 }, (_, i) => i + 1)]);
    expect(of(GameItemKind.ChessSet)).toHaveLength(1);
    expect(of(GameItemKind.Board)).toHaveLength(1);
    expect(of(GameItemKind.Rack)).toHaveLength(1);
    expect(GAME_ROWS.map((r) => r.length)).toEqual([4, 6, 6, 8, 7]);
    expect(MATERIAL_LIBRARY.find((c) => c.name === 'Chess & Billiards')!.materials.length).toBeLessThanOrEqual(7);
  });
});

describe('lathe objects', () => {
  it('are hit by picking rays on their outline, the cross and the knight head', () => {
    const pawn = latheProfile(LatheProfile.Pawn);
    // From the side at mid-height of the foot: the foot's radius is the widest, the aspect.
    const t = latheT(pawn, [-3, -0.95, 0], [1, 0, 0]);
    expect(3 - t).toBeGreaterThan(0.9);
    expect(latheT(pawn, [-3, 1.5, 0], [1, 0, 0])).toBe(Infinity);
    const king = latheProfile(LatheProfile.King);
    const cross = king.blocks[0];
    expect(latheT(king, [0, cross.center[1], 3], [0, 0, -1])).toBeLessThan(3);
    const knight = latheProfile(LatheProfile.Knight);
    expect(latheT(knight, [0.2 / knight.aspect, 0.4, 3], [0, 0, -1])).toBeLessThan(3);
    expect(latheT(knight, [0.6, 0.95, 3], [0, 0, -1])).toBe(Infinity);
  });

  it('survive a save and a load; an unknown profile becomes the nearest', () => {
    const { objects, groups } = buildGameItem(item('Chess Set'), 0, 0);
    const balls = buildGameItem(item('Pool Rack'), 20, 0);
    const scene = { ...emptyScene(), objects: [...objects, ...balls.objects], groups: [...groups, ...balls.groups] };
    const file = JSON.parse(JSON.stringify(serializeScene(scene)));
    const back = deserializeScene(file);
    expect(back.objects.map((o) => [o.name, o.kind, o.shapeParam])).toEqual(scene.objects.map((o) => [o.name, o.kind, o.shapeParam]));
    expect(back.objects.find((o) => o.name === '9 Ball')!.material.textures[0]!.kind).toBe(TextureKind.PoolBall);
    expect(back.groups!.map((g) => g.name).sort()).toEqual(['Chess Set', 'Pool Rack']);
    file.scene.objects[2].shapeParam = 42;
    file.scene.objects[3].shapeParam = 'king';
    const odd = deserializeScene(file);
    expect(odd.objects[2].shapeParam).toBe(LatheProfile.Pedestal);
    expect(odd.objects[3].shapeParam).toBe(LatheProfile.Pawn);
  });

  it('land on the board, and a ball lands on a piece', () => {
    const { objects } = buildGameItem(item('Chess Set'), 0, 0);
    const scene = { ...emptyScene(), objects };
    const pawn = objects.find((o) => o.name === 'White Pawn e2')!;
    const raised = { ...pawn, transform: { ...pawn.transform, position: [pawn.transform.position[0], 9, pawn.transform.position[2]] as [number, number, number] } };
    expect(landed({ ...scene, objects: objects.map((o) => (o.id === pawn.id ? raised : o)) }, raised).transform.position[1]).toBeCloseTo(pawn.transform.position[1]);
    // Balls come turned (their numbers face different ways): Land still rests the ball itself.
    const ball = buildGameItem(item('9 Ball'), pawn.transform.position[0], pawn.transform.position[2]).objects[0];
    expect(ball.transform.rotation).not.toEqual([0, 0, 0]);
    const top = pawn.transform.position[1] + pawn.transform.size[1];
    expect(landed({ ...scene, objects: [...objects, ball] }, ball).transform.position[1]).toBeCloseTo(top + 1, 1);
  });
});
