import { describe, expect, it } from 'vitest';
import { parseMdl } from '../mdl';
import { sequenceBlends } from '../mdl.types';

function fixture(version = 48): Uint8Array {
  const bytes = new Uint8Array(2304), view = new DataView(bytes.buffer);
  const int = (at: number, value: number) => view.setInt32(at, value, true);
  const float = (at: number, value: number) => view.setFloat32(at, value, true);
  const text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  text(0, 'IDST'); int(4, version); int(8, 99); text(12, 'test.mdl'); int(76, bytes.length);
  int(156, 1); int(160, 408); int(408, 216); int(412, -1); text(624, 'root');
  float(440, 2); float(464, 1); float(480, 0.1); float(492, 0.2);
  for (const at of [504, 524, 544]) float(at, 1);
  int(568, 123);
  int(240, 1); int(244, 640); int(640, 92); text(732, 'muzzle');
  for (const at of [652, 672, 692]) float(at, 1); float(664, 5);
  int(204, 1); int(208, 752); int(752, 64); text(816, 'Gun');
  int(212, 2); int(216, 840); int(840, 848); int(844, 888);
  text(848, 'Models\\Weapons\\One\\'); text(888, 'models/weapons/two/');
  int(220, 2); int(224, 2); int(228, 928);
  [0, 1, 1, 0].forEach((value, i) => view.setUint16(928 + i * 2, value, true));
  int(300, 1); int(304, 944); int(944, 20); float(952, -30); float(956, 30); float(960, 360); text(964, 'aim');
  int(336, 1); int(340, 976); int(980, 8); text(984, 'weapons/include.mdl');
  int(180, 1); int(184, 1024); int(1028, 100); float(1032, 24); int(1040, 11); text(1124, '@idle');
  int(188, 1); int(192, 1152); int(1156, 212); int(1160, 220); int(1164, 1);
  text(1364, 'idle'); text(1372, 'ACT_VM_IDLE'); int(1176, 1); int(1180, 260);
  int(1212, 240); int(1220, 2); int(1224, 1); int(1228, 0); int(1232, -1);
  float(1236, -15); float(1244, 15);
  float(1412, 0.5); int(1416, 500); text(1424, 'effect');
  int(232, 1); int(236, 1504); int(1508, 1); int(1512, 999); int(1516, 16);
  int(1592, 1); int(1596, 148); int(1600, 3); int(1604, 96);
  int(1668, 1); int(1676, 3); int(1680, 4);
  return bytes;
}

describe('MDL structures', () => {
  it.each([44, 48, 49])('reads version %i relative strings, bones and attachments', version => {
    const model = parseMdl(fixture(version));
    expect(model.name).toBe('test.mdl'); expect(model.checksum).toBe(99);
    expect(model.bones[0]).toMatchObject({ name: 'root', parent: -1, position: [2, 0, 0], quat: [0, 0, 0, 1], flags: 123 });
    expect(model.bones[0].positionScale[0]).toBeCloseTo(0.1);
    expect(model.attachments[0].name).toBe('muzzle'); expect(model.attachments[0].local[3]).toBe(5);
    expect(model.bodyParts[0][0].vertexOffset).toBe(2);
    expect(model.bodyParts[0][0].meshes[0]).toEqual({ material: 1, vertices: 3, vertexOffset: 4 });
  });

  it('reads directory search order, skins, pose ranges, events and include names', () => {
    const model = parseMdl(fixture());
    expect(model.textures[0]).toEqual({ name: 'gun', candidates: ['materials/models/weapons/one/gun.vmt', 'materials/models/weapons/two/gun.vmt'] });
    expect(model.skins).toEqual([[0, 1], [1, 0]]);
    expect(model.poseParameters).toEqual([{ name: 'aim', start: -30, end: 30, loop: 360 }]);
    expect(model.includes).toEqual(['weapons/include.mdl']);
    const sequence = model.sequences[0];
    expect(sequence).toMatchObject({ name: 'idle', activity: 'ACT_VM_IDLE', fps: 24, frames: 11, looping: true, animations: [0, 0], blendSize: [2, 1], blendParams: [0, -1] });
    expect(sequence.events).toEqual([{ frame: 5, event: 500, options: 'effect' }]);
    expect(sequenceBlends.get(sequence)).toEqual({ start: [-15, 0], end: [15, 0] });
  });

  it('rejects signatures, unsupported versions and truncated tables', () => {
    const bytes = fixture(); bytes[0] = 0;
    expect(() => parseMdl(bytes)).toThrow('signature');
    expect(() => parseMdl(fixture(50))).toThrow('version');
    const broken = fixture(); new DataView(broken.buffer).setInt32(156, 1000, true);
    expect(() => parseMdl(broken)).toThrow('range');
    expect(() => parseMdl(new Uint8Array(10))).toThrow('range');
  });
});
