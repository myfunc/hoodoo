// Reads a Cloudflare-style _headers file: { "/path/*": { Header: value } }.
// Like Cloudflare, a repeated path merges and a repeated header joins with ", ".
// Detach lines ("! Header") and anything else unexpected are refused rather than
// skipped, so a local preview never quietly differs from the real host.
export function parseHeadersFile(text) {
  const rules = {};
  let current = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] ??= {};
      continue;
    }
    const colon = line.indexOf(':');
    if (!current || colon <= 0 || line.trimStart().startsWith('!')) throw new Error(`_headers line ${index + 1}: unsupported "${line.trim()}"`);
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    current[name] = current[name] ? `${current[name]}, ${value}` : value;
  }
  return rules;
}

/** The add_header lines of the sample nginx config, Cache-Control aside. */
export function nginxSecurityHeaders(conf) {
  return Object.fromEntries([...conf.matchAll(/add_header ([\w-]+) "([^"]+)" always;/g)]
    .filter(([, name]) => name !== 'Cache-Control').map(([, name, value]) => [name, value]));
}
