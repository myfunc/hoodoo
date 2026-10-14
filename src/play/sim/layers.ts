/** Collision layers, as bits: a body is in one and collides with a set (`collidesWith`); Rapier's collision groups. */
export enum Layer {
  World = 1,
  Prop = 2,
  Player = 4,
  /** Collides with the world only (dropped parts, "collide with world only"). */
  Debris = 8,
  /** The ground's sheet under its half-space: props stand on it; no query sees it. */
  Floor = 16,
}
