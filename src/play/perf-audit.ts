import type { Vec3 } from '../core/vec3';
import { downloadBlob } from '../io/download';
import { Button } from '../ui/kit/controls';
import { el } from '../ui/kit/dom';
import { APP_VERSION } from '../ui/strings';
import { Motion } from './sim/physics';
import type { PlaySim } from './sim/play-sim';

/**
 * READ ME — Play's slowdown auditor: it keeps the last few seconds of frames
 * (how long each took, how long the simulation's steps took, how many bodies
 * moved and touched) and, when one frame or one frame's steps take far too
 * long, keeps a snapshot of those seconds with the scene's bodies, so a hitch
 * can be studied afterwards. The last snapshots stay in this browser; the Play
 * panel's Perf log saves them as a file. Paused play, a hidden tab and the first
 * seconds (loading, compiling) are not judged.
 */

export interface PerfSample {
  /** Milliseconds since play began. */
  readonly t: number;
  /** Since the frame before. */
  readonly frameMs: number;
  /** The simulation's steps in this frame, and how long they took together. */
  readonly steps: number;
  readonly simMs: number;
  readonly bodies: number;
  readonly moving: number;
  readonly contacts: number;
  /** The live picture's scale (1: full size) and the game's frames a second. */
  readonly scale: number;
  readonly fps: number;
}

export interface PerfSnapshot {
  readonly at: string;
  readonly version: string;
  readonly reason: string;
  readonly screen: readonly [number, number, number];
  readonly objects: number;
  readonly samples: readonly PerfSample[];
  /** The moving bodies at that moment: what they are, where, how fast. */
  readonly bodies: readonly { readonly tag: string; readonly position: Vec3; readonly speed: number }[];
}

const KEY = 'hoodoo.perf.v1';
const KEEP = 10;
const HISTORY_MS = 3000;
/** A frame this long, or its steps this long, is a slowdown. */
const SLOW = { frameMs: 50, simMs: 8 } as const;
/** Loading and the first pictures are not judged; one snapshot per this long at most. */
const QUIET = { startMs: 2000, betweenMs: 5000 } as const;
const MAX_BODIES = 40;
const DIGITS = 100;
/** The file name's time: 2026-10-13T20-15-00. */
const STAMP_CHARS = 19;

export class PerfAudit {
  private samples: PerfSample[] = [];
  private contacts = 0;
  private readonly started = performance.now();
  private lastSnap = -Infinity;
  private lastFrame = 0;
  private readonly off: () => void;
  private line: HTMLElement | null = null;

  /** `storage`: where snapshots are kept (the browser's local storage; a stand-in in tests). */
  constructor(private readonly sim: PlaySim, private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
    this.off = sim.events.on('contact', () => { this.contacts++; });
  }

  /** The Play panel's Perf log: how many slow moments are kept, Save and Clear. */
  section(): HTMLElement {
    this.line = el('div', { cls: 'play-perf-line' });
    const save = new Button({ label: 'Save…', title: 'Save the kept slow moments as a file to send', onClick: () => this.save() });
    const clear = new Button({ label: 'Clear', title: 'Forget the kept slow moments', onClick: () => { this.store([]); this.show(); } });
    this.show();
    return el('div', { cls: 'play-perf' }, [el('div', { cls: 'play-panel-title', text: 'Perf log' }), this.line, el('div', { cls: 'play-actions' }, [save.el, clear.el])]);
  }

  /** One display frame: `steps` simulation steps took `simMs`; `paused` frames only reset the clock. */
  frame(now: number, steps: number, simMs: number, paused: boolean, scale: number, fps: number): void {
    const frameMs = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (paused || (typeof document !== 'undefined' && document.hidden)) {
      this.samples = [];
      return;
    }
    let moving = 0;
    for (const item of this.sim.bodies.items.values()) if (item.motion === Motion.Dynamic) moving++;
    const sample: PerfSample = {
      t: round(now - this.started), frameMs: round(frameMs), steps, simMs: round(simMs),
      bodies: this.sim.bodies.items.size, moving, contacts: this.contacts, scale: round(scale), fps,
    };
    this.contacts = 0;
    this.samples.push(sample);
    while (this.samples.length && now - this.started - this.samples[0].t > HISTORY_MS) this.samples.shift();
    const slow = frameMs > SLOW.frameMs ? `frame ${round(frameMs)} ms` : simMs > SLOW.simMs ? `simulation ${round(simMs)} ms` : null;
    if (slow && now - this.started > QUIET.startMs && now - this.lastSnap > QUIET.betweenMs) {
      this.lastSnap = now;
      this.snap(slow);
    }
  }

  dispose(): void {
    this.off();
  }

  /** The snapshots kept in this browser. */
  kept(): PerfSnapshot[] {
    try {
      const raw = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      return Array.isArray(raw) ? raw as PerfSnapshot[] : [];
    } catch {
      return [];
    }
  }

  private snap(reason: string): void {
    const physics = this.sim.physics;
    const bodies = [...this.sim.bodies.items.values()].filter((i) => i.motion === Motion.Dynamic).slice(0, MAX_BODIES).map((i) => {
      const p = physics.pose(i.body).position;
      return { tag: physics.tag(i.body) ?? '', position: p.map(round) as unknown as Vec3, speed: round(Math.hypot(...physics.velocity(i.body).linear)) };
    });
    const snapshot: PerfSnapshot = {
      at: new Date().toISOString(), version: APP_VERSION, reason,
      screen: typeof window === 'undefined' ? [0, 0, 1] : [innerWidth, innerHeight, devicePixelRatio], objects: this.sim.frame(1).scene.objects.length,
      samples: [...this.samples], bodies,
    };
    this.store([...this.kept(), snapshot].slice(-KEEP));
    this.show();
  }

  private show(): void {
    if (!this.line) return;
    const n = this.kept().length;
    this.line.textContent = n ? `${n} slow moment${n === 1 ? '' : 's'} kept` : 'No slow moments yet';
  }

  private store(list: readonly PerfSnapshot[]): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(list));
    } catch {
      // Storage full or off: the snapshots stay unsaved.
    }
  }

  private save(): void {
    const kept = this.kept();
    if (!kept.length) return;
    downloadBlob(new Blob([JSON.stringify(kept, null, 1)], { type: 'application/json' }), `hoodoo-perf-${new Date().toISOString().slice(0, STAMP_CHARS).replace(/:/g, '-')}.json`);
  }
}


const round = (v: number): number => Math.round(v * DIGITS) / DIGITS;
