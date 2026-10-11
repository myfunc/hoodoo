import { describe, expect, it } from 'vitest';
import { MATERIAL_LIBRARY } from '../../../assets/materials.presets';
import { PRESET_ORDER, StepDirection, presetStep } from '../material-menu';

describe('material menu order', () => {
  it('lists every preset family by family', () => {
    expect(PRESET_ORDER.map((p) => p.material.name)).toEqual(MATERIAL_LIBRARY.flatMap((c) => c.materials.map((m) => m.name)));
    expect(PRESET_ORDER[0].family).toBe(MATERIAL_LIBRARY[0].name);
  });

  it('steps to the neighbours and wraps at both ends', () => {
    const [first, second] = PRESET_ORDER;
    const last = PRESET_ORDER[PRESET_ORDER.length - 1];
    expect(presetStep(first.material.name, StepDirection.Next)).toBe(second);
    expect(presetStep(second.material.name, StepDirection.Previous)).toBe(first);
    expect(presetStep(last.material.name, StepDirection.Next)).toBe(first);
    expect(presetStep(first.material.name, StepDirection.Previous)).toBe(last);
  });

  it('steps from a custom material onto the first or the last preset', () => {
    expect(presetStep('My own', StepDirection.Next)).toBe(PRESET_ORDER[0]);
    expect(presetStep('My own', StepDirection.Previous)).toBe(PRESET_ORDER[PRESET_ORDER.length - 1]);
  });
});
