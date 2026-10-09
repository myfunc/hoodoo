/** Linear undo history of immutable snapshots; one entry per finished user action. */
export interface HistoryEntry<S> {
  readonly label: string;
  readonly state: S;
}

export class History<S> {
  private entries: HistoryEntry<S>[];
  private index = 0;

  constructor(initial: S, label: string, private readonly limit: number) {
    this.entries = [{ label, state: initial }];
  }

  get current(): S {
    return this.entries[this.index].state;
  }

  get position(): number {
    return this.index;
  }

  get labels(): readonly string[] {
    return this.entries.map((e) => e.label);
  }

  push(label: string, state: S): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ label, state });
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  /** Replaces the newest entry in place; drags use it so one gesture is one undo step. */
  amend(state: S): void {
    this.entries[this.index] = { label: this.entries[this.index].label, state };
  }

  reset(label: string, state: S): void {
    this.entries = [{ label, state }];
    this.index = 0;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  jump(to: number): S {
    this.index = Math.min(this.entries.length - 1, Math.max(0, to));
    return this.current;
  }
}
