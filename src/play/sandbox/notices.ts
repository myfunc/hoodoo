import { NoticeKind } from './sandbox.enums';

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly kind: NoticeKind;
  /** Milliseconds (performance.now) when it came. */
  readonly at: number;
}

/** How long a notice stays, the last part of it fading, and how many show at once. */
const NOTICE = { showMs: 4000, fadeMs: 600, max: 5 } as const;

/** Garry's Mod's notices at the bottom right: newest last, each fading after a few seconds. */
export class Notices {
  private list: Notice[] = [];
  private next = 1;

  push(text: string, kind: NoticeKind, now: number): void {
    this.list.push({ id: this.next++, text, kind, at: now });
    if (this.list.length > NOTICE.max) this.list.shift();
  }

  /** The notices still showing, each with its opacity (1, fading to 0 at the end). */
  visible(now: number): { notice: Notice; opacity: number }[] {
    this.list = this.list.filter((n) => now - n.at < NOTICE.showMs);
    return this.list.map((notice) => ({ notice, opacity: Math.min(1, (NOTICE.showMs - (now - notice.at)) / NOTICE.fadeMs) }));
  }
}
