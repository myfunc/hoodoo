import { transformPoint } from '../../core/mat4';
import type { Vec3 } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import { wireLines } from '../../render/wire/wire-shapes';
import { type Frame, WireProjector } from '../../render/wire/wireframe';
import { objectMatrix } from '../../world/bounds';
import { cameraBasis } from '../../world/camera-math';
import type { PlayFrame, PlaySim } from '../sim/play-sim';
import type { WeaponView } from './weapons/weapon';

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
/** A light wire over the held object: the object itself must stay in sight under it. */
const OUTLINE = { color: '#6fd8ff', width: 1, alpha: 0.35 } as const;
const FLASH = { color: '#dff6ff', width: 1.5, alpha: 0.9, seconds: 0.35 } as const;
/** Where the beam leaves the picture: the bottom edge, right of centre (no gun drawn yet). */
const MUZZLE = { x: 0.78, y: 1.02 } as const;
/** Points this close to the eye or behind it are not drawn. */
const NEAR = 0.05;

type Pt = readonly [number, number];

/**
 * READ ME — Sandbox's 2D layer over the picture: the Physics Gun's beam from
 * the bottom of the picture to what it holds (bending toward the crosshair when
 * the body lags), the held object's outline and a short flash when a prop is
 * frozen or let go. It projects with the play frame's camera, as the wires do.
 */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sandbox-overlay';
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  draw(frame: PlayFrame, picture: Frame | null, view: WeaponView, sim: PlaySim): void {
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
    if (view.held) this.outline(proj, objects(view.held.body), OUTLINE.color, OUTLINE.width, OUTLINE.alpha);
    const flash = view.flash && sim.time - view.flash.time < FLASH.seconds ? view.flash : null;
    if (flash) this.outline(proj, objects(flash.body), FLASH.color, FLASH.width, FLASH.alpha * (1 - (sim.time - flash.time) / FLASH.seconds));
    if (view.firing && view.end) this.beam(proj, picture, view);
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

  private outline(proj: WireProjector, objects: readonly SceneObject[], color: string, width: number, alpha: number): void {
    const g = this.g;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (const o of objects) {
      const m = objectMatrix(o);
      const lines = wireLines(o);
      for (let i = 0; i < lines.length; i += 2) {
        const s = proj.segment(proj.view(transformPoint(m, lines[i])), proj.view(transformPoint(m, lines[i + 1])));
        if (!s) continue;
        g.moveTo(s[0], s[1]);
        g.lineTo(s[2], s[3]);
      }
    }
    g.stroke();
    g.restore();
  }

  private screen(proj: WireProjector, p: Vec3): Pt | null {
    const v = proj.view(p);
    return v[2] > NEAR ? proj.screen(v) : null;
  }
}

