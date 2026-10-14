import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Scene, SceneObject } from '../../model/scene.types';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { World } from '../../world/world';
import { PeerLink } from '../peer-link';

const cube = (name: string, x: number, seed: number): SceneObject => ({ ...createObject(createEntry('cube'), { seed, position: [x, 1, 0] }), name });
const stage = (): Scene => ({ ...emptyScene(), objects: [cube('A', 0, 1), cube('B', 3, 2)] });
const settle = () => new Promise((r) => setTimeout(r, 30));
const names = (w: World) => w.scene.objects.map((o) => o.name).sort();

async function linked() {
  const editor = new World(stage());
  const game = new World(emptyScene());
  const { link } = PeerLink.host(editor, 'https://hoodoo.test/');
  const joined = await PeerLink.guest(game, link.id, 1000);
  return { editor, game, host: link, guest: joined! };
}

describe('one scene in two windows', () => {
  it('the game window gets the editor scene, and steps in either window show in the other', async () => {
    const { editor, game, host, guest } = await linked();
    expect(names(game)).toEqual(['A', 'B']);
    game.addObjects([cube('C', 6, 3)], 'Spawn C');
    await settle();
    expect(names(editor)).toEqual(['A', 'B', 'C']);
    editor.removeObjects(new Set([editor.scene.objects.find((o) => o.name === 'A')!.id]), 'Delete A');
    await settle();
    expect(names(game)).toEqual(['B', 'C']);
    editor.undo();
    await settle();
    expect(names(game)).toEqual(['A', 'B', 'C']);
    host.close();
    guest.close();
  });

  it('keeps each window its own camera, and a camera move is not sent', async () => {
    const { editor, game, host, guest } = await linked();
    const gameCamera = game.scene.camera;
    editor.setCamera({ ...editor.scene.camera, position: [9, 9, 9] }, 'Camera');
    await settle();
    expect(game.scene.camera).toBe(gameCamera);
    host.close();
    guest.close();
  });

  it('a step in the editor over the game props it previews does not bring back what it removed', async () => {
    const { editor, game, host, guest } = await linked();
    const b = game.scene.objects.find((o) => o.name === 'B')!;
    guest.sendPoses([[b.id, { ...b.transform, position: [3, 5, 0] }]]);
    await settle();
    expect(editor.scene.objects.find((o) => o.name === 'B')!.transform.position[1]).toBe(5);
    editor.removeObjects(new Set([editor.scene.objects.find((o) => o.name === 'A')!.id]), 'Delete A');
    await settle();
    guest.sendPoses([[b.id, { ...b.transform, position: [3, 4, 0] }]]);
    await settle();
    expect(names(editor)).toEqual(['B']);
    expect(names(game)).toEqual(['B']);
    host.close();
    guest.close();
  });
});
