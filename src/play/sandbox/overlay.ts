import type { Vec3 } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import { type Frame, WireProjector } from '../../render/wire/wireframe';
import { cameraBasis } from '../../world/camera-math';
import type { PlayFrame, PlaySim } from '../sim/play-sim';
import { HaloPainter, type Rgb, silhouettes } from './halo';
import { DEFAULT_WEAPON_COLOR, type WeaponView } from './weapons/weapon';

/**
 * The beam colours and sizes until the owner's chosen look replaces them: Garry's Mod's blue,
 * a soft glow, a fine white core, and the held object's outline in the beam's colour.
 */
const BEAM = {
  glow: 'rgba(80, 200, 255, 0.22)',
  body: '#6fd8ff',
  core: '#ffffff',
  widths: [12, 4, 1.5],
  blur: [18, 10, 0],
  /** Sideways wobble along the beam, pixels and waves. */
  wobble: 1.6,
  waves: 14,
  segments: 60,
} as const;
/**
 * Garry's Mod's halos (gamemodes/sandbox cl_init.lua, effects phys_freeze/phys_unfreeze):
 * the held prop glows in the weapon colour, jittered by up to 0.3 a channel and 1–2 pixels
 * wide every frame; freezing flashes green, unfreezing red, fading over 0.3 s.
 */
const HALO = { jitter: 0.3, sizes: [1, 2], pxPerSize: 1.5, flashSeconds: 0.3 } as const;
const FROZEN: Rgb = [0, 1, 0];
const UNFROZEN: Rgb = [1, 0, 0];
/** Where the beam leaves the picture: the bottom edge, right of centre (no gun drawn yet). */
const MUZZLE = { x: 0.78, y: 1.02 } as const;
/** Points this close to the eye or behind it are not drawn. */
const NEAR = 0.05;

type Pt = readonly [number, number];

/**
 * READ ME — Sandbox's 2D layer over the picture: the Physics Gun's beam from
 * the bottom of the picture to what it holds (bending toward the crosshair when
 * the body lags), the held object's halo and the green or red flash when a
 * prop is frozen or unfrozen. It projects with the play frame's camera, as the wires do.
 */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly halos = new HaloPainter();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sandbox-overlay';
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  /** `beam` false when the hands layer draws Garry's Mod's own beam. */
  draw(frame: PlayFrame, picture: Frame | null, view: WeaponView, sim: PlaySim, beam = true): void {
    const { canvas, g } = this;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!picture) return;
    const proj = new WireProjector(cameraBasis(frame.camera, picture.w / picture.h), picture);
    const objects = (body: number): SceneObject[] => {
      const ids = new Set(sim.bodies.items.get(body)?.members.map((m) => m.id) ?? []);
      return frame.scene.objects.filter((o) => ids.has(o.id));
    };
    if (view.held) {
      const jitter = (c: number) => c + (Math.random() * 2 - 1) * HALO.jitter;
      const size = HALO.sizes[Math.floor(Math.random() * HALO.sizes.length)];
      this.halos.paint(g, silhouettes(proj, objects(view.held.body)), DEFAULT_WEAPON_COLOR.map(jitter) as unknown as Rgb, 1, size * HALO.pxPerSize);
    }
    const age = view.flash ? sim.time - view.flash.time : Infinity;
    if (view.flash && age < HALO.flashSeconds) {
      const fade = 1 - Math.sqrt(age / HALO.flashSeconds);
      this.halos.paint(g, silhouettes(proj, objects(view.flash.body)), view.flash.frozen ? FROZEN : UNFROZEN, fade, HALO.sizes[0] * HALO.pxPerSize);
    }
    if (beam && view.firing && view.end) this.beam(proj, picture, view);
  }

  private beam(proj: WireProjector, picture: Frame, view: WeaponView): void {
    const end = this.screen(proj, view.end as Vec3);
    if (!end) return;
    const from: Pt = [picture.x + picture.w * MUZZLE.x, picture.y + picture.h * MUZZLE.y];
    const centre: Pt = [picture.x + picture.w / 2, picture.y + picture.h / 2];
    // The beam heads for the crosshair first, then bends to the grabbed point.
    const via: Pt = view.held ? centre : [(from[0] + end[0]) / 2, (from[1] + end[1]) / 2];
    const pts: Pt[] = [];
    for (let i = 0; i <= BEAM.segments; i++) {
      const t = i / BEAM.segments;
      const u = 1 - t;
      const p: Pt = [u * u * from[0] + 2 * u * t * via[0] + t * t * end[0], u * u * from[1] + 2 * u * t * via[1] + t * t * end[1]];
      const [dx, dy] = [end[0] - from[0], end[1] - from[1]];
      const l = Math.hypot(dx, dy) || 1;
      const wobble = Math.sin(t * BEAM.waves + performance.now() / BEAM.segments) * BEAM.wobble * Math.sin(t * Math.PI);
      pts.push([p[0] - (dy / l) * wobble, p[1] + (dx / l) * wobble]);
    }
    const g = this.g;
    [BEAM.glow, BEAM.body, BEAM.core].forEach((color, i) => {
      g.save();
      g.strokeStyle = color;
      g.lineWidth = BEAM.widths[i];
      g.lineCap = 'round';
      g.shadowColor = color;
      g.shadowBlur = BEAM.blur[i];
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
      g.restore();
    });
    g.fillStyle = BEAM.core;
    g.beginPath();
    g.arc(end[0], end[1], BEAM.widths[1] / 2 + 1, 0, Math.PI * 2);
    g.fill();
  }

  private screen(proj: WireProjector, p: Vec3): Pt | null {
    const v = proj.view(p);
    return v[2] > NEAR ? proj.screen(v) : null;
  }
}

