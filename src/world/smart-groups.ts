import { entryOfKind } from '../assets/object.catalog';
import { ShapeKind, SmartRuleKind } from '../model/scene.enums';
import type { SmartGroupId } from '../model/scene.ids';
import type { Scene, SceneObject, SmartGroup, SmartRule } from '../model/scene.types';
import { SCENE_LIMITS } from './scene.constants';

const LIGHTS: readonly ShapeKind[] = [ShapeKind.RadialLight, ShapeKind.SpotLight];
const NAME_SUFFIX = /[\p{N}\p{P}\s]+$/u;
const EVERY = 'Every ';
const LIGHT = 'Light';
const MATERIAL = 'Material: ';
const NAME = 'Name: ';
/** A kind's name for people; a lathe's catalog entry is one of its profiles, so it is named here. */
export const kindLabel = (kind: ShapeKind): string => (kind === ShapeKind.Lathe ? 'Lathe' : entryOfKind(kind).label);
const normalized = (text: string): string => text.trim().toLowerCase();

/** Members in scene order, without moving or regrouping objects. */
export function smartMembers(scene: Pick<Scene, 'objects'>, group: SmartGroup): SceneObject[] {
  const rule = group.rule;
  switch (rule.by) {
    case SmartRuleKind.Kind: return scene.objects.filter((o) => rule.kinds.includes(o.kind));
    case SmartRuleKind.Material: return scene.objects.filter((o) => normalized(o.material.name) === normalized(rule.material));
    case SmartRuleKind.Name: {
      const text = normalized(rule.text);
      return text ? scene.objects.filter((o) => normalized(o.name).includes(text)) : [];
    }
  }
}

/** The saved rule with this id, if it still exists. */
export function smartGroupOf(scene: Pick<Scene, 'smartGroups'>, id: SmartGroupId): SmartGroup | undefined {
  return scene.smartGroups?.find((g) => g.id === id);
}

/** A selected object's kind, material or name stem suggests a rule. */
export function ruleFrom(o: SceneObject, by: SmartRuleKind): SmartRule {
  switch (by) {
    case SmartRuleKind.Kind: return { by, kinds: LIGHTS.includes(o.kind) ? LIGHTS : [o.kind] };
    case SmartRuleKind.Material: return { by, material: o.material.name };
    case SmartRuleKind.Name: return { by, text: o.name.replace(NAME_SUFFIX, '') || o.name };
  }
}

/** A short default name from the rule and the catalog's display labels. */
export function smartName(rule: SmartRule): string {
  let name: string;
  switch (rule.by) {
    case SmartRuleKind.Kind: name = EVERY + (rule.kinds.every((k) => LIGHTS.includes(k)) ? LIGHT : kindLabel(rule.kinds[0])); break;
    case SmartRuleKind.Material: name = MATERIAL + rule.material; break;
    case SmartRuleKind.Name: name = NAME + rule.text; break;
  }
  return name.slice(0, SCENE_LIMITS.name);
}
