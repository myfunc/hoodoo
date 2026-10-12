import { PlayResolution } from '../../world/settings';

/** Play's picture choice (Settings' playResolution), as the Play panel and the Render page show it. */
export const PLAY_RESOLUTIONS: readonly { readonly value: PlayResolution; readonly label: string; readonly title: string }[] = [
  { value: PlayResolution.Sharp, label: 'Sharp', title: 'Full detail first: may dip under 60 fps on a slower GPU' },
  { value: PlayResolution.Auto, label: 'Auto', title: '60 fps and a crisp picture: dips only on a much slower GPU' },
  { value: PlayResolution.Smooth, label: 'Smooth', title: '60 fps first: the picture may go soft' },
];

/** The choice's name and its one-line hint. */
export const PLAY_PICTURE = { name: 'Picture', hint: 'Play’s picture: sharp detail, a steady 60 fps, or both (Auto)' } as const;
