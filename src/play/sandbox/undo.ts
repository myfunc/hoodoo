/** One step Z takes back: what the notice calls it and how to undo it. */
export interface UndoEntry {
  readonly label: string;
  undo(): void;
}

/** Garry's Mod keeps a long list; this many steps are plenty for one session. */
const UNDO_LIMIT = 200;

/**
 * Sandbox's own undo list for the session (spawns, joints, removals…), apart
 * from the editor's history, which play never touches.
 */
export class UndoStack {
  private readonly entries: UndoEntry[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  push(entry: UndoEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Takes back the newest step; its label, or null when there is nothing to undo. */
  undo(): string | null {
    const e = this.entries.pop();
    if (!e) return null;
    e.undo();
    return e.label;
  }

  /** Labels, newest first (the context menu's list). */
  get labels(): readonly string[] {
    return this.entries.map((e) => e.label).reverse();
  }

  get size(): number {
    return this.entries.length;
  }
}
