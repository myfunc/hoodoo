import { NoticeKind } from './sandbox.enums';

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly kind: NoticeKind;
  /** Milliseconds (performance.now) when it came, and how long it stays. */
  readonly at: number;
  readonly life: number;
}

/** The last part of a notice fades; this many show at once. */
const NOTICE = { fadeMs: 600, max: 5 } as const;
/** How long each kind stays, as the sandbox gamemode adds them (undo 2 s, unfreeze 3 s, a limit 6 s, a hint 20 s). */
const LIFE_MS: Readonly<Record<NoticeKind, number>> = {
  [NoticeKind.Info]: 3000,
  [NoticeKind.Undo]: 2000,
  [NoticeKind.Spawn]: 3000,
  [NoticeKind.Limit]: 6000,
  [NoticeKind.Hint]: 20000,
};

/** Garry's Mod's notices at the bottom right: newest last, each going after its kind's time. */
export class Notices {
  private list: Notice[] = [];
  private next = 1;

  push(text: string, kind: NoticeKind, now: number): void {
    this.list.push({ id: this.next++, text, kind, at: now, life: LIFE_MS[kind] });
    if (this.list.length > NOTICE.max) this.list.shift();
  }

  /** The notices still showing, each with its opacity (1, fading to 0 at the end). */
  visible(now: number): { notice: Notice; opacity: number }[] {
    this.list = this.list.filter((n) => now - n.at < n.life);
    return this.list.map((notice) => ({ notice, opacity: Math.min(1, (notice.life - (now - notice.at)) / NOTICE.fadeMs) }));
  }
}
