import type { SourceFiles } from './source.types';

/**
 * Game files served over HTTP from a folder laid out like the game root
 * (models/, materials/, sound/…) with an `index.json` listing its paths. For
 * development and scripted checks: `?gamefiles=<url>` points Play at such a
 * folder on the player's own machine. Players normally pick their game folder.
 */
export class HttpFiles implements SourceFiles {
  private readonly paths: Set<string>;

  private constructor(private readonly base: string, paths: readonly string[]) {
    this.paths = new Set(paths.map((p) => p.toLowerCase()));
  }

  static async open(base: string): Promise<HttpFiles> {
    const root = base.endsWith('/') ? base : `${base}/`;
    const res = await fetch(`${root}index.json`);
    if (!res.ok) throw new Error(`No index.json at ${root}`);
    return new HttpFiles(root, (await res.json()) as string[]);
  }

  has(path: string): boolean {
    return this.paths.has(normal(path));
  }

  async read(path: string): Promise<Uint8Array | null> {
    const p = normal(path);
    if (!this.paths.has(p)) return null;
    const res = await fetch(this.base + p);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  list(prefix: string): string[] {
    const p = normal(prefix);
    return [...this.paths].filter((x) => x.startsWith(p));
  }
}

const normal = (path: string): string => path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
