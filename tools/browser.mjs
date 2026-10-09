// Headless Chrome for the dev tools. WebGL needs a real GPU backend: ANGLE on D3D11
// (Windows) or Metal (macOS); elsewhere Chrome picks its default. Set CHROME_PATH to
// use a specific browser, HOODOO_GL=swiftshader for machines without a GPU.
import fs from 'node:fs';

const CHROME = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
const ANGLE = { win32: '--use-angle=d3d11', darwin: '--use-angle=metal' };
const SOFTWARE = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = (CHROME[process.platform] ?? []).find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Chrome not found; set CHROME_PATH (tried ${(CHROME[process.platform] ?? []).join(', ')})`);
  return found;
}

export function launchOptions(extraArgs = []) {
  const gl = process.env.HOODOO_GL === 'swiftshader' ? SOFTWARE : ANGLE[process.platform] ? [ANGLE[process.platform]] : [];
  return { headless: true, executablePath: chromePath(), args: [...gl, '--mute-audio', ...extraArgs] };
}
