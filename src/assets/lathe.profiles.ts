import { LatheProfile } from '../model/scene.enums';
import { CHESS_SPECS } from './chess.profiles';
import { type LatheProfileData, compileProfile } from './lathe';

/** Every Lathe profile, compiled once, indexed by LatheProfile (an object's `shapeParam`). */
export const LATHE_PROFILES: readonly LatheProfileData[] = CHESS_SPECS.map(compileProfile);

const LAST = LATHE_PROFILES.length - 1;

/** A profile index from any number: rounded and kept in range (files, links, old data). */
export const latheIndex = (param: number): LatheProfile =>
  Math.min(LAST, Math.max(0, Math.round(Number.isFinite(param) ? param : 0))) as LatheProfile;

export const latheProfile = (param: number): LatheProfileData => LATHE_PROFILES[latheIndex(param)];
