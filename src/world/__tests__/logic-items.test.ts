import { describe, expect, it } from 'vitest';
import { BehaviourKind, ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import { asObjectId } from '../../model/scene.ids';
import { linkPortalIds, portalRows, unlinkPortal, zoneRows, zoneSummary } from '../logic-items';
import { createTriggerZone, newBehaviour } from '../play/scripts';
import { createPortalPair, portalPartners, unlinkPortals } from '../portals';
import { emptyScene } from '../scene.defaults';
import { World } from '../world';

const RULE = { who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Forward };

describe('Portals & Triggers list', () => {
  it('lists a linked pair once and a portal that leads nowhere on its own', () => {
    const [a, b] = createPortalPair([0, 0, 0], 0);
    const [c, d] = createPortalPair([4, 0, 0], 0, 2);
    const lone = { ...c, pair: undefined };
    const zone = createTriggerZone([0, 0, 0]);
    const rows = portalRows([a, zone, b, lone, { ...d, pair: undefined }]);
    expect(rows.map((r) => [r.a.id, r.b?.id ?? null])).toEqual([[a.id, b.id], [c.id, null], [d.id, null]]);
    expect(zoneRows([a, zone, b]).map((o) => o.id)).toEqual([zone.id]);
  });

  it('says what a zone does in one line', () => {
    const zone = createTriggerZone([0, 0, 0]);
    expect(zoneSummary(zone)).toBe('no rules');
    const busy = { ...zone, zone: { rules: [RULE, RULE] }, script: { behaviours: [newBehaviour(BehaviourKind.Spin)] } };
    expect(zoneSummary(busy)).toBe('2 rules · Spin');
  });

  it('unlinks a pair both ways and links two portals, one undo step each', () => {
    const [a, b] = createPortalPair([0, 0, 0], 0);
    const [c] = createPortalPair([4, 0, 0], 0, 2);
    const unlinked = unlinkPortals([a, b], a.id);
    expect(portalPartners(unlinked).size).toBe(0);
    expect(unlinkPortals([a, b], asObjectId('other'))).toEqual([a, b]);

    const world = new World({ ...emptyScene(), objects: [a, b, { ...c, pair: undefined }] });
    unlinkPortal(world, b.id);
    expect(portalPartners(world.scene.objects).size).toBe(0);
    linkPortalIds(world, a.id, c.id);
    expect(portalPartners(world.scene.objects).get(a.id)).toBe(c.id);
    world.undo();
    world.undo();
    expect(portalPartners(world.scene.objects).get(a.id)).toBe(b.id);
  });
});
