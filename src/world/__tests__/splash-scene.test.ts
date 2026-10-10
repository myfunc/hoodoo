import { describe, expect, it } from 'vitest';
import { deserializeScene, serializeScene } from '../scene.serialize';
import {
  DAY_HOURS, SPLASH_DOCUMENT, SPLASH_FPS, SPLASH_SECONDS, SplashClip, SplashKind, splashBase, splashFrame, splashFramePlan, splashKindAt, splashScene,
} from '../splash-scene';

const KINDS = Object.values(SplashKind);
const CLIPS = Object.values(SplashClip);
/** Every time a clip renders, blend partners included, in frame order. */
const times = (kind: SplashKind, clip: SplashClip): number[] =>
  splashFramePlan(kind, clip).flatMap((f) => (f.blend ? [f.t, f.blend.t] : [f.t]));

describe('splash scenes', () => {
  it.each(KINDS)('%s survives a file round-trip, so it opens like any saved scene', (kind) => {
    const scene = splashScene(kind);
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    expect(back.document).toEqual(SPLASH_DOCUMENT);
  });

  it.each(KINDS)('%s: the sun never crosses the horizon, which would flash the light from sun to moon', (kind) => {
    for (const clip of CLIPS) {
      const base = splashBase(kind);
      const signs = new Set(times(kind, clip).map((t) => Math.sign(splashFrame(base, kind, clip, t).sky.sunAltitude)));
      expect(signs.size, `${kind} ${clip}`).toBe(1);
      expect(signs.has(0)).toBe(false);
    }
  });

  it.each(KINDS)('%s: no frame-to-frame jump in light or fog', (kind) => {
    for (const clip of CLIPS) {
      const base = splashBase(kind);
      const skies = splashFramePlan(kind, clip).map((f) => splashFrame(base, kind, clip, f.t).sky);
      for (let i = 1; i < skies.length; i++) {
        expect(Math.abs(skies[i].sunAltitude - skies[i - 1].sunAltitude)).toBeLessThan(1);
        expect(Math.abs(skies[i].fogAmount - skies[i - 1].fogAmount)).toBeLessThan(2);
        expect(Math.abs(skies[i].horizonColor[0] - skies[i - 1].horizonColor[0])).toBeLessThan(0.05);
      }
    }
  });

  it.each(KINDS)('%s: the welcome ends on the picture the loop starts from', (kind) => {
    const base = splashBase(kind);
    const end = splashFrame(base, kind, SplashClip.Intro, 1);
    const start = splashFrame(base, kind, SplashClip.Loop, 0);
    expect(end.sky).toEqual(start.sky);
    expect(end.camera).toEqual(start.camera);
    expect(end.objects.map((o) => o.transform)).toEqual(start.objects.map((o) => o.transform));
  });

  it.each(KINDS)('%s: the frame plans start and end on the still', (kind) => {
    const intro = splashFramePlan(kind, SplashClip.Intro);
    const loop = splashFramePlan(kind, SplashClip.Loop);
    expect(intro).toHaveLength(SPLASH_SECONDS[SplashClip.Intro] * SPLASH_FPS);
    expect(intro.at(-1)).toEqual({ t: 1 });
    expect(loop[0]).toEqual({ t: 0 });
    expect(loop).toHaveLength(SPLASH_SECONDS[SplashClip.Loop] * SPLASH_FPS);
  });

  it('the arch loop fades its last frames toward the time just before its first', () => {
    const loop = splashFramePlan(SplashKind.Arch, SplashClip.Loop);
    const last = loop.at(-1)!;
    expect(last.blend?.t).toBeCloseTo(-1 / loop.length, 9);
    expect(last.blend!.weight).toBe(1);
    const weights = loop.filter((f) => f.blend).map((f) => f.blend!.weight);
    weights.slice(1).forEach((w, i) => expect(w).toBeGreaterThan(weights[i]));
  });

  it('the dunes loop closes on itself', () => {
    const base = splashBase(SplashKind.Dunes);
    const a = splashFrame(base, SplashKind.Dunes, SplashClip.Loop, 0);
    const b = splashFrame(base, SplashKind.Dunes, SplashClip.Loop, 1);
    expect(b.sky.sunAltitude).toBeCloseTo(a.sky.sunAltitude, 6);
    expect(b.sky.fogAmount).toBeCloseTo(a.sky.fogAmount, 6);
    b.objects.forEach((o, i) => o.transform.position.forEach((v, j) => expect(v).toBeCloseTo(a.objects[i].transform.position[j], 6)));
  });

  it('shows the dunes by day and the arch in the evening and at night', () => {
    expect(splashKindAt(DAY_HOURS.from)).toBe(SplashKind.Dunes);
    expect(splashKindAt(11)).toBe(SplashKind.Dunes);
    expect(splashKindAt(DAY_HOURS.to - 1)).toBe(SplashKind.Dunes);
    expect(splashKindAt(DAY_HOURS.to)).toBe(SplashKind.Arch);
    expect(splashKindAt(21)).toBe(SplashKind.Arch);
    expect(splashKindAt(2)).toBe(SplashKind.Arch);
  });
});
