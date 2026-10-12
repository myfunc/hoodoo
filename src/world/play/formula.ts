/**
 * READ ME — the tiny formula language of Play's parameters (docs/play-mode.md):
 * `sin(t*2)*0.5`, `3 + t % 2`, `clamp(t, 0, 4)`. A hand-written parser turns
 * the text into a tree of closures; nothing is ever handed to `eval` or
 * `Function`, and names are looked up in fixed tables (Maps, so `constructor`
 * or `__proto__` are simply unknown). Only digits, the letters of names, the
 * operators + - * / % ^ < > = and brackets and commas get through; the text,
 * the tree and its depth are capped, so a hostile file cannot hang the page.
 */

/** What a formula may read: `t` is the behaviour's own clock in seconds. */
export interface FormulaVars {
  readonly t: number;
}

export interface Formula {
  readonly source: string;
  at(vars: FormulaVars): number;
}

export type Compiled = { readonly ok: true; readonly formula: Formula } | { readonly ok: false; readonly error: string };

export const FORMULA_LIMITS = { length: 120, nodes: 64, depth: 16 } as const;
/** Results are kept in this range; NaN and infinities read as 0. */
const RESULT_LIMIT = 1e6;
const ALLOWED = /^[0-9a-z_.+\-*/%^()<>=,\s]*$/i;
const NUMBER = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;
const NAME = /^[a-z_][a-z0-9_]*/i;
const SPACE = /^\s+/;
const OPERATORS = ['<=', '>=', '+', '-', '*', '/', '%', '^', '<', '>', '(', ')', ','] as const;

type Node = (v: FormulaVars) => number;

const CONSTANTS = new Map<string, number>([['pi', Math.PI], ['tau', 2 * Math.PI], ['e', Math.E]]);
const VARIABLES = new Map<string, (v: FormulaVars) => number>([['t', (v) => v.t]]);

const fract = (x: number): number => x - Math.floor(x);
const mod = (a: number, b: number): number => (b === 0 ? 0 : a - b * Math.floor(a / b));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const s = b === a ? (x < a ? 0 : 1) : clamp((x - a) / (b - a), 0, 1);
  return s * s * (3 - 2 * s);
};

/** Functions by name: how many arguments, and what they do. */
const FUNCTIONS = new Map<string, { readonly arity: number; readonly fn: (...a: number[]) => number }>([
  ['sin', { arity: 1, fn: Math.sin }],
  ['cos', { arity: 1, fn: Math.cos }],
  ['tan', { arity: 1, fn: Math.tan }],
  ['asin', { arity: 1, fn: Math.asin }],
  ['acos', { arity: 1, fn: Math.acos }],
  ['atan', { arity: 1, fn: Math.atan }],
  ['atan2', { arity: 2, fn: Math.atan2 }],
  ['abs', { arity: 1, fn: Math.abs }],
  ['sign', { arity: 1, fn: Math.sign }],
  ['floor', { arity: 1, fn: Math.floor }],
  ['ceil', { arity: 1, fn: Math.ceil }],
  ['round', { arity: 1, fn: Math.round }],
  ['fract', { arity: 1, fn: fract }],
  ['sqrt', { arity: 1, fn: Math.sqrt }],
  ['exp', { arity: 1, fn: Math.exp }],
  ['log', { arity: 1, fn: Math.log }],
  ['pow', { arity: 2, fn: Math.pow }],
  ['min', { arity: 2, fn: Math.min }],
  ['max', { arity: 2, fn: Math.max }],
  ['mod', { arity: 2, fn: mod }],
  ['step', { arity: 2, fn: (edge, x) => (x < edge ? 0 : 1) }],
  ['clamp', { arity: 3, fn: clamp }],
  ['mix', { arity: 3, fn: (a, b, s) => a + (b - a) * s }],
  ['smoothstep', { arity: 3, fn: smoothstep }],
  /** A triangle wave: 0 at whole numbers, 1 halfway between (there and back once a period). */
  ['tri', { arity: 1, fn: (x) => 1 - Math.abs(2 * fract(x) - 1) }],
]);

/** The names a formula knows, for the editor's hint. */
export const FORMULA_NAMES = { variables: [...VARIABLES.keys()], constants: [...CONSTANTS.keys()], functions: [...FUNCTIONS.keys()] } as const;

class FormulaError extends Error {}

type Token = { readonly kind: 'num'; readonly value: number } | { readonly kind: 'name'; readonly text: string } | { readonly kind: 'op'; readonly text: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let rest = src;
  while (rest.length) {
    const space = SPACE.exec(rest);
    if (space) {
      rest = rest.slice(space[0].length);
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num) {
      out.push({ kind: 'num', value: Number(num[0]) });
      rest = rest.slice(num[0].length);
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      out.push({ kind: 'name', text: name[0].toLowerCase() });
      rest = rest.slice(name[0].length);
      continue;
    }
    const op = OPERATORS.find((o) => rest.startsWith(o));
    if (!op) throw new FormulaError(`Unexpected "${rest[0]}"`);
    out.push({ kind: 'op', text: op });
    rest = rest.slice(op.length);
  }
  return out;
}

/** Recursive descent, lowest precedence first: comparison, sum, product, unary, power, atom. */
class Parser {
  private at = 0;
  private nodes = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Node {
    if (!this.tokens.length) throw new FormulaError('Empty formula');
    const node = this.comparison();
    if (this.at < this.tokens.length) throw new FormulaError(`Unexpected "${this.text(this.tokens[this.at])}"`);
    return node;
  }

  private text(t: Token): string {
    return t.kind === 'num' ? String(t.value) : t.text;
  }

  private peekOp(...ops: string[]): string | null {
    const t = this.tokens[this.at];
    return t?.kind === 'op' && ops.includes(t.text) ? t.text : null;
  }

  private expect(op: string): void {
    if (!this.peekOp(op)) throw new FormulaError(`Expected "${op}"`);
    this.at++;
  }

  private node(fn: Node): Node {
    if (++this.nodes > FORMULA_LIMITS.nodes) throw new FormulaError('Formula is too long');
    return fn;
  }

  private nested<T>(inner: () => T): T {
    if (++this.depth > FORMULA_LIMITS.depth) throw new FormulaError('Too many brackets');
    const out = inner();
    this.depth--;
    return out;
  }

  private comparison(): Node {
    let left = this.sum();
    for (let op = this.peekOp('<', '>', '<=', '>='); op; op = this.peekOp('<', '>', '<=', '>=')) {
      this.at++;
      const [a, b] = [left, this.sum()];
      left = this.node(op === '<' ? (v) => +(a(v) < b(v)) : op === '>' ? (v) => +(a(v) > b(v)) : op === '<=' ? (v) => +(a(v) <= b(v)) : (v) => +(a(v) >= b(v)));
    }
    return left;
  }

  private sum(): Node {
    let left = this.product();
    for (let op = this.peekOp('+', '-'); op; op = this.peekOp('+', '-')) {
      this.at++;
      const [a, b] = [left, this.product()];
      left = this.node(op === '+' ? (v) => a(v) + b(v) : (v) => a(v) - b(v));
    }
    return left;
  }

  private product(): Node {
    let left = this.unary();
    for (let op = this.peekOp('*', '/', '%'); op; op = this.peekOp('*', '/', '%')) {
      this.at++;
      const [a, b] = [left, this.unary()];
      left = this.node(op === '*' ? (v) => a(v) * b(v) : op === '/' ? (v) => a(v) / b(v) : (v) => mod(a(v), b(v)));
    }
    return left;
  }

  private unary(): Node {
    const op = this.peekOp('-', '+');
    if (!op) return this.power();
    this.at++;
    const inner = this.nested(() => this.unary());
    return op === '-' ? this.node((v) => -inner(v)) : inner;
  }

  /** `^` binds tighter than a sign on its left and groups to the right: -2^2 is -4, 2^3^2 is 2^9. */
  private power(): Node {
    const base = this.atom();
    if (!this.peekOp('^')) return base;
    this.at++;
    const exponent = this.nested(() => this.unary());
    return this.node((v) => Math.pow(base(v), exponent(v)));
  }

  private atom(): Node {
    const t = this.tokens[this.at++];
    if (!t) throw new FormulaError('The formula ends too soon');
    if (t.kind === 'num') {
      const value = t.value;
      return this.node(() => value);
    }
    if (t.kind === 'op') {
      if (t.text !== '(') throw new FormulaError(`Unexpected "${t.text}"`);
      const inner = this.nested(() => this.comparison());
      this.expect(')');
      return inner;
    }
    return this.peekOp('(') ? this.call(t.text) : this.name(t.text);
  }

  private name(text: string): Node {
    const constant = CONSTANTS.get(text);
    if (constant !== undefined) return this.node(() => constant);
    const variable = VARIABLES.get(text);
    if (variable) return this.node(variable);
    throw new FormulaError(FUNCTIONS.has(text) ? `${text} needs brackets: ${text}(…)` : `Unknown name "${text}"`);
  }

  private call(text: string): Node {
    const f = FUNCTIONS.get(text);
    if (!f) throw new FormulaError(`Unknown function "${text}"`);
    this.expect('(');
    const args = this.nested(() => {
      const list: Node[] = [this.comparison()];
      while (this.peekOp(',')) {
        this.at++;
        list.push(this.comparison());
      }
      return list;
    });
    this.expect(')');
    if (args.length !== f.arity) throw new FormulaError(`${text} takes ${f.arity} value${f.arity > 1 ? 's' : ''}`);
    const fn = f.fn;
    return this.node((v) => fn(...args.map((a) => a(v))));
  }
}

const finite = (x: number): number => (Number.isFinite(x) ? Math.min(RESULT_LIMIT, Math.max(-RESULT_LIMIT, x)) : 0);

/** The formula, or why it is not one. Pure: the same text always gives the same answer. */
export function compileFormula(source: string): Compiled {
  if (typeof source !== 'string') return { ok: false, error: 'Not a formula' };
  if (source.length > FORMULA_LIMITS.length) return { ok: false, error: `At most ${FORMULA_LIMITS.length} characters` };
  if (!ALLOWED.test(source)) return { ok: false, error: 'Only numbers, names, + - * / % ^ < > and brackets' };
  try {
    const node = new Parser(tokenize(source)).parse();
    return { ok: true, formula: { source, at: (v) => finite(node(v)) } };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}

const cache = new Map<string, Formula | null>();
const CACHE_LIMIT = 256;

/** A compiled formula from a small cache (the simulation asks every step); null when the text is not one. */
export function formulaOf(source: string): Formula | null {
  const known = cache.get(source);
  if (known !== undefined) return known;
  const c = compileFormula(source);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  const out = c.ok ? c.formula : null;
  cache.set(source, out);
  return out;
}

/** A parameter's value now: a number as it is, a formula at `vars` (0 if it does not read). */
export function paramValue(p: number | string, vars: FormulaVars): number {
  if (typeof p === 'number') return p;
  return formulaOf(p)?.at(vars) ?? 0;
}
