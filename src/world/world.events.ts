import type { ObjectId } from '../model/scene.ids';
import type { Scene } from '../model/scene.types';
import type { EditScope } from './edit-scope';

export enum ChangeKind {
  Objects = 'objects',
  Sky = 'sky',
  Camera = 'camera',
  Document = 'document',
  Views = 'views',
  /** The playhead moved or the timeline changed: animated objects, camera and sky may all differ. */
  Time = 'time',
  All = 'all',
}

export interface WorldEvents {
  changed: { readonly scene: Scene; readonly kind: ChangeKind };
  selection: { readonly ids: ReadonlySet<ObjectId> };
  history: { readonly labels: readonly string[]; readonly position: number };
  /** Edit Group started, moved to another group or ended (world.scope). */
  scope: { readonly scope: EditScope | null };
  /** An edit was not applied because the scene would exceed its limits. */
  refused: { readonly reason: string };
}
