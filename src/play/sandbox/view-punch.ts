/**
 * READ ME — Source's ViewPunch for Sandbox's guns: a shot knocks the view (and
 * the aim with it, as in Half-Life 2) up and aside by some degrees, and the
 * knock comes back by itself (CBasePlayer::DecayPunchAngle: it shrinks by 10°
 * a second plus half its size a second). The player's own turning in between
 * stays; only the knock is taken back.
 */

/** DecayPunchAngle: degrees a second, and the share of the knock a second. */
const DECAY = { linear: 10, share: 0.5 } as const;

/** The player's view, degrees: pitch up, yaw left. */
export interface Aimed {
  pitch: number;
  yaw: number;
}

export class ViewPunch {
  private pitch = 0;
  private yaw = 0;

  /** A knock: `pitch` degrees up, `yaw` degrees right. */
  kick(view: Aimed, pitch: number, yaw: number): void {
    this.move(view, pitch, yaw);
  }

  /** One fixed step of the knock coming back. */
  step(view: Aimed, dt: number): void {
    const size = Math.hypot(this.pitch, this.yaw);
    if (!size) return;
    const left = Math.max(0, size - (DECAY.linear + size * DECAY.share) * dt);
    const k = left / size;
    this.move(view, this.pitch * k - this.pitch, this.yaw * k - this.yaw);
  }

  private move(view: Aimed, pitch: number, yaw: number): void {
    this.pitch += pitch;
    this.yaw += yaw;
    view.pitch += pitch;
    view.yaw -= yaw;
  }
}
