import { Bus } from '../core/bus';
import type { Scene } from '../model/scene.types';

/** A picture of the scene window together with the scene that produced it. */
export interface Snapshot {
  readonly id: number;
  readonly image: HTMLCanvasElement;
  readonly scene: Scene;
  readonly time: string;
}

export interface SnapshotEvents {
  changed: { readonly list: readonly Snapshot[] };
  compare: { readonly snapshot: Snapshot | null };
}

/** Pictures are full scene-window size; a few keep memory modest. */
const MAX_SNAPSHOTS = 8;
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

/**
 * Modern: render snapshots for this session (not saved with the scene). Each keeps
 * its scene, so a snapshot can be compared with the live picture or restored.
 */
export class SnapshotStore {
  readonly events = new Bus<SnapshotEvents>();
  private items: Snapshot[] = [];
  private nextId = 1;
  private comparing: Snapshot | null = null;

  get list(): readonly Snapshot[] {
    return this.items;
  }

  get compared(): Snapshot | null {
    return this.comparing;
  }

  get latest(): Snapshot | null {
    return this.items[this.items.length - 1] ?? null;
  }

  add(image: HTMLCanvasElement, scene: Scene): Snapshot {
    const snap: Snapshot = { id: this.nextId++, image, scene, time: new Date().toLocaleTimeString(undefined, TIME_FORMAT) };
    this.items = [...this.items, snap];
    while (this.items.length > MAX_SNAPSHOTS) this.drop(this.items[0].id);
    this.events.emit('changed', { list: this.items });
    return snap;
  }

  remove(id: number): void {
    this.drop(id);
    this.events.emit('changed', { list: this.items });
  }

  compare(snap: Snapshot | null): void {
    if (snap === this.comparing) return;
    this.comparing = snap;
    this.events.emit('compare', { snapshot: snap });
  }

  private drop(id: number): void {
    this.items = this.items.filter((s) => s.id !== id);
    if (this.comparing?.id === id) this.compare(null);
  }
}
