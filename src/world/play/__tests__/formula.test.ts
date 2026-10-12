import { describe, expect, it } from 'vitest';
import { FORMULA_LIMITS, compileFormula, formulaOf, paramValue } from '../formula';

const value = (src: string, t = 0): number => {
  const c = compileFormula(src);
  if (!c.ok) throw new Error(`${src}: ${c.error}`);
  return c.formula.at({ t });
};

describe('play formulas', () => {
  it('reads numbers, t and the constants with the usual precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('7 % 3')).toBe(1);
    expect(value('-1 % 3')).toBe(2);
    expect(value('t * 2', 1.5)).toBe(3);
    expect(value('pi')).toBeCloseTo(Math.PI, 12);
    expect(value('tau / 2')).toBeCloseTo(Math.PI, 12);
    expect(value('1.5e2 + .5')).toBe(150.5);
    expect(value('t < 2', 1)).toBe(1);
    expect(value('t >= 2', 1)).toBe(0);
  });

  it('calls the known functions with their number of values', () => {
    expect(value('sin(t*2)*0.5', Math.PI / 4)).toBeCloseTo(0.5, 12);
    expect(value('clamp(t, 0, 4)', 9)).toBe(4);
    expect(value('mix(2, 4, 0.5)')).toBe(3);
    expect(value('max(1, min(5, 3))')).toBe(3);
    expect(value('tri(0.5)')).toBe(1);
    expect(value('tri(1)')).toBe(0);
    expect(value('step(1, t)', 2)).toBe(1);
    expect(value('SIN(0)')).toBe(0);
  });

  it('turns NaN and infinities into 0 and keeps results in range', () => {
    expect(value('1 / 0')).toBe(0);
    expect(value('sqrt(-1)')).toBe(0);
    expect(value('10 ^ 100')).toBe(1e6);
  });

  it.each([
    ['alert(1)', 'Unknown function'],
    ['constructor', 'Unknown name'],
    ['__proto__', 'Unknown name'],
    ['toString(1)', 'Unknown function'],
    ['valueOf', 'Unknown name'],
    ['sin.constructor', 'Unexpected'],
    ['window.x', 'Unexpected'],
    ['this', 'Unknown name'],
    ['eval(1)', 'Unknown function'],
    ['Function(1)', 'Unknown function'],
    ['"1"', 'Only numbers'],
    ["'1'", 'Only numbers'],
    ['`1`', 'Only numbers'],
    ['[1]', 'Only numbers'],
    ['{}', 'Only numbers'],
    ['t; 1', 'Only numbers'],
    ['a = 1', 'Unexpected'],
    ['t = 1', 'Unexpected'],
    ['x => 1', 'Unexpected'],
    ['1 +', 'ends too soon'],
    ['(1', 'Expected'],
    ['1 2', 'Unexpected'],
    ['sin', 'needs brackets'],
    ['sin(1, 2)', 'takes 1 value'],
    ['clamp(1)', 'takes 3 values'],
    ['', 'Empty'],
  ])('refuses %s', (src, why) => {
    const c = compileFormula(src);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain(why);
  });

  it('refuses text that is too long, too deep or too big', () => {
    expect(compileFormula('1+'.repeat(FORMULA_LIMITS.length) + '1').ok).toBe(false);
    expect(compileFormula('('.repeat(FORMULA_LIMITS.depth + 1) + '1' + ')'.repeat(FORMULA_LIMITS.depth + 1)).ok).toBe(false);
    expect(compileFormula('-'.repeat(FORMULA_LIMITS.depth + 1) + '1').ok).toBe(false);
    expect(compileFormula(Array.from({ length: 40 }, () => 't').join('+')).ok).toBe(false);
    expect(compileFormula(42 as unknown as string).ok).toBe(false);
  });

  it('gives parameters their value: numbers as they are, formulas at t, broken text 0', () => {
    expect(paramValue(3, { t: 9 })).toBe(3);
    expect(paramValue('t + 1', { t: 2 })).toBe(3);
    expect(paramValue('alert(1)', { t: 2 })).toBe(0);
    expect(formulaOf('t')).toBe(formulaOf('t'));
  });
});
