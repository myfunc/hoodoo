import type { ObjectId } from '../model/scene.ids';
import type { Transform } from '../model/scene.types';
import type { UiContext } from '../ui/context';
import { PeerLink, POSE_EVERY_MS } from './peer-link';
import { Motion } from './sim/physics';
import type { PlayFrame, PlaySim } from './sim/play-sim';

/**
 * READ ME — the game in a window of its own (Play › Open in window): this window
 * goes back to the editor and opens the game's window on the same scene
 * (peer-link.ts). The game's window starts straight in Play, filling the window
 * without the editor around it, and sends where its props move.
 */

/** How long the game's window waits for the editor's scene before it starts on its own, milliseconds. */
const JOIN_WAIT_MS = 5000;
const GAME_CLASS = 'is-game-window';
/** Moves smaller than this (world units) are not sent. */
const STILL = 1e-4;

let hosted: PeerLink | null = null;
let guest: PeerLink | null = null;
let lastPoses = 0;
const sent = new Map<ObjectId, Transform>();

/** This window is the game's window. */
export const isGameWindow = (): boolean => guest !== null;

/** Opens the game's window on this scene (the editor's side). */
export function openGameWindow(ctx: UiContext): void {
  hosted?.close();
  const { link, url } = PeerLink.host(ctx.world);
  hosted = link;
  link.closed = () => {
    link.close();
    if (hosted === link) hosted = null;
  };
  if (!window.open(url, '_blank')) ctx.toast('The browser blocked the new window: allow pop-ups for this site');
}

/** The game's window: joins the editor's scene and calls `play` to start; false when no editor answered. */
export async function joinGameWindow(ctx: UiContext, id: string, play: () => void): Promise<boolean> {
  const link = await PeerLink.guest(ctx.world, id, JOIN_WAIT_MS);
  if (!link) {
    ctx.toast('The editor that opened this window is gone: this is a window of its own');
    return false;
  }
  guest = link;
  link.closed = () => ctx.toast('The editor window closed: changes here stay in this window');
  document.body.classList.add(GAME_CLASS);
  play();
  return true;
}

/** Each frame of play in the game's window: where its moving props are, a few times a second. */
export function sendPoses(sim: PlaySim, frame: PlayFrame, now: number): void {
  if (!guest || now - lastPoses < POSE_EVERY_MS) return;
  lastPoses = now;
  const moving = new Set<ObjectId>();
  for (const item of sim.bodies.items.values()) if (item.motion === Motion.Dynamic) for (const m of item.members) moving.add(m.id);
  const poses: [ObjectId, Transform][] = [];
  for (const o of frame.scene.objects) {
    if (!moving.has(o.id)) continue;
    const before = sent.get(o.id);
    if (before && samePlace(before, o.transform)) continue;
    sent.set(o.id, o.transform);
    poses.push([o.id, o.transform]);
  }
  guest.sendPoses(poses);
}

const samePlace = (a: Transform, b: Transform): boolean =>
  a.position.every((v, i) => Math.abs(v - b.position[i]) < STILL) && a.rotation.every((v, i) => Math.abs(v - b.rotation[i]) < STILL);
