import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';

export enum ChangeKind {
  Objects = 'objects',
  Sky = 'sky',
  Camera = 'camera',
  Document = 'document',
  Views = 'views',
  All = 'all',
}

export interface WorldEvents {
  changed: { readonly scene: Scene; readonly kind: ChangeKind };
  selection: { readonly ids: ReadonlySet<ObjectId> };
  history: { readonly labels: readonly string[]; readonly position: number };
  /** An edit was not applied because the scene would exceed its limits. */
  refused: { readonly reason: string };
}
