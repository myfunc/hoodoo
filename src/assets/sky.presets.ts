import { hexToRgb as h } from '../core/color';
import { SkyMode } from '../model/scene.enums';
import type { Sky } from '../model/scene.types';

/** Bryce's out-of-the-box "Soft Sky": pale blue dome, white haze band, light cumulus. */
export const DEFAULT_SKY: Sky = {
  mode: SkyMode.SoftSky,
  skyColor: h('#3f78c8'),
  horizonColor: h('#d4e4f4'),
  sunColor: h('#fff4e0'),
  ambientColor: h('#8a96a8'),
  sunAzimuth: 35,
  sunAltitude: 42,
  sunVisible: true,
  shadows: 75,
  fogAmount: 0,
  fogHeight: 1,
  fogColor: h('#c8d2dc'),
  hazeAmount: 22,
  hazeColor: h('#dfe8f2'),
  clouds: {
    cumulus: true,
    stratus: false,
    cover: 38,
    height: 40,
    frequency: 50,
    amplitude: 50,
    color: h('#ffffff'),
  },
  stars: false,
};

const sky = (name: string, patch: Partial<Sky>, clouds: Partial<Sky['clouds']> = {}): SkyPreset => ({
  name,
  sky: { ...DEFAULT_SKY, ...patch, clouds: { ...DEFAULT_SKY.clouds, ...clouds } },
});

export interface SkyPreset {
  readonly name: string;
  readonly sky: Sky;
}

export const SKY_LIBRARY: readonly SkyPreset[] = [
  { name: 'Soft Sky', sky: DEFAULT_SKY },
  sky('Trapper Keeper', {
    skyColor: h('#2f8fd8'), horizonColor: h('#bfe8ff'), hazeColor: h('#c8f0ff'),
    sunAltitude: 30, sunAzimuth: -40, hazeAmount: 30, ambientColor: h('#9aa8c8'),
  }, { cover: 45, frequency: 40, amplitude: 70 }),
  sky('Vapor Sunset', {
    skyColor: h('#3a0f6a'), horizonColor: h('#ff6a9a'), sunColor: h('#ffb070'),
    hazeColor: h('#ff8ab0'), hazeAmount: 45, sunAltitude: 6, sunAzimuth: 0,
    ambientColor: h('#6a3a7a'),
  }, { cover: 30, color: h('#ffb0d0'), stratus: true, cumulus: false }),
  sky('Red Planet', {
    mode: SkyMode.DarkerSky,
    skyColor: h('#3a0404'), horizonColor: h('#ff2a1a'), sunColor: h('#ffd0a0'),
    hazeColor: h('#ff3a20'), hazeAmount: 55, sunAltitude: 12, ambientColor: h('#5a1a12'),
    fogAmount: 25, fogHeight: 2, fogColor: h('#a01a10'),
  }, { cover: 10, color: h('#ff8a6a') }),
  sky('Golden Hour', {
    skyColor: h('#4a7ab8'), horizonColor: h('#ffd59a'), sunColor: h('#ffc070'),
    hazeColor: h('#ffd8a8'), hazeAmount: 35, sunAltitude: 9, sunAzimuth: 60,
    ambientColor: h('#8a7a6a'),
  }, { cover: 35, color: h('#ffe0c0') }),
  sky('Hazy Afternoon', {
    skyColor: h('#6a8ab0'), horizonColor: h('#e8e8e0'), hazeAmount: 60, hazeColor: h('#ececE4'),
    sunAltitude: 55,
  }, { cover: 20 }),
  sky('Overcast', {
    mode: SkyMode.DarkerSky,
    skyColor: h('#7a8088'), horizonColor: h('#b8bcc0'), sunColor: h('#d8d8d8'),
    shadows: 30, hazeAmount: 40, hazeColor: h('#b8bcc0'), ambientColor: h('#9a9ea4'),
  }, { cover: 85, stratus: true, color: h('#d0d4d8') }),
  sky('Moonlit Night', {
    skyColor: h('#02040e'), horizonColor: h('#1a2440'), sunColor: h('#a8b8e0'),
    hazeColor: h('#1a2440'), hazeAmount: 20, sunAltitude: -25, ambientColor: h('#1a2030'),
    stars: true,
  }, { cover: 15, color: h('#5a6a8a') }),
  sky('Arctic', {
    skyColor: h('#7ab0e0'), horizonColor: h('#f4fbff'), hazeColor: h('#ffffff'),
    hazeAmount: 40, sunAltitude: 14, sunColor: h('#fffaf0'), ambientColor: h('#a8b8c8'),
  }, { cover: 20, stratus: true, cumulus: false }),
  sky('Pea Soup', {
    mode: SkyMode.DarkerSky, fogAmount: 70, fogHeight: 4, fogColor: h('#a8b098'),
    hazeAmount: 70, hazeColor: h('#a8b098'), horizonColor: h('#a8b098'), skyColor: h('#6a7060'),
  }, { cover: 60 }),
  sky('Atmosphere Off', { mode: SkyMode.AtmosphereOff, hazeAmount: 0, skyColor: h('#3f78c8') }, { cover: 0 }),
];
