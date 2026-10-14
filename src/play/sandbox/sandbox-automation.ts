import type { Button } from '../sim/actor';

/** What scripted checks may drive (window.__hoodooSandbox): they cannot lock the pointer or click for real. */
export interface SandboxAutomation {
  readonly state: () => { weapon: string; holding: string | null; undo: readonly string[]; notices: readonly string[] };
  /** The game's sounds played lately and the mix's level now (null without game files). */
  readonly heard: () => { recent: readonly string[]; level: number } | null;
  /** Holds or lets go of a button as if the mouse or R did. */
  readonly button: (b: Button, down: boolean) => void;
  readonly key: (code: string) => void;
  /** Wheel steps (+ toward the player). */
  readonly wheel: (steps: number) => void;
  /** Turns the player to look this way (degrees). */
  readonly aim: (yaw: number, pitch: number) => void;
  /** Spawns a menu item where the player aims, as a click on its icon does; false when refused. */
  readonly spawn: (key: string) => boolean;
  /** Puts a tool in the Tool Gun and takes the gun out, as a click in the Tools column does. */
  readonly tool: (id: string) => void;
  /** The object the Tool Gun's aim meets now, by id, or null. */
  readonly aimed: () => string | null;
  /** Mouse motion as E-turning or looking. */
  readonly look: (dx: number, dy: number) => void;
  readonly hold: (code: string, down: boolean) => void;
}
