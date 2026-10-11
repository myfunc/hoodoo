import { showOffer } from '../ui/panels/offer-toast';
import type { EditorStore } from '../world/editor-store';
import { createPortalPair, hasPortals, isPortal, linkPortals, nextPairOrdinal } from '../world/portals';
import { Feature, isFeatureOn, withFeature } from '../world/preview-features';
import { ChangeKind } from '../world/world.events';
import type { World } from '../world/world';
import { dropPoint } from './scene-ops';

/** The preview feature Portals (world/portals.ts): its commands and its offer. */

const OFFER = 'This scene has portals, a preview feature';
const TURN_ON = 'Turn on Portals';

/** A linked pair under the point the camera looks at, facing the camera. */
export function createPortals(world: World): void {
  const [x, z] = dropPoint(world.scene.camera);
  const pair = createPortalPair([x, 0, z], world.scene.camera.yaw, nextPairOrdinal(world.scene.objects));
  world.addObjects(pair, 'Create Portal Pair');
}

/** Exactly two portals are selected. */
export function canLinkPortals(world: World): boolean {
  const sel = world.selectedObjects();
  return sel.length === 2 && sel.every(isPortal);
}

/** Links the two selected portals to each other; portals that led to them now lead nowhere. */
export function linkSelectedPortals(world: World): void {
  const sel = world.selectedObjects();
  if (!canLinkPortals(world)) return;
  const next = new Map(linkPortals(world.scene.objects, sel[0].id, sel[1].id).map((o) => [o.id, o]));
  const changed = new Set(world.scene.objects.filter((o) => next.get(o.id) !== o).map((o) => o.id));
  world.updateObjects(changed, 'Link Portals', (o) => next.get(o.id) ?? o, true);
}

/**
 * A scene with portals that arrives while the feature is off keeps them (they
 * are drawn as they are) and offers, once per arrival, to switch the feature on;
 * nothing switches on by itself.
 */
export function offerPortals(world: World, editor: EditorStore): void {
  const offer = () => {
    if (isFeatureOn(editor.state.features, Feature.Portals) || !hasPortals(world.scene.objects)) return;
    showOffer(OFFER, TURN_ON, () => editor.update({ features: withFeature(editor.state.features, Feature.Portals, true) }));
  };
  let had = hasPortals(world.scene.objects);
  world.events.on('changed', ({ scene, kind }) => {
    const has = hasPortals(scene.objects);
    if (kind === ChangeKind.All && has && !had) offer();
    had = has;
  });
  offer();
}
