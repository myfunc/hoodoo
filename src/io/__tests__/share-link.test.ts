import { describe, expect, it } from 'vitest';
import { demoScene } from '../../world/demo-scene';
import { sceneFromHash, shareUrl } from '../share-link';

describe('share links', () => {
  it('round-trip a scene through the URL hash', async () => {
    const scene = demoScene();
    const url = await shareUrl(scene, 'https://soft.myfunc.io/vfx/');
    const back = await sceneFromHash(new URL(url).hash);
    expect(back?.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    expect(back?.sky).toEqual(scene.sky);
  });

  it('ignores hashes without a scene', async () => {
    expect(await sceneFromHash('#nothing')).toBeNull();
  });

  it('rejects garbage instead of crashing silently', async () => {
    await expect(sceneFromHash('#scene=AAAA')).rejects.toBeTruthy();
  });
});
