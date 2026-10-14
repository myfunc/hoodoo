import type { ObjectId } from '../model/scene.ids';
import type { Scene, Transform } from '../model/scene.types';
import type { World } from '../world/world';

/**
 * READ ME — one scene in two windows (PJuly-r6hz5.35): the editor in one, the
 * game in a window of its own (Play's "Open in window"). The windows talk over
 * a BroadcastChannel named after the link. Each History step in either window
 * (an edit, Z, Y) sends the scene; the other takes it as a step of its own,
 * keeping its own camera, views and document size. While the game moves props,
 * it sends where they are a few times a second and the editor shows them there
 * without a History step, until the game's next step puts them in the scene.
 */

const CHANNEL = 'hoodoo-peer-';
/** The game window's address: this page with the link's id. */
export const PEER_PARAM = 'peer';
/** Where props are sent at most this often, milliseconds. */
export const POSE_EVERY_MS = 100;
const ID_RADIX = 36;
const ID_CHARS = 8;

enum Say {
  /** The game window is up and wants the scene. */
  Hello = 'hello',
  Scene = 'scene',
  Poses = 'poses',
  Bye = 'bye',
}

type Message =
  | { readonly say: Say.Hello }
  | { readonly say: Say.Scene; readonly scene: Scene; readonly label: string }
  | { readonly say: Say.Poses; readonly poses: readonly (readonly [ObjectId, Transform])[] }
  | { readonly say: Say.Bye };

/** What a window keeps of its own when the other's scene comes in. */
const OWN = ['camera', 'views', 'document', 'bookmarks'] as const;
/** What the windows share: a step that changes none of these (the camera, a view) is not sent. */
const SHARED = ['objects', 'groups', 'smartGroups', 'joints', 'sky', 'animation', 'rig', 'render'] as const;

export class PeerLink {
  private readonly channel: BroadcastChannel;
  /** The scene this window last sent or took: a step that shares nothing new is not sent again. */
  private last: Scene;
  private taking = false;
  private readonly off: (() => void)[] = [];
  /** Called when the other window says it is gone. */
  closed: (() => void) | null = null;
  /** The game window waits for the editor's first scene. */
  private firstScene: (() => void) | null = null;

  private constructor(readonly id: string, private readonly world: World) {
    this.channel = new BroadcastChannel(CHANNEL + id);
    this.last = world.scene;
    this.channel.onmessage = (e: MessageEvent<Message>) => this.heard(e.data);
    this.off.push(world.events.on('history', () => this.stepped()));
    const bye = () => this.say({ say: Say.Bye });
    window.addEventListener('pagehide', bye);
    this.off.push(() => window.removeEventListener('pagehide', bye));
  }

  /** The editor's side: a new link and the game window's address. */
  static host(world: World): { link: PeerLink; url: string } {
    const id = Math.random().toString(ID_RADIX).slice(2, 2 + ID_CHARS);
    const url = new URL(location.href);
    url.searchParams.set(PEER_PARAM, id);
    url.hash = '';
    return { link: new PeerLink(id, world), url: url.href };
  }

  /** The game window's side: joins the link and resolves with the editor's scene, or null when none answers. */
  static guest(world: World, id: string, waitMs: number): Promise<PeerLink | null> {
    const link = new PeerLink(id, world);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      link.firstScene = () => {
        clearTimeout(timer);
        resolve(link);
      };
      link.say({ say: Say.Hello });
    });
  }

  /** Where the game's moving props are now (the game window, while it plays). */
  sendPoses(poses: readonly (readonly [ObjectId, Transform])[]): void {
    if (poses.length) this.say({ say: Say.Poses, poses });
  }

  close(): void {
    this.say({ say: Say.Bye });
    for (const f of this.off) f();
    this.channel.close();
  }

  private say(m: Message): void {
    this.channel.postMessage(m);
  }

  /** A History step here: the scene goes to the other window when it shares something new. */
  private stepped(): void {
    if (this.taking) return;
    const scene = this.world.scene;
    if (SHARED.every((k) => scene[k] === this.last[k])) return;
    this.last = scene;
    const { labels, position } = this.world.historyState();
    this.say({ say: Say.Scene, scene, label: labels[position] ?? 'Edit' });
  }

  private heard(m: Message): void {
    if (m.say === Say.Hello) this.say({ say: Say.Scene, scene: this.world.scene, label: 'Game window' });
    else if (m.say === Say.Scene) this.take(m.scene, m.label);
    else if (m.say === Say.Poses) {
      const at = new Map(m.poses);
      this.world.previewObjects(new Set(at.keys()), (o) => ({ ...o, transform: at.get(o.id) ?? o.transform }));
    }
    else {
      this.world.endPreview();
      this.closed?.();
    }
  }

  /** The other window's scene as a step here, with this window's own camera, views and document. */
  private take(scene: Scene, label: string): void {
    this.world.endPreview();
    const own = this.world.scene;
    const merged = { ...scene, ...Object.fromEntries(OWN.map((k) => [k, own[k]])) } as Scene;
    this.taking = true;
    try {
      this.world.replaceScene(merged, label);
    } finally {
      this.taking = false;
    }
    this.last = this.world.scene;
    this.firstScene?.();
    this.firstScene = null;
  }
}
