import type { Vec3 } from '../../core/vec3';
import { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import type { PlayScript, TriggerZone } from '../../model/play.types';
import type { Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { withBody } from '../body-flags';
import { createTriggerZone } from '../play/scripts';
import { aimed, place, showcase, skyPreset } from './kit';

/**
 * "Playground", the Play preview's example: walk in (View › Play) and try the
 * scripts. A door slides open while you stand in its zone and shuts after you;
 * a lift rides up and down on its own clip and carries you to a ledge; a
 * bridge spins between the ledge and a tower; a red button drops a ball onto a
 * ramp, again from the top every time it is pressed. All of it is keys,
 * clips, behaviours and one trigger zone: nothing is code.
 */

const DOOR = { at: [5, 1.25, 7] as Vec3, half: [1, 1.25, 0.12] as Vec3, open: 2, seconds: 1 };
const WALL = { y: 1.75, half: [1.5, 1.75, 0.3] as Vec3, offset: 2.5, lintel: [1, 0.5, 0.3] as Vec3, lintelY: 3 };
const ZONE = { half: [1.6, 1.25, 3.5] as Vec3 };
const LIFT = { at: [-4, 0.15, 0] as Vec3, half: [1.2, 0.15, 1.2] as Vec3, top: 3.85, seconds: 3 };
const LEDGE = { at: [-8, 2, 0] as Vec3, half: [2.5, 2, 3] as Vec3 };
const TOWER = { at: [-8, 2, -12] as Vec3, half: [2.5, 2, 3] as Vec3 };
const BRIDGE = { at: [-8, 3.85, -6] as Vec3, half: [0.8, 0.15, 3.6] as Vec3, speed: 30 };
const BUTTON = { at: [0, 0.1, 1] as Vec3, half: [0.7, 0.1, 0.7] as Vec3, rest: 1 };
const BALL = { at: [0, 6, -3.5] as Vec3, r: 0.5 };
const RAMP = { at: [0, 0.6, -3] as Vec3, half: [1.2, 0.1, 2.2] as Vec3, tilt: 15 };
const CAMERA = { from: [0, 1.7, 16] as Vec3, aim: [-1, 1.6, 0] as Vec3, lens: { fov: 60 } };
const DROP = 'drop';

const keyed = (o: SceneObject, seconds: number, to: Vec3): Key<Transform>[] =>
  [{ time: 0, value: o.transform }, { time: seconds, value: { ...o.transform, position: to } }];

const clip = (to: number, mode: ClipMode, start: ClipStart): PlayScript => ({ clip: { from: 0, to, mode, speed: 1, start } });

export function playground(): Scene {
  const door = place({ entry: 'cube', name: 'Door', material: 'Polished Wood', position: DOOR.at, size: DOOR.half });
  const lift = place({ entry: 'cube', name: 'Lift', material: 'Anodized Teal', position: LIFT.at, size: LIFT.half });
  const zone: TriggerZone = { rules: [
    { who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Forward, target: door.id },
    { who: ZoneWho.Player, edge: ZoneEdge.Leave, action: ZoneAction.Backward, target: door.id },
  ] };
  const doorZone = createTriggerZone([DOOR.at[0], 0, DOOR.at[2]], 'Door Zone');
  const ball = withBody(place({ entry: 'sphere', name: 'Ball', material: 'Red Plastic', position: BALL.at, size: [BALL.r, BALL.r, BALL.r] }), { physical: true });
  const button = place({ entry: 'cylinder', name: 'Button', material: 'Red Plastic', position: BUTTON.at, size: BUTTON.half });
  const bridge = place({ entry: 'cube', name: 'Spinning Bridge', material: 'Copper', position: BRIDGE.at, size: BRIDGE.half });
  const objects: SceneObject[] = [
    place({ entry: 'ground', name: 'Ground', material: 'Grassy Plain', position: [0, 0, 0] }),
    place({ entry: 'cube', name: 'Wall Left', material: 'Sandstone', position: [DOOR.at[0] - WALL.offset, WALL.y, DOOR.at[2]], size: WALL.half }),
    place({ entry: 'cube', name: 'Wall Right', material: 'Sandstone', position: [DOOR.at[0] + WALL.offset, WALL.y, DOOR.at[2]], size: WALL.half }),
    place({ entry: 'cube', name: 'Lintel', material: 'Sandstone', position: [DOOR.at[0], WALL.lintelY, DOOR.at[2]], size: WALL.lintel }),
    { ...door, script: clip(DOOR.seconds, ClipMode.Once, ClipStart.Trigger) },
    { ...doorZone, transform: { ...doorZone.transform, position: DOOR.at, size: ZONE.half }, zone },
    place({ entry: 'cube', name: 'Ledge', material: 'Canyon Strata', position: LEDGE.at, size: LEDGE.half }),
    { ...lift, script: clip(LIFT.seconds, ClipMode.PingPong, ClipStart.Auto) },
    place({ entry: 'cube', name: 'Tower', material: 'Canyon Strata', position: TOWER.at, size: TOWER.half }),
    { ...bridge, script: { behaviours: [{ kind: BehaviourKind.Spin, params: { speed: BRIDGE.speed } }] } },
    { ...button, script: { behaviours: [{ kind: BehaviourKind.Button, params: { cooldown: BUTTON.rest }, send: DROP }] } },
    place({ entry: 'cube', name: 'Ramp', material: 'Brushed Steel', position: RAMP.at, size: RAMP.half, rotation: [RAMP.tilt, 0, 0] }),
    { ...ball, script: { behaviours: [{ kind: BehaviourKind.Spawner, params: {}, on: DROP }] } },
  ];
  const camera = aimed(CAMERA.from, CAMERA.aim, CAMERA.lens);
  return showcase({ objects, sky: skyPreset('Trapper Keeper'), camera }, {
    duration: LIFT.seconds,
    loop: false,
    camera: [],
    objects: {
      [door.id]: keyed(door, DOOR.seconds, [DOOR.at[0] + DOOR.open, DOOR.at[1], DOOR.at[2]]),
      [lift.id]: keyed(lift, LIFT.seconds, [LIFT.at[0], LIFT.top, LIFT.at[2]]),
    },
  });
}
