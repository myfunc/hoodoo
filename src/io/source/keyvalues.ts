import type { KeyValues } from './source.types';

const WINDOWS_CONDITIONS: Readonly<Record<string, boolean>> = {
  $win32: true, $windows: true, $x360: false, $osx: false,
  $linux: false, $posix: false, $ps3: false,
};
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', '\\': '\\', '"': '"' };
interface Token { readonly text: string; readonly kind: 'word' | 'open' | 'close' | 'condition' }

class KeyValuesReader {
  private at = 0;
  private pending: Token | null | undefined;

  constructor(private readonly text: string) {}

  private token(): Token | null {
    while (this.at < this.text.length) {
      if (/\s/.test(this.text[this.at]) || this.text[this.at] === '\ufeff') { this.at++; continue; }
      if (this.text.startsWith('//', this.at)) {
        while (this.at < this.text.length && this.text[this.at] !== '\n') this.at++;
        continue;
      }
      break;
    }
    if (this.at >= this.text.length) return null;
    const first = this.text[this.at++];
    if (first === '{') return { text: first, kind: 'open' };
    if (first === '}') return { text: first, kind: 'close' };
    let value = '';
    if (first === '"') {
      while (this.at < this.text.length) {
        const char = this.text[this.at++];
        if (char === '"') break;
        if (char === '\\' && this.at < this.text.length) {
          const escaped = this.text[this.at++];
          value += ESCAPES[escaped] ?? '\\' + escaped;
        } else value += char;
      }
      return { text: value, kind: 'word' };
    }
    if (first === '[') {
      while (this.at < this.text.length && this.text[this.at] !== ']') value += this.text[this.at++];
      if (this.text[this.at] === ']') this.at++;
      return { text: value, kind: 'condition' };
    }
    value = first;
    while (this.at < this.text.length && !/[\s{}]/.test(this.text[this.at]) && !this.text.startsWith('//', this.at)) value += this.text[this.at++];
    return { text: value, kind: 'word' };
  }

  private peek(): Token | null {
    if (this.pending === undefined) this.pending = this.token();
    return this.pending;
  }

  private next(): Token | null {
    const token = this.peek();
    this.pending = undefined;
    return token;
  }

  read(nested = false): KeyValues[] {
    const nodes: KeyValues[] = [];
    for (let key = this.next(); key; key = this.next()) {
      if (key.kind === 'close') { if (nested) break; else continue; }
      if (key.kind !== 'word') continue;
      const token = this.peek();
      let node: KeyValues;
      if (token?.kind === 'open') {
        this.next();
        node = { key: key.text, value: null, children: this.read(true) };
      } else if (token?.kind === 'word') {
        this.next();
        node = { key: key.text, value: token.text, children: [] };
      } else node = { key: key.text, value: '', children: [] };
      let enabled = true;
      while (this.peek()?.kind === 'condition') {
        const condition = this.next()!.text.trim().toLowerCase();
        const negate = condition.startsWith('!');
        const name = negate ? condition.slice(1).trim() : condition;
        const value = WINDOWS_CONDITIONS[name] ?? true;
        enabled &&= negate ? !value : value;
      }
      if (enabled) nodes.push(node);
    }
    return nodes;
  }
}

/** READ ME — reads Valve KeyValues text for a Windows PC; #base/#include remain ordinary nodes. */
export function parseKeyValues(text: string): KeyValues[] { return new KeyValuesReader(text).read(); }

/** Finds the first child, retaining its original spelling and nested values. */
export function keyValue(nodes: readonly KeyValues[], key: string): KeyValues | undefined {
  const lower = key.toLowerCase();
  return nodes.find(node => node.key.toLowerCase() === lower);
}

/** Finds all children, including repeated keys such as wave and precache_file. */
export function keyValues(nodes: readonly KeyValues[], key: string): KeyValues[] {
  const lower = key.toLowerCase();
  return nodes.filter(node => node.key.toLowerCase() === lower);
}
