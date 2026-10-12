/**
 * The Hoodoo cloud API (worker/, docs/cloud.md): routes, limits and the shapes
 * both sides read. The browser (io/cloud/cloud-api.ts) and the Worker import
 * this one file, so a limit changes in one place. Plain data: no DOM, no Worker types.
 */

export const API_ROOT = '/api';

const KB = 1024;
const MB = KB * KB;

export const CLOUD_LIMITS = {
  /** A scene travels gzipped; real scenes with terrains pack to a few hundred KB. */
  sceneBytes: 5 * MB,
  thumbBytes: 500 * KB,
  /** Project names and gallery titles. */
  nameChars: 80,
  reportChars: 200,
  projectsPerUser: 200,
  pageSize: 24,
  /** The deepest page a gallery list serves. */
  maxPage: 100,
} as const;

/** The form fields of an upload (multipart). */
export const FORM = { name: 'name', scene: 'scene', thumb: 'thumb' } as const;
export const SCENE_MIME = 'application/gzip';
export const THUMB_MIME = 'image/jpeg';

/** The sign-in window tells the editor over this channel (same origin, any window). */
export const SIGNIN_CHANNEL = 'hoodoo-cloud';
export const SIGNED_IN = 'signed-in';
/** The human check frame posts this to the editor when Turnstile passed. */
export const HUMAN_PASSED = 'hoodoo-human-passed';

export enum GallerySort {
  New = 'new',
  Top = 'top',
}

export enum ModFilter {
  Reported = 'reported',
  Hidden = 'hidden',
}

export enum ReportReason {
  Spam = 'spam',
  Offensive = 'offensive',
  Broken = 'broken',
  Other = 'other',
}

export enum CloudErrorCode {
  /** Not signed in, or the session ended. */
  SignIn = 'sign-in',
  /** The anti-bot check (Turnstile) is due: pass it and retry. */
  Human = 'human',
  TooMany = 'too-many',
  TooLarge = 'too-large',
  NotFound = 'not-found',
  Forbidden = 'forbidden',
  Invalid = 'invalid',
  /** The server lacks a setting (Google client ID, storage, Turnstile secret). */
  NotConfigured = 'not-configured',
  Server = 'server',
}

export interface CloudErrorBody {
  readonly error: CloudErrorCode;
  readonly message: string;
}

/** GET /api/config: what this server can do. */
export interface CloudConfig {
  readonly googleClientId: string | null;
  readonly turnstileSiteKey: string | null;
  readonly devLogin: boolean;
}

export interface CloudUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly moderator: boolean;
}

/** A private cloud save of the user's own. */
export interface CloudProject {
  readonly id: string;
  readonly name: string;
  /** Bytes of the packed scene. */
  readonly size: number;
  readonly updatedAt: number;
  /** URL of the picture, or null. */
  readonly thumb: string | null;
}

export type Vote = -1 | 0 | 1;

export interface ReportNote {
  readonly reason: ReportReason;
  readonly note: string;
  readonly at: number;
}

/** A post in the public gallery. */
export interface GalleryPost {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly createdAt: number;
  readonly likes: number;
  readonly dislikes: number;
  readonly myVote: Vote;
  readonly mine: boolean;
  /** Hidden by a moderator: seen only by its author and moderators. */
  readonly hidden: boolean;
  readonly thumb: string | null;
  /** Moderators only. */
  readonly reports?: number;
  readonly reportNotes?: readonly ReportNote[];
}

export interface PostPage {
  readonly posts: readonly GalleryPost[];
  readonly more: boolean;
}

export const REPORT_REASONS: readonly ReportReason[] = Object.values(ReportReason);
export const isReportReason = (v: unknown): v is ReportReason => REPORT_REASONS.includes(v as ReportReason);
export const isVote = (v: unknown): v is Vote => v === -1 || v === 0 || v === 1;
export const isGallerySort = (v: unknown): v is GallerySort => v === GallerySort.New || v === GallerySort.Top;
export const isModFilter = (v: unknown): v is ModFilter => v === ModFilter.Reported || v === ModFilter.Hidden;

/** A name or title as stored: one line, trimmed, at most `nameChars`. Empty means refused. */
export const cleanName = (text: string): string => text.replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, CLOUD_LIMITS.nameChars);
