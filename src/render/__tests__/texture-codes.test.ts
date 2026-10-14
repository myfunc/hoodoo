import { describe, expect, it } from 'vitest';
import { TextureKind } from '../../model/scene.enums';
import { TRACE_SOURCE } from '../gpu/trace-source';

/** The shader's T_ codes by name, folded like the enum's keys (T_FACADE_GLASS: facadeglass). */
function shaderCodes(): Map<string, number> {
  const codes = new Map<string, number>();
  for (const m of TRACE_SOURCE.matchAll(/^#define T_(\w+) (\d+)$/gm)) codes.set(m[1].replace(/_/g, '').toLowerCase(), Number(m[2]));
  return codes;
}

describe('texture kinds', () => {
  it('each have the code the ray tracer draws them by', () => {
    const codes = shaderCodes();
    for (const [name, kind] of Object.entries(TextureKind)) {
      if (typeof kind !== 'number') continue;
      expect([name, codes.get(name.toLowerCase())]).toEqual([name, kind]);
    }
  });
});
